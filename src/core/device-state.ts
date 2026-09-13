import type { App } from 'obsidian';

/**
 * The handful of things this plugin remembers about *this* device.
 *
 * Everything else lives in `data.json`, and that file travels: the whole point of
 * the ring and the sync is that a vault is the same on every device, and
 * `onExternalSettingsChange` exists because another device can rewrite it
 * underneath us. Which is exactly wrong for "the version this machine last showed
 * the notes for". Put that in the settings and updating the laptop would mark the
 * phone as having seen them, and the phone would never show them at all.
 *
 * So it goes in Obsidian's per-vault local storage instead. It is scoped to the
 * vault, it stays on the machine, it survives a plugin update, and nothing syncs
 * it anywhere. Reads never throw: private windows and cleared site data are both
 * ordinary, and the right answer to "I do not know" here is always the same one
 * as "nothing stored yet".
 */

/** Every key this plugin uses, in one place, all prefixed so they are ours. */
const KEYS = {
	lastSeenVersion: 'signet:last-seen-version',
	updateCheck: 'signet:update-check',
} as const;

function read(app: App, key: string): unknown {
	try {
		return app.loadLocalStorage(key);
	} catch {
		return null;
	}
}

function write(app: App, key: string, value: unknown): void {
	try {
		app.saveLocalStorage(key, value);
	} catch {
		// Nothing to do and nothing worth saying. The cost of not remembering is
		// that the notes are shown once more than they should be.
	}
}

/**
 * The version whose notes this device has already seen, or null for never.
 *
 * Null is what makes a first install silent, so "not stored" and "stored as
 * something unusable" have to give the same answer.
 */
export function lastSeenVersion(app: App): string | null {
	const stored = read(app, KEYS.lastSeenVersion);
	return typeof stored === 'string' && stored !== '' ? stored : null;
}

export function rememberVersion(app: App, version: string): void {
	write(app, KEYS.lastSeenVersion, version);
}

/** When the repository was last asked, and what it said. */
export interface CheckRecord {
	at: number;
	version?: string;
}

export function lastUpdateCheck(app: App): CheckRecord | undefined {
	const stored = read(app, KEYS.updateCheck);
	if (typeof stored !== 'object' || stored === null) {
		return undefined;
	}

	const { at, version } = stored as Record<string, unknown>;
	if (typeof at !== 'number' || !Number.isFinite(at)) {
		return undefined;
	}
	return typeof version === 'string' ? { at, version } : { at };
}

export function rememberUpdateCheck(app: App, record: CheckRecord): void {
	write(app, KEYS.updateCheck, record);
}
