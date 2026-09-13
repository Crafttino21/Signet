import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

/**
 * The two questions the vault index cannot answer on its own.
 *
 * Obsidian's index is not the disk. A sync client — Obsidian's own, iCloud,
 * Syncthing — drops files into an open vault, and until the index catches up
 * they exist and are invisible to `getFileByPath` and `getFolderByPath`. That is
 * not an edge case: it is the ordinary state of a phone that has just been
 * opened, which is also the device this plugin is hardest to debug on.
 *
 * `AGENTS.md` says to use the Vault API rather than the Adapter API, and this is
 * the documented reason to reach past it: the adapter is asked only to answer
 * "is it really there", never to do the reading or writing the Vault API should
 * do. Three files were each solving this differently — one correctly, one by
 * swallowing the exception, one not at all, which is how heartbeats stopped
 * being written. One answer, in one place.
 */

/**
 * Whether something is at that path — the index first, then the disk.
 *
 * Never throws: an adapter that cannot answer is treated as "not there", which
 * is the answer that makes callers do the safe thing.
 */
export async function pathExists(app: App, path: string): Promise<boolean> {
	const normalised = normalizePath(path);
	if (app.vault.getFileByPath(normalised) ?? app.vault.getFolderByPath(normalised)) {
		return true;
	}
	try {
		return await app.vault.adapter.exists(normalised);
	} catch {
		return false;
	}
}

/**
 * Makes sure a folder is there before something is written into it.
 *
 * `createFolder` throws on a folder that is on disk but not indexed, so asking
 * the index alone turns a folder that already exists into an exception — and a
 * caller that logs and moves on then silently never writes its file again.
 */
export async function ensureFolder(app: App, folder: string): Promise<void> {
	const normalised = normalizePath(folder);
	if (normalised === '' || normalised === '/') {
		return;
	}
	if (await pathExists(app, normalised)) {
		return;
	}
	try {
		await app.vault.createFolder(normalised);
	} catch {
		// Another write in the same run may have got there first. Either way the
		// folder is now there, which is all this promised.
	}
}

/** The folder part of a path, or `''` for something at the vault root. */
export function parentFolder(path: string): string {
	const normalised = normalizePath(path);
	const slash = normalised.lastIndexOf('/');
	return slash < 0 ? '' : normalised.slice(0, slash);
}

/**
 * A path that came from somewhere else and is about to be written to.
 *
 * Thrown rather than returned, because every caller's answer is the same — do not
 * write this — and a boolean is the kind of thing a future caller forgets to look
 * at.
 */
export class UnsafePathError extends Error {
	constructor(readonly path: string) {
		super(`Refusing to write outside the vault: ${path}`);
		this.name = 'UnsafePathError';
	}
}

/**
 * Checks that a path is somewhere this plugin may write, and returns it normalised.
 *
 * `normalizePath` is not this. It tidies separators and normalises unicode; it
 * does **not** resolve `..`, and it has no opinion about where a path leads. The
 * sync used it as though it did: a path out of a remote manifest went through it
 * and straight into `createBinary`, with nothing in between.
 *
 * Two things are refused, and they are refused for different reasons.
 *
 * **Leaving the vault** — a `..` segment, or an absolute path. Any segment that is
 * exactly `..` is enough; the question is never "does this escape on balance", it
 * is "is this the shape of a path that escapes". `Notes/../Notes/a.md` normalises
 * to somewhere harmless and is still refused, because a rule that has to do
 * arithmetic to answer is a rule that will one day get the arithmetic wrong.
 *
 * **Entering the config folder** — where Obsidian keeps its plugins. A path like
 * `.obsidian/plugins/x/main.js` is inside the vault and perfectly legal, which is
 * exactly the problem: writing there is writing code that runs on the next start.
 * The sync already never *uploads* the config folder, because `vault.getFiles()`
 * does not list it — but that is a property of the index, it is one-directional,
 * and it was holding the config folder in rather than out.
 *
 * Deliberately not applied to paths this device itself chose. The ring file lives
 * wherever its setting says, and a setting somebody typed is a different question
 * with a different right answer.
 */
export function assertVaultPath(app: App, path: unknown): string {
	if (typeof path !== 'string' || path === '') {
		throw new UnsafePathError(String(path));
	}

	const normalised = normalizePath(path);

	// `normalizePath` turns backslashes into slashes, so a Windows absolute path
	// arrives here as `C:/…` — still absolute, still not ours to write.
	if (normalised.startsWith('/') || /^[a-z]:\//i.test(normalised)) {
		throw new UnsafePathError(path);
	}

	const segments = normalised.split('/');
	if (segments.includes('..')) {
		throw new UnsafePathError(path);
	}

	const config = normalizePath(app.vault.configDir);
	if (normalised === config || normalised.startsWith(`${config}/`)) {
		throw new UnsafePathError(path);
	}

	return normalised;
}
