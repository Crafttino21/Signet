import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

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

/** The heartbeat files, one per device. */
export class DeviceRoster {
	readonly folder: string;

	constructor(
		private readonly app: App,
		folder: string
	) {
		this.folder = normalizePath(folder);
	}

	private pathFor(deviceId: string): string {
		// Device ids are UUIDs, but a stray separator would escape the folder.
		return normalizePath(`${this.folder}/${deviceId.replace(/[^\w-]/g, '')}.json`);
	}

	async write(beat: Heartbeat): Promise<void> {
		const path = this.pathFor(beat.deviceId);
		const contents = JSON.stringify(beat, null, 2);

		const existing = this.app.vault.getFileByPath(path);
		if (existing) {
			await this.app.vault.modify(existing, contents);
			return;
		}

		if (!this.app.vault.getFolderByPath(this.folder)) {
			await this.app.vault.createFolder(this.folder);
		}
		await this.app.vault.create(path, contents);
	}

	/** Every readable heartbeat. Unreadable ones are skipped, not reported. */
	async readAll(): Promise<Heartbeat[]> {
		const folder = this.app.vault.getFolderByPath(this.folder);
		if (!folder) {
			return [];
		}

		const beats: Heartbeat[] = [];
		for (const file of this.app.vault.getFiles()) {
			if (file.parent?.path !== folder.path || file.extension !== 'json') {
				continue;
			}
			try {
				const parsed: unknown = JSON.parse(await this.app.vault.read(file));
				if (isHeartbeat(parsed)) {
					beats.push(parsed);
				}
			} catch {
				// A file caught mid-write is not news; the next read gets it.
			}
		}
		return beats;
	}

	/**
	 * Drops a device's heartbeat, so it stops appearing in the roster.
	 *
	 * To the trash rather than deleted: it is another device's file, and every
	 * other removal in this plugin goes the same way.
	 */
	async forget(deviceId: string): Promise<void> {
		const file = this.app.vault.getFileByPath(this.pathFor(deviceId));
		if (file) {
			await this.app.fileManager.trashFile(file);
		}
	}
}
