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
 * The new path wins when both files are there, because that is the direction the
 * ring is moving in: a host on this build publishes to both (see
 * {@link ringWriteTargets}), so a `Signet/` file is by definition at least as
 * fresh as the `Toolbox/` one beside it.
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
 * Every path a publish has to write.
 *
 * Always the new one, so a ring still living under the old name moves across the
 * first time its host publishes and every device on this build finds it in the
 * same place from then on. Plus the old one, but only while it is already there:
 * a device still running the build called Toolbox reads that file and nothing
 * else, and leaving it to go stale would strand it. The copy stops being written
 * the day the old file is deleted, which is the migration finishing itself.
 */
export async function ringWriteTargets(setting: string, exists: Exists): Promise<string[]> {
	const chosen = chosenRingPath(setting);
	if (chosen) {
		return [chosen];
	}
	return (await exists(LEGACY_RING_FILE)) ? [RING_FILE, LEGACY_RING_FILE] : [RING_FILE];
}
