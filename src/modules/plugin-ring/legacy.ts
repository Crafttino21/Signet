import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { deriveRingId, openSnapshot, parseRingCode } from '@signet/protocol';
import type { Bytes } from '@signet/protocol';
import { trashPath } from '../../core/legacy-port';
import type { Leftover } from '../../core/legacy-port';
import { pathExists } from '../../core/vault-fs';
import { DeviceRoster } from './devices';
import type { Heartbeat } from './devices';
import { RingFile } from './ring-file';
import type { RingFileState } from './ring-file';
import { isRingSnapshot } from './types';
import { LEGACY_RING_FILE, RING_FILE, rosterFolderFor } from './ring-path';

/**
 * What the ring left under the plugin's old name.
 *
 * The copying itself already happens: `migrateRingFile()` puts the ring file at
 * its new path at startup, and the roster is read out of both folders so that a
 * device which has not been updated is still visible. What has never happened is
 * the last step — nothing is ever cleared away, so `Toolbox/` sits there for
 * good, is still read, still grows a heartbeat back if anything writes one, and
 * gives every device two places to disagree about.
 *
 * Each of these carries first and retires second, and retiring is only reached
 * when carrying is proven. Proven means something specific in each case:
 *
 * - The ring file: a file at the new path that opens with **this** ring's id. Not
 *   merely a file that exists — a foreign or half-written one at the new path
 *   must never be the reason the real one is thrown away.
 * - The roster: a heartbeat for the same device at the new path that is at least
 *   as new. The old folder is where a straggler's last word is, and that is the
 *   one thing in it worth keeping.
 */

export interface RingLegacyOptions {
	app: App;
	/** The ring code this device is in, or null when it is in none. */
	code: string | null;
	/** The path stored in this module's settings, for the stale-setting case. */
	storedPath: string;
	/** Blanks that stored path. Only called once it is known to be stale. */
	clearStoredPath: () => Promise<void>;
}

export async function ringLeftovers(options: RingLegacyOptions): Promise<Leftover[]> {
	// A device not in a ring has no way to tell whose ring file that is, and no
	// business moving it. Leaving it is the only safe answer.
	if (options.code === null) {
		return [];
	}

	const leftovers: Leftover[] = [];

	if (await pathExists(options.app, LEGACY_RING_FILE)) {
		leftovers.push(ringFileLeftover(options));
	}

	const oldFolder = rosterFolderFor(LEGACY_RING_FILE);
	if (await pathExists(options.app, oldFolder)) {
		leftovers.push(rosterLeftover(options, oldFolder));
	}

	if (isStalePath(options.storedPath)) {
		leftovers.push(storedPathLeftover(options));
	}

	return leftovers;
}

/** Whether the stored path is the old default rather than something chosen. */
export function isStalePath(stored: string): boolean {
	return normalizePath(stored.trim()) === LEGACY_RING_FILE;
}

/**
 * `Toolbox/plugin-ring.json`, once the same ring is readable at the new path.
 *
 * The sequence is compared as well as the ring id. The copy is made byte for
 * byte and nothing republishes afterwards, so the new file can only be the same
 * or further on — but "can only be" is not the same as "is", and this is the file
 * every device in the ring reads.
 */
function ringFileLeftover(options: RingLegacyOptions): Leftover {
	const { app, code } = options;

	return {
		kind: 'ringFile',
		at: LEGACY_RING_FILE,
		carry: async () => {
			const secret = parseRingCode(code ?? '');
			const ours = await deriveRingId(secret);

			const old = await new RingFile(app, LEGACY_RING_FILE).read();
			if (old.status === 'unreadable') {
				// A sync client caught mid-write looks exactly like a damaged file.
				// Leaving it is the same rule `classifyRingFile` already keeps.
				return 'unreadable';
			}
			if (old.status === 'ok' && old.envelope.ring !== ours) {
				return 'differentRing';
			}

			const now = await new RingFile(app, RING_FILE).read();
			if (now.status !== 'ok' || now.envelope.ring !== ours) {
				return 'notCarried';
			}

			// The sequence lives inside the envelope, so both have to be opened. The
			// copy is made byte for byte and nothing republishes afterwards, so the
			// new file can only be the same or further on — but "can only be" is not
			// the same as "is", and this is the file every device in the ring reads.
			const here = await sequenceOf(secret, now);
			const there = await sequenceOf(secret, old);
			if (here === undefined || (there !== undefined && here < there)) {
				return 'notCarried';
			}

			return undefined;
		},
		retire: () => trashPath(app, LEGACY_RING_FILE),
	};
}

/**
 * `Toolbox/devices`, once every heartbeat in it is matched at the new folder.
 *
 * Copied rather than assumed. A device that has not been updated writes only into
 * the old folder, so what is in there can be the newest thing anybody knows about
 * it — and the roster is worth nothing if it is wrong about which devices exist.
 */
function rosterLeftover(options: RingLegacyOptions, oldFolder: string): Leftover {
	const { app } = options;
	const newFolder = rosterFolderFor(RING_FILE);

	return {
		kind: 'rosterFolder',
		at: oldFolder,
		carry: async () => {
			const here = new DeviceRoster(app, [newFolder]);
			const there = new DeviceRoster(app, [oldFolder]);

			const known = new Map<string, Heartbeat>();
			for (const beat of await here.readAll()) {
				known.set(beat.deviceId, beat);
			}

			for (const beat of await there.readAll()) {
				if (isNewer(beat, known.get(beat.deviceId))) {
					await here.write(beat);
				}
			}

			// Proven by reading it back rather than by the writes not throwing.
			const after = new Map((await here.readAll()).map((beat) => [beat.deviceId, beat]));
			for (const beat of await there.readAll()) {
				if (isNewer(beat, after.get(beat.deviceId))) {
					return 'notCarried';
				}
			}

			return undefined;
		},
		retire: () => trashPath(app, oldFolder),
	};
}

/** Whether one heartbeat says more than another. A missing one always loses. */
function isNewer(beat: Heartbeat, against: Heartbeat | undefined): boolean {
	if (!against) {
		return true;
	}
	const mine = Date.parse(beat.updatedAt);
	const theirs = Date.parse(against.updatedAt);
	// An unreadable timestamp on either side is not grounds for overwriting.
	return Number.isFinite(mine) && Number.isFinite(theirs) && mine > theirs;
}

/**
 * A ring path still stored as the old default.
 *
 * `chosenRingPath` already reads either canonical name as "nothing chosen", so
 * this changes no behaviour. It is cleared anyway, because a settings field that
 * says `Toolbox/plugin-ring.json` while the ring is plainly somewhere else is a
 * thing somebody will one day read and believe.
 */
function storedPathLeftover(options: RingLegacyOptions): Leftover {
	return {
		kind: 'ringFilePath',
		at: options.storedPath,
		carry: () => Promise.resolve(undefined),
		retire: () => options.clearStoredPath(),
	};
}

/**
 * The sequence inside a ring file, or undefined when there is not one to read.
 *
 * Undefined covers everything from "no file" to "wrong key" to "not a snapshot".
 * All three mean the same thing here: nothing to compare, so nothing is thrown
 * away on the strength of it.
 */
async function sequenceOf(secret: Bytes, state: RingFileState): Promise<number | undefined> {
	if (state.status !== 'ok') {
		return undefined;
	}
	try {
		const snapshot = await openSnapshot(secret, state.envelope);
		return isRingSnapshot(snapshot) ? snapshot.seq : undefined;
	} catch {
		return undefined;
	}
}
