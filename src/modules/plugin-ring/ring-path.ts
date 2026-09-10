import { normalizePath } from 'obsidian';

/**
 * Where in the vault the ring file is.
 *
 * This is a property of the ring, not of the device: every device in a ring has
 * to look at the same file, or each one is talking to itself. The rename made
 * that a live question — the file used to be under `Toolbox/`, rings made from
 * here on keep it under `Signet/` — and the answer must be worked out from what
 * is actually in the vault, every time.
 *
 * It used to be decided once, at the first start after the update, and written
 * into this device's settings. That was the bug this file exists to close. The
 * decision was made per device, from whatever had synced by that moment, and
 * never revisited: a device that had the old file kept the old path forever, a
 * device that did not took the new one, and neither ever changed its mind. Two
 * devices on the same build, in the same ring, in the same vault, would then
 * publish and read different files and share nothing.
 */

/** Where a ring made from here on keeps its file. */
export const RING_FILE = 'Signet/plugin-ring.json';

/** Where the ring file lived while this plugin went by its old name. */
export const LEGACY_RING_FILE = 'Toolbox/plugin-ring.json';

/** Whether something is at that path. A predicate, so the rules below can be tested without a vault. */
export type Exists = (path: string) => Promise<boolean>;

/**
 * The path the user typed in the advanced settings, if they typed one.
 *
 * Either of the two names this plugin has used for itself means "wherever the
 * ring is" rather than a decision, so both read as nothing chosen — including
 * the old one, which is how a device that had the old path written into its
 * settings by the previous build stops being stuck with it.
 */
export function chosenRingPath(setting: string): string | undefined {
	const trimmed = setting.trim();
	if (!trimmed) {
		return undefined;
	}
	const path = normalizePath(trimmed);
	return path === RING_FILE || path === LEGACY_RING_FILE ? undefined : path;
}

/**
 * Where this device's ring file is right now.
 *
 * The new path wins when both files are there, and it is not a close call: the
 * ring is moved there once and nothing writes the old file afterwards, so a
 * `Toolbox/` file sitting beside a `Signet/` one is a leftover by definition.
 * The old path is still looked at, because a device updating late still has its
 * ring there and nowhere else, and that is the moment this has to work.
 */
export async function locateRingFile(setting: string, exists: Exists): Promise<string> {
	const chosen = chosenRingPath(setting);
	if (chosen) {
		return chosen;
	}
	if (await exists(RING_FILE)) {
		return RING_FILE;
	}
	if (await exists(LEGACY_RING_FILE)) {
		return LEGACY_RING_FILE;
	}
	return RING_FILE;
}

/**
 * Every path a publish has to write. One, now.
 *
 * For a while this also wrote the old path, so that a device still running the
 * build called Toolbox — which reads that file and nothing else — kept following
 * the ring. That device has been retired, so the copy stops: writing a second
 * file nobody reads is how a vault fills up with things that look like they
 * matter, and every one of them is another chance for the two to disagree.
 *
 * Reading the old path did not go with it. A device that updates late still has
 * its ring under the old name and needs to be found there exactly once — see
 * {@link locateRingFile}. What changed is that nothing puts anything back.
 */
export function ringWriteTargets(setting: string): string[] {
	return [chosenRingPath(setting) ?? RING_FILE];
}

/** The folder a ring file's roster sits in. Bare `devices` for a ring file at the root. */
export function rosterFolderFor(ringPath: string): string {
	const slash = ringPath.lastIndexOf('/');
	return slash < 0 ? 'devices' : `${ringPath.slice(0, slash)}/devices`;
}

/**
 * Every folder the roster answers at. The first is the only one written to.
 *
 * Written: always the new one, so every device agrees on a single folder whatever
 * state the ring file happens to be in.
 *
 * Read: that one, plus an old folder if it is still lying there. Nothing writes
 * it any more, so what it holds is the last thing a device said before it was
 * updated or retired — which is worth showing rather than hiding, because the
 * roster carries each device's version and that is how a straggler is spotted.
 * It is never created, and deleting it is how this move ends for good.
 */
export async function rosterFolders(setting: string, exists: Exists): Promise<string[]> {
	const chosen = chosenRingPath(setting);
	if (chosen) {
		return [rosterFolderFor(chosen)];
	}

	const mine = rosterFolderFor(RING_FILE);
	const old = rosterFolderFor(LEGACY_RING_FILE);
	return (await exists(old)) ? [mine, old] : [mine];
}
