import { hashContent } from '@toolbox/protocol';
import type { App, TFile } from 'obsidian';
import type { IndexEntry } from './reconcile';

/**
 * What this device currently holds.
 *
 * Hashing every file on every run would make a large vault unusable, so a file
 * whose size and modification time are unchanged since last time keeps its known
 * hash. The cache is only ever an optimisation: a wrong entry can at worst make
 * the sync miss a change, never destroy one, and any real edit moves the mtime.
 *
 * `vault.getFiles()` lists only files Obsidian shows, so the config folder is
 * excluded for free — which is exactly right. `.obsidian` holds per-device state
 * and is the single most conflict-prone thing in a vault.
 */

export interface CacheEntry {
	hash: string;
	mtime: number;
	size: number;
}

export type IndexCache = Record<string, CacheEntry>;

export interface LocalIndex {
	entries: IndexEntry[];
	/** Rebuilt each run, so paths that disappeared do not linger. */
	cache: IndexCache;
}

export function isExcluded(path: string, excluded: readonly string[]): boolean {
	return excluded.some(
		(folder) => folder !== '' && (path === folder || path.startsWith(`${folder}/`))
	);
}

export async function buildLocalIndex(
	app: App,
	options: { excluded: readonly string[]; cache: IndexCache }
): Promise<LocalIndex> {
	const entries: IndexEntry[] = [];
	const cache: IndexCache = {};

	for (const file of app.vault.getFiles()) {
		if (isExcluded(file.path, options.excluded)) {
			continue;
		}

		const known = options.cache[file.path];
		const unchanged = known && known.mtime === file.stat.mtime && known.size === file.stat.size;
		const hash = unchanged ? known.hash : await hashFile(app, file);

		entries.push({ path: file.path, hash, size: file.stat.size, mtime: file.stat.mtime });
		cache[file.path] = { hash, mtime: file.stat.mtime, size: file.stat.size };
	}

	entries.sort((a, b) => a.path.localeCompare(b.path));
	return { entries, cache };
}

async function hashFile(app: App, file: TFile): Promise<string> {
	// Binary for everything, including notes: hashing the raw bytes avoids any
	// question of encoding or line endings changing the hash on one platform.
	return hashContent(new Uint8Array(await app.vault.readBinary(file)));
}
