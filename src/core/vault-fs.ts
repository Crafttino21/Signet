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
