import type { FileEntry, VaultManifest } from '@signet/protocol';

/**
 * Deciding what a sync run should do.
 *
 * This is a three-way comparison, not a two-way one, and that difference is the
 * whole point. Comparing only local against remote can tell you that they differ
 * but never *who* changed — so it has to guess, and the usual guess is "newer
 * wins", which is exactly the mechanism that quietly eats a note.
 *
 * With a third input — the state this device last successfully synced — the
 * question becomes answerable. If the local side still matches that base, only the
 * remote moved, so pull. If the remote still matches it, only we moved, so push.
 * If both moved, nobody can decide but the user, so both versions are kept.
 *
 * Nothing here reads or writes a file. It only produces a list of intentions,
 * which makes every awkward case something a test can pin down.
 */

/** One local file as the index sees it. */
export interface IndexEntry {
	path: string;
	hash: string;
	size: number;
	mtime: number;
}

export type SyncAction =
	/** Send a local file the server does not have, or has an older version of. */
	| { kind: 'upload'; path: string }
	/** Fetch a file this device is missing or behind on. */
	| { kind: 'download'; path: string; remote: FileEntry }
	/** The remote deleted it and we had not touched it. Goes to the trash. */
	| { kind: 'deleteLocal'; path: string }
	/** We deleted it; tell the others. */
	| { kind: 'deleteRemote'; path: string }
	/** Both sides changed. Keep both and let the user decide. */
	| { kind: 'conflict'; path: string; remote: FileEntry }
	/** The remote deleted it but we changed it since. Keep ours and put it back. */
	| { kind: 'resurrect'; path: string };

export interface ReconcileInput {
	/**
	 * What this device saw at the end of its last successful sync. Absent on a
	 * first run, or when the stored base belongs to a different device.
	 */
	base?: VaultManifest;
	local: readonly IndexEntry[];
	/** The server's current manifest. Absent when the vault is empty. */
	remote?: VaultManifest;
}

function byPath(files: readonly FileEntry[]): Map<string, FileEntry> {
	return new Map(files.map((file) => [file.path, file]));
}

function deletedPaths(manifest: VaultManifest | undefined): Set<string> {
	return new Set(manifest?.deleted.map((tombstone) => tombstone.path) ?? []);
}

export function reconcile(input: ReconcileInput): SyncAction[] {
	const base = byPath(input.base?.files ?? []);
	const local = new Map(input.local.map((entry) => [entry.path, entry]));
	const remote = byPath(input.remote?.files ?? []);
	const remoteDeleted = deletedPaths(input.remote);

	const paths = new Set([...base.keys(), ...local.keys(), ...remote.keys(), ...remoteDeleted]);
	const actions: SyncAction[] = [];

	for (const path of [...paths].sort()) {
		const wasSynced = base.get(path);
		const here = local.get(path);
		const there = remote.get(path);

		if (here && there) {
			if (here.hash === there.hash) {
				continue; // Already agreed.
			}
			if (wasSynced && here.hash === wasSynced.hash) {
				actions.push({ kind: 'download', path, remote: there });
			} else if (wasSynced && there.hash === wasSynced.hash) {
				actions.push({ kind: 'upload', path });
			} else {
				// Either both moved, or there is no base to judge by. Without proof
				// of who changed, discarding a side would be a guess.
				actions.push({ kind: 'conflict', path, remote: there });
			}
			continue;
		}

		if (here && !there) {
			if (!remoteDeleted.has(path)) {
				actions.push({ kind: 'upload', path });
			} else if (wasSynced && here.hash === wasSynced.hash) {
				// Deleted elsewhere, untouched here, so the deletion is safe to follow.
				actions.push({ kind: 'deleteLocal', path });
			} else {
				// Deleted elsewhere but edited here. Work beats a deletion.
				actions.push({ kind: 'resurrect', path });
			}
			continue;
		}

		if (!here && there) {
			if (wasSynced) {
				// We had it and it is gone, so this device deleted it.
				actions.push({ kind: 'deleteRemote', path });
			} else {
				actions.push({ kind: 'download', path, remote: there });
			}
			continue;
		}

		// Absent on both sides: either never here, or both deleted it.
	}

	return actions;
}

/** Actions that change something on this device, for the confirmation prompt. */
export function touchesLocalFiles(actions: readonly SyncAction[]): SyncAction[] {
	return actions.filter(
		(action) =>
			action.kind === 'download' ||
			action.kind === 'deleteLocal' ||
			action.kind === 'conflict'
	);
}

/**
 * The name a pulled version gets when both sides changed.
 *
 * Deliberately shaped like the conflict copies other sync tools leave behind, so
 * `patterns.ts` in this same module already knows how to find them and the panel
 * can count them. A copy nobody looks at is the same as a lost edit.
 */
export function conflictPath(path: string, when: Date): string {
	const stamp = when.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '');
	const dot = path.lastIndexOf('.');
	const slash = path.lastIndexOf('/');

	const hasExtension = dot > slash + 1;
	const stem = hasExtension ? path.slice(0, dot) : path;
	const extension = hasExtension ? path.slice(dot) : '';

	return `${stem} (conflicted copy ${stamp})${extension}`;
}
