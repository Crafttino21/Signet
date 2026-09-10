import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { ensureFolder, pathExists } from '../../core/vault-fs';

/**
 * Who else is in this ring, and when each of them was last here.
 *
 * Every device owns exactly one file, named after its id. That is the whole
 * trick: with a single writer per file there is nothing for two devices to
 * disagree about, so the roster cannot become a source of the conflicts the sync
 * exists to avoid.
 *
 * They are ordinary vault files, so they travel by whatever sync carries the
 * vault — which also makes them a measurement of it. A device that stops
 * appearing is either switched off or not syncing, and those two look the same
 * from here on purpose: both mean its notes are not moving.
 */

/** What one device writes about itself. */
export interface Heartbeat {
	deviceId: string;
	deviceName: string;
	/** ISO timestamp, written by that device with its own clock. */
	updatedAt: string;
	/** What that device believed it was, last time it wrote. */
	role?: 'host' | 'client';
	/** Which version of the plugin wrote this, so a stale build is visible. */
	version?: string;
}

export type DeviceStatus =
	/** Seen recently. */
	| 'fresh'
	/** Nothing has arrived from this device for a while. */
	| 'stale'
	/** The heartbeat exists but says nothing usable. */
	| 'unknown';

export interface DeviceHealth {
	deviceId: string;
	deviceName: string;
	status: DeviceStatus;
	/** Minutes since the heartbeat, floored. Absent when the timestamp is unusable. */
	ageMinutes?: number;
	isSelf: boolean;
	isHost: boolean;
	version?: string;
}

export interface RosterOptions {
	now: Date;
	/** Beyond this, a device is reported as not having been here lately. */
	staleAfterMinutes: number;
	/** This device's id, so it is marked rather than warned about. */
	selfId: string;
	/** The host according to the ring, so the list can say which one it is. */
	hostId: string | null;
}

const MINUTE = 60 * 1000;

/**
 * How often a device writes itself into the roster.
 *
 * Every write is a file the sync then carries, so this is as often as it can be
 * without turning the roster into the busiest thing in the vault.
 */
export const BEAT_EVERY_MINUTES = 5;

/**
 * Below this, a device counts as here rather than as last seen.
 *
 * It has to be at least one beat, or a device that is plainly sitting there
 * open reads as absent for most of every cycle — which is precisely what it did
 * while this was two minutes and the beat was five. The margin on top absorbs
 * the time the heartbeat spends travelling and the couple of minutes two
 * devices' clocks routinely disagree by.
 *
 * The error it can make now is the harmless one: a device that has just been
 * closed goes on looking present for a few minutes. Claiming a device is away
 * while its owner is typing on it is the one that makes the list useless.
 */
export const HERE_WITHIN_MINUTES = BEAT_EVERY_MINUTES + 3;

/** Whether this device should be shown as here rather than as last seen. */
export function isHereNow(device: DeviceHealth): boolean {
	return (
		device.isSelf ||
		(device.ageMinutes !== undefined && device.ageMinutes < HERE_WITHIN_MINUTES)
	);
}

export function isHeartbeat(value: unknown): value is Heartbeat {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<Heartbeat>;
	return (
		typeof candidate.deviceId === 'string' &&
		candidate.deviceId.length > 0 &&
		typeof candidate.deviceName === 'string' &&
		typeof candidate.updatedAt === 'string'
	);
}

/**
 * Turns the raw heartbeats into the roster the panel shows.
 *
 * A timestamp from the future is normal rather than an error — clocks differ —
 * so it is treated as just-seen. Only time that has genuinely passed counts.
 */
export function buildRoster(beats: readonly Heartbeat[], options: RosterOptions): DeviceHealth[] {
	return beats
		.map((beat): DeviceHealth => {
			const common = {
				deviceId: beat.deviceId,
				deviceName: beat.deviceName,
				isSelf: beat.deviceId === options.selfId,
				isHost: options.hostId !== null && beat.deviceId === options.hostId,
				version: beat.version,
			};
			const seen = Date.parse(beat.updatedAt);

			if (Number.isNaN(seen)) {
				return { ...common, status: 'unknown' };
			}

			const ageMinutes = Math.max(0, Math.floor((options.now.getTime() - seen) / MINUTE));
			return {
				...common,
				status: ageMinutes >= options.staleAfterMinutes ? 'stale' : 'fresh',
				ageMinutes,
			};
		})
		.sort((a, b) => {
			// This device first, then the host, then by how recently each was here.
			if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
			if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
			return (a.ageMinutes ?? Infinity) - (b.ageMinutes ?? Infinity);
		});
}

/**
 * The heartbeat files, one per device.
 *
 * Given every folder the roster answers at rather than one, because the roster
 * moved when the ring file did and nothing carried it across: updated devices
 * beat into `Signet/devices` while anything still on the old build beat into
 * `Toolbox/devices`, and each half read only its own and concluded it was alone.
 *
 * The first folder is this device's own and the only one written to. The rest
 * are read — and forgotten from, or a device somebody removed would keep coming
 * back from a copy nobody is maintaining. Nothing is written into them and none
 * of them is created: they hold what a device said before it was updated, which
 * is worth showing while it is there and worth losing the moment it is deleted.
 *
 * Reading and writing go through the index first and the disk second. The index
 * is not the disk — a sync client drops files into an open vault and they exist
 * before Obsidian lists them — and asking the index alone was the second half of
 * the same bug: `createFolder` throws on a folder that is on disk but not
 * indexed, `beat()` logged the throw and moved on, and that device wrote no
 * heartbeat again for as long as it stayed open.
 */
export class DeviceRoster {
	readonly folders: string[];

	constructor(
		private readonly app: App,
		folders: readonly string[]
	) {
		// Deduplicated, because the two names collapse into one as soon as the old
		// ring file is deleted, and writing the same file twice is not free.
		this.folders = [...new Set(folders.map((folder) => normalizePath(folder)))];
	}

	/** Where this device writes itself. The others are kept in step. */
	get folder(): string {
		return this.folders[0] ?? normalizePath('devices');
	}

	private pathIn(folder: string, deviceId: string): string {
		// Device ids are UUIDs, but a stray separator would escape the folder.
		return normalizePath(`${folder}/${deviceId.replace(/[^\w-]/g, '')}.json`);
	}

	/**
	 * Writes this device's heartbeat, into one folder and no other.
	 *
	 * The old folder was kept in step for as long as a device was still running
	 * the build that reads it. None is, so writing there would only recreate a
	 * folder somebody deleted on purpose and leave a heartbeat nobody reads.
	 */
	async write(beat: Heartbeat): Promise<void> {
		const folder = this.folder;
		await ensureFolder(this.app, folder);

		const path = this.pathIn(folder, beat.deviceId);
		const contents = JSON.stringify(beat, null, 2);

		const existing = this.app.vault.getFileByPath(path);
		if (existing) {
			await this.app.vault.modify(existing, contents);
			return;
		}

		// The same gap one level down: `create` refuses a path that is already on
		// disk, so a heartbeat the index has not caught up with could never be
		// rewritten and this device would go on looking absent.
		if (await pathExists(this.app, path)) {
			await this.app.vault.adapter.write(path, contents);
			return;
		}

		await this.app.vault.create(path, contents);
	}

	/**
	 * Every readable heartbeat, from every folder. Unreadable ones are skipped.
	 *
	 * One row per device, because a device that was in the ring before the rename
	 * has a file under the old name as well as the current one. The newest
	 * `updatedAt` wins: nothing writes the old folder any more, so what is in it
	 * can only be older, and a leftover must never make a device that is plainly
	 * here look like it left.
	 */
	async readAll(): Promise<Heartbeat[]> {
		const newest = new Map<string, Heartbeat>();

		for (const folder of this.folders) {
			for (const beat of await this.readFolder(folder)) {
				const seen = newest.get(beat.deviceId);
				if (!seen || Date.parse(beat.updatedAt) > Date.parse(seen.updatedAt)) {
					newest.set(beat.deviceId, beat);
				}
			}
		}

		return [...newest.values()];
	}

	private async readFolder(folder: string): Promise<Heartbeat[]> {
		const indexed = this.app.vault.getFolderByPath(folder);
		const beats: Heartbeat[] = [];

		if (indexed) {
			for (const file of this.app.vault.getFiles()) {
				if (file.parent?.path !== indexed.path || file.extension !== 'json') {
					continue;
				}
				const beat = await this.readOne(() => this.app.vault.read(file));
				if (beat) {
					beats.push(beat);
				}
			}
			return beats;
		}

		// Not indexed does not mean not there. A phone that has just been opened
		// while its sync was landing has a folder full of heartbeats that
		// `getFolderByPath` knows nothing about, and reporting an empty roster is
		// how every other device in the ring stopped being listed.
		try {
			const listing = await this.app.vault.adapter.list(folder);
			for (const path of listing.files) {
				if (!path.endsWith('.json')) {
					continue;
				}
				const beat = await this.readOne(() => this.app.vault.adapter.read(path));
				if (beat) {
					beats.push(beat);
				}
			}
		} catch {
			// No such folder. Nothing has ever beaten here, which is not news.
		}
		return beats;
	}

	private async readOne(read: () => Promise<string>): Promise<Heartbeat | undefined> {
		try {
			const parsed: unknown = JSON.parse(await read());
			return isHeartbeat(parsed) ? parsed : undefined;
		} catch {
			// A file caught mid-write is not news; the next read gets it.
			return undefined;
		}
	}

	/**
	 * Drops a device's heartbeat, so it stops appearing in the roster.
	 *
	 * From every folder, or the copy under the other name would put it straight
	 * back. To the trash rather than deleted: it is another device's file, and
	 * every other removal in this plugin goes the same way.
	 */
	async forget(deviceId: string): Promise<void> {
		for (const folder of this.folders) {
			const file = this.app.vault.getFileByPath(this.pathIn(folder, deviceId));
			if (file) {
				await this.app.fileManager.trashFile(file);
			}
		}
	}
}
