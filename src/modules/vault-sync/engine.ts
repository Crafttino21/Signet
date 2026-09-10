import { normalizePath } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { ensureFolder, parentFolder } from '../../core/vault-fs';
import {
	deriveBlobId,
	deriveContentKey,
	deriveNameKey,
	isVaultManifest,
	openBlob,
	openSnapshot,
	PROTOCOL_VERSION,
	sealBlob,
	sealSnapshot,
} from '@signet/protocol';
import type { Bytes, FileEntry, Tombstone, VaultManifest } from '@signet/protocol';
import { buildLocalIndex } from './local-index';
import { conflictPath, reconcile } from './reconcile';
import type { IndexEntry, SyncAction } from './reconcile';
import type { SyncClient } from './client';
import type { SyncState } from './state';

/**
 * One sync run.
 *
 * The order is deliberate: pull first, decide, apply locally, then push. Anything
 * arriving from the server is written before this device publishes its own view,
 * so a crash halfway leaves a device that has *more* than it should rather than a
 * server that has lost something.
 *
 * The rules that never bend, whatever else changes here:
 *
 * - A file that both sides changed is never merged and never overwritten. The
 *   incoming version lands beside the local one as a conflicted copy.
 * - Local deletions caused by the server go through the trash, never a hard
 *   delete, so anything wrong is recoverable.
 * - A file this device edited is never removed because another device deleted it.
 */

export interface SyncDeps {
	app: App;
	client: SyncClient;
	secret: Bytes;
	device: { id: string; name: string };
	excluded: readonly string[];
	state: SyncState;
}

export interface SyncReport {
	uploaded: string[];
	downloaded: string[];
	trashed: string[];
	conflicts: string[];
	resurrected: string[];
	removedRemotely: string[];
	failed: { path: string; error: string }[];
	/** The commit this device ended up agreeing with. */
	seq: number;
	pushed: boolean;
}

export function emptyReport(seq: number): SyncReport {
	return {
		uploaded: [],
		downloaded: [],
		trashed: [],
		conflicts: [],
		resurrected: [],
		removedRemotely: [],
		failed: [],
		seq,
		pushed: false,
	};
}

/** What a run would do, without doing any of it. */
export interface SyncPlan {
	actions: SyncAction[];
	remoteSeq: number;
	/** True when this device has never agreed a state with the server. */
	firstRun: boolean;
}

async function fetchRemote(deps: SyncDeps, seq: number): Promise<VaultManifest | undefined> {
	if (seq <= 0) {
		return undefined;
	}
	const manifest = await openSnapshot(deps.secret, await deps.client.commit(seq));
	if (!isVaultManifest(manifest)) {
		throw new Error('The server holds a manifest this version does not understand.');
	}
	return manifest;
}

export async function planSync(deps: SyncDeps): Promise<SyncPlan> {
	const head = await deps.client.head();
	const remote = await fetchRemote(deps, head.seq);
	const { entries } = await buildLocalIndex(deps.app, {
		excluded: deps.excluded,
		cache: deps.state.cache,
	});

	return {
		actions: reconcile({ base: deps.state.base ?? undefined, local: entries, remote }),
		remoteSeq: head.seq,
		firstRun: deps.state.base === null,
	};
}

/**
 * Creates any missing parent folders for a path about to be written.
 *
 * Through the shared helper, which asks the disk as well as the index. Asking
 * the index alone turned a folder another sync client had already created into
 * an exception, and swallowing that exception only hid it — the write that
 * followed then failed on its own.
 */
async function ensureParent(app: App, path: string): Promise<void> {
	await ensureFolder(app, parentFolder(path));
}

async function writeFile(app: App, path: string, bytes: Bytes): Promise<void> {
	const normalised = normalizePath(path);
	const existing = app.vault.getFileByPath(normalised);
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

	if (existing) {
		await app.vault.modifyBinary(existing, buffer);
		return;
	}
	await ensureParent(app, normalised);
	await app.vault.createBinary(normalised, buffer);
}

async function download(deps: SyncDeps, contentKey: CryptoKey, entry: FileEntry): Promise<Bytes> {
	const sealed = await deps.client.getBlob(entry.blob);
	if (!sealed) {
		throw new Error('The server is missing the contents of this file.');
	}
	return openBlob(contentKey, sealed);
}

/**
 * Carries out the local half of a run: everything that changes this device.
 *
 * Each action is attempted on its own, so one unreadable file does not strand the
 * rest — the report says exactly what did and did not happen.
 */
async function applyLocally(
	deps: SyncDeps,
	actions: readonly SyncAction[],
	report: SyncReport
): Promise<void> {
	const contentKey = await deriveContentKey(deps.secret);
	const now = new Date();

	for (const action of actions) {
		try {
			if (action.kind === 'download') {
				await writeFile(
					deps.app,
					action.path,
					await download(deps, contentKey, action.remote)
				);
				report.downloaded.push(action.path);
			} else if (action.kind === 'conflict') {
				// The local file is left exactly as it is. The incoming version lands
				// next to it, named the way `patterns.ts` already recognises.
				const target = conflictPath(action.path, now);
				await writeFile(deps.app, target, await download(deps, contentKey, action.remote));
				report.conflicts.push(target);
			} else if (action.kind === 'deleteLocal') {
				const file = deps.app.vault.getFileByPath(normalizePath(action.path));
				if (file) {
					// Trash, never delete. A wrong deletion has to stay recoverable.
					await deps.app.fileManager.trashFile(file);
					report.trashed.push(action.path);
				}
			} else if (action.kind === 'resurrect') {
				report.resurrected.push(action.path);
			} else if (action.kind === 'deleteRemote') {
				report.removedRemotely.push(action.path);
			}
		} catch (error) {
			report.failed.push({
				path: action.path,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

/**
 * Seals and uploads everything the server does not already hold, then returns the
 * manifest entries describing the vault as it now stands.
 */
async function publishBlobs(
	deps: SyncDeps,
	local: readonly IndexEntry[],
	remote: VaultManifest | undefined,
	report: SyncReport
): Promise<FileEntry[]> {
	const contentKey = await deriveContentKey(deps.secret);
	const nameKey = await deriveNameKey(deps.secret);

	// A hash the server already stores needs no second upload, whatever path it
	// sits at — the same note moved to a new folder costs nothing.
	const known = new Set((remote?.files ?? []).map((file) => file.hash));
	const files: FileEntry[] = [];

	for (const entry of local) {
		const blob = await deriveBlobId(nameKey, entry.hash);
		const manifestEntry: FileEntry = {
			path: entry.path,
			hash: entry.hash,
			blob,
			size: entry.size,
			mtime: entry.mtime,
		};

		if (!known.has(entry.hash)) {
			try {
				const file = deps.app.vault.getFileByPath(normalizePath(entry.path));
				if (!file) {
					continue;
				}
				const plaintext = new Uint8Array(await deps.app.vault.readBinary(file));
				await deps.client.putBlob(blob, await sealBlob(contentKey, plaintext));
				report.uploaded.push(entry.path);
			} catch (error) {
				report.failed.push({
					path: entry.path,
					error: error instanceof Error ? error.message : String(error),
				});
				// Leaving it out of the manifest is the safe failure: the file stays
				// local, and the next run tries again. Listing a blob that is not on
				// the server would make another device fail to fetch it.
				continue;
			}
		}

		files.push(manifestEntry);
	}

	return files;
}

/**
 * Carries forward the tombstones that still apply, and adds this run's own.
 *
 * A tombstone is dropped as soon as the path exists again, so a file that was
 * deliberately brought back does not get deleted a second time on every device.
 */
function nextTombstones(
	remote: VaultManifest | undefined,
	actions: readonly SyncAction[],
	present: ReadonlySet<string>
): Tombstone[] {
	const tombstones = new Map<string, Tombstone>();

	for (const tombstone of remote?.deleted ?? []) {
		if (!present.has(tombstone.path)) {
			tombstones.set(tombstone.path, tombstone);
		}
	}

	const now = Date.now();
	for (const action of actions) {
		if (action.kind === 'deleteRemote' && !present.has(action.path)) {
			tombstones.set(action.path, { path: action.path, deletedAt: now });
		}
	}

	return [...tombstones.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function sameShape(files: readonly FileEntry[], remote: VaultManifest | undefined): boolean {
	const before = new Map((remote?.files ?? []).map((file) => [file.path, file.hash]));
	if (before.size !== files.length) {
		return false;
	}
	return files.every((file) => before.get(file.path) === file.hash);
}

export interface SyncResult {
	report: SyncReport;
	state: SyncState;
}

/**
 * Runs one full sync and returns both what happened and the state to remember.
 *
 * Retries once on a rejected push: a `409` means another device committed while
 * this one was working, which is ordinary rather than exceptional. The retry
 * starts from the top so the newly arrived commit is reconciled properly instead
 * of being pushed over.
 */
export async function runSync(deps: SyncDeps, attempt = 0): Promise<SyncResult> {
	const head = await deps.client.head();
	const remote = await fetchRemote(deps, head.seq);

	const before = await buildLocalIndex(deps.app, {
		excluded: deps.excluded,
		cache: deps.state.cache,
	});
	const actions = reconcile({
		base: deps.state.base ?? undefined,
		local: before.entries,
		remote,
	});

	const report = emptyReport(head.seq);
	await applyLocally(deps, actions, report);

	// Re-read: downloads and conflicted copies have changed what is on disk, and
	// the manifest must describe the vault as it actually is now.
	const after = await buildLocalIndex(deps.app, {
		excluded: deps.excluded,
		cache: before.cache,
	});

	const files = await publishBlobs(deps, after.entries, remote, report);
	const present = new Set(after.entries.map((entry) => entry.path));
	const deleted = nextTombstones(remote, actions, present);

	const unchanged = sameShape(files, remote) && deleted.length === (remote?.deleted.length ?? 0);

	if (unchanged) {
		// Nothing to say; an empty commit would only add noise to the history.
		return {
			report: { ...report, seq: head.seq },
			state: {
				deviceId: deps.device.id,
				baseSeq: head.seq,
				base: remote ?? { ...blankManifest(deps, head.seq), files, deleted },
				cache: after.cache,
			},
		};
	}

	const manifest: VaultManifest = {
		version: PROTOCOL_VERSION,
		seq: head.seq + 1,
		device: deps.device,
		updatedAt: new Date().toISOString(),
		files,
		deleted,
	};

	const outcome = await deps.client.push(head.seq, await sealSnapshot(deps.secret, manifest));

	if (!outcome.ok) {
		if (attempt >= 1) {
			throw new Error('Another device kept committing while this one was syncing.');
		}
		return runSync(deps, attempt + 1);
	}

	return {
		report: { ...report, seq: outcome.seq, pushed: true },
		state: {
			deviceId: deps.device.id,
			baseSeq: outcome.seq,
			base: { ...manifest, seq: outcome.seq },
			cache: after.cache,
		},
	};
}

function blankManifest(deps: SyncDeps, seq: number): VaultManifest {
	return {
		version: PROTOCOL_VERSION,
		seq,
		device: deps.device,
		updatedAt: new Date().toISOString(),
		files: [],
		deleted: [],
	};
}

/** True when a report describes anything the user would want to hear about. */
export function isQuiet(report: SyncReport): boolean {
	return (
		report.uploaded.length === 0 &&
		report.downloaded.length === 0 &&
		report.trashed.length === 0 &&
		report.conflicts.length === 0 &&
		report.failed.length === 0
	);
}

/** Type guard used by the settings screen; kept here beside the shape it checks. */
export function hasFile(app: App, path: string): TFile | null {
	return app.vault.getFileByPath(normalizePath(path));
}
