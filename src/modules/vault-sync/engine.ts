import { normalizePath } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { assertVaultPath, ensureFolder, parentFolder, pathExists } from '../../core/vault-fs';
import {
	deriveBlobId,
	deriveContentKey,
	deriveNameKey,
	hashContent,
	isVaultManifest,
	openBlob,
	openSnapshot,
	PROTOCOL_VERSION,
	sealBlob,
	sealSnapshot,
	UnsupportedBlobVersionError,
} from '@signet/protocol';
import type { Bytes, FileEntry, Tombstone, VaultManifest } from '@signet/protocol';
import { buildLocalIndex, isExcluded } from './local-index';
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
 * - An excluded path is never deleted, never downloaded and never dropped from
 *   the manifest. It is absent from the local index by request, which is not a
 *   fact about whether it exists.
 */

/**
 * How long a deletion keeps being announced.
 *
 * A tombstone exists so a device that was away learns the file went rather than
 * re-uploading it. Past the point where every device has certainly been back, it
 * is only weight: the list travels in full inside every single commit, and
 * nothing ever dropped an entry from it.
 */
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * When a run's own conclusion stops being believable.
 *
 * Both have to be passed. The share alone would trip on a small vault, where
 * deleting two of eleven notes is an ordinary afternoon; the count alone would
 * trip on a large one, where clearing out an old folder is equally ordinary.
 */
const MIN_SUSPECT_DELETIONS = 5;
const SUSPECT_DELETION_SHARE = 0.1;

export interface SyncDeps {
	app: App;
	client: SyncClient;
	secret: Bytes;
	device: { id: string; name: string };
	excluded: readonly string[];
	state: SyncState;
	/**
	 * Carry out a run whose deletions would otherwise be refused.
	 *
	 * Somebody does occasionally delete a folder of two hundred notes, and
	 * after being shown the number and agreeing to it they are entitled to be
	 * believed. It is deliberately not a setting: the answer has to be given
	 * for the run in front of them, not once for every run to come.
	 */
	allowBulkDeletion?: boolean;
	/**
	 * Told about every path this run writes, as it writes it.
	 *
	 * The engine writes through the ordinary Vault API, which means every download
	 * and every trashed file raises exactly the `create`/`modify`/`delete` events
	 * the module is listening to in order to notice the *user* editing. Without
	 * this the module cannot tell its own writing apart from somebody typing, and
	 * every download schedules another full run a couple of seconds later.
	 */
	onWrote?: (path: string) => void;
}

/**
 * Raised instead of carrying out a run that would delete most of the vault.
 *
 * Carries numbers rather than a sentence: what to say about it is the settings
 * screen's business, the same way `diff.ts` emits reason codes for its modal.
 */
export class SuspectDeletionError extends Error {
	constructor(
		readonly deletions: number,
		readonly known: number
	) {
		super(`Refused to remove ${String(deletions)} of ${String(known)} known files.`);
		this.name = 'SuspectDeletionError';
	}
}

/**
 * Raised when the server is at an earlier commit than this device has applied.
 *
 * Commits are append-only and a sequence only ever grows, so this cannot happen
 * to a server that has simply been running. It means the server's data was
 * replaced: a restored backup, a wiped volume, a container rebuilt without its
 * storage. Those need opposite answers — a restored backup should be left alone
 * and investigated, a deliberately wiped server wants this device to forget what
 * it last synced — and only a person knows which happened.
 */
export class ServerBehindError extends Error {
	constructor(
		readonly head: number,
		readonly synced: number
	) {
		super(
			`The server is at commit ${String(head)}, behind the ${String(synced)} this device has already synced.`
		);
		this.name = 'ServerBehindError';
	}
}

export interface SyncReport {
	uploaded: string[];
	downloaded: string[];
	trashed: string[];
	conflicts: string[];
	resurrected: string[];
	removedRemotely: string[];
	/**
	 * `code` marks a failure that is about this device rather than this file,
	 * so the caller can say the one useful thing instead of listing notes.
	 */
	failed: { path: string; error: string; code?: 'needsUpdate' }[];
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
		actions: reconcile({
			base: deps.state.base ?? undefined,
			local: entries,
			remote,
			excluded: deps.excluded,
		}),
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

async function writeFile(deps: SyncDeps, path: string, bytes: Bytes): Promise<void> {
	// The one place a path from a remote manifest becomes a file on this disk, and
	// so the one place it has to be checked. Throws rather than returning, and the
	// caller lets it land in `report.failed` beside every other per-file failure.
	const app = deps.app;
	const normalised = assertVaultPath(app, path);
	const existing = app.vault.getFileByPath(normalised);
	const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

	// Announced before the write, not after: the event can reach the module while
	// the write is still settling.
	deps.onWrote?.(normalised);

	if (existing) {
		await app.vault.modifyBinary(existing, buffer);
		return;
	}
	await ensureParent(app, normalised);
	await app.vault.createBinary(normalised, buffer);
}

/**
 * What is on disk at that path right now, or undefined when nothing is.
 *
 * The index built at the top of a run is a photograph, and everything
 * destructive happens some seconds and several network round-trips later. This
 * is the same question asked again, immediately before the write.
 */
async function currentHash(app: App, path: string): Promise<string | undefined> {
	const file = app.vault.getFileByPath(normalizePath(path));
	if (!file) {
		return undefined;
	}
	return hashContent(new Uint8Array(await app.vault.readBinary(file)));
}

/**
 * Fetches one file's contents and checks that they are the ones announced.
 *
 * The hash comparison is the point. AES-GCM proves the bytes were sealed by
 * somebody holding the content key — it says nothing about *which* file they
 * were sealed as, and the server chooses which blob it hands back for a given
 * id. Without this, a server could answer the request for one note with another
 * note's blob, or with an older version of the same one, and the tag would
 * verify either way.
 *
 * The manifest already carries the hash, so the check costs a digest and closes
 * the gap between "these bytes are genuine" and "these bytes are this file".
 */
async function download(deps: SyncDeps, contentKey: CryptoKey, entry: FileEntry): Promise<Bytes> {
	const sealed = await deps.client.getBlob(entry.blob);
	if (!sealed) {
		throw new Error('The server is missing the contents of this file.');
	}

	const plaintext = await openBlob(contentKey, sealed);
	const actual = await hashContent(plaintext);
	if (actual !== entry.hash) {
		throw new Error('The contents the server returned are not the ones this file announced.');
	}
	return plaintext;
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
	report: SyncReport,
	snapshot: ReadonlyMap<string, string>
): Promise<void> {
	const contentKey = await deriveContentKey(deps.secret);
	const now = new Date();

	for (const action of actions) {
		try {
			if (action.kind === 'download') {
				// Fetch first, then ask about the disk, so the gap between deciding
				// and writing is as small as it can be made.
				const bytes = await download(deps, contentKey, action.remote);
				const here = await currentHash(deps.app, action.path);

				if (here !== undefined && here !== snapshot.get(action.path)) {
					// Somebody typed while this run was fetching. The decision to
					// overwrite was made about a file that no longer exists in that
					// form, so it becomes the answer for two changed sides instead.
					const target = conflictPath(action.path, now);
					await writeFile(deps, target, bytes);
					report.conflicts.push(target);
				} else {
					await writeFile(deps, action.path, bytes);
					report.downloaded.push(action.path);
				}
			} else if (action.kind === 'conflict') {
				// The local file is left exactly as it is. The incoming version lands
				// next to it, named the way `patterns.ts` already recognises.
				const target = conflictPath(action.path, now);
				await writeFile(deps, target, await download(deps, contentKey, action.remote));
				report.conflicts.push(target);
			} else if (action.kind === 'deleteLocal') {
				const file = deps.app.vault.getFileByPath(normalizePath(action.path));
				if (file) {
					const before = snapshot.get(action.path);
					const here = await currentHash(deps.app, action.path);

					if (here !== undefined && before !== undefined && here !== before) {
						// Edited since this run began. Work beats a deletion here for the
						// same reason it does in the reconciler; the re-index puts it back
						// into the manifest and the tombstone is dropped.
						report.resurrected.push(action.path);
					} else {
						// Trash, never delete. A wrong deletion has to stay recoverable.
						deps.onWrote?.(action.path);
						await deps.app.fileManager.trashFile(file);
						report.trashed.push(action.path);
					}
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
				...(error instanceof UnsupportedBlobVersionError
					? { code: 'needsUpdate' as const }
					: {}),
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
 * Puts back the manifest entries for paths this device does not sync.
 *
 * `publishBlobs` builds the file list from the local index, and the local index
 * deliberately has no row for an excluded path. Publishing that list as-is would
 * drop the file from the manifest — which every other device reads as "gone from
 * the vault" even without a tombstone. The remote's own entry is the truth for a
 * path nobody here is allowed to speak for, so it travels on unchanged.
 */
function carryExcluded(
	files: readonly FileEntry[],
	remote: VaultManifest | undefined,
	excluded: readonly string[]
): FileEntry[] {
	const listed = new Set(files.map((file) => file.path));
	const carried = (remote?.files ?? []).filter(
		(file) => isExcluded(file.path, excluded) && !listed.has(file.path)
	);

	if (carried.length === 0) {
		return [...files];
	}
	return [...files, ...carried].sort((a, b) => a.path.localeCompare(b.path));
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
	present: ReadonlySet<string>,
	excluded: readonly string[]
): Tombstone[] {
	const tombstones = new Map<string, Tombstone>();
	const now = Date.now();

	for (const tombstone of remote?.deleted ?? []) {
		if (present.has(tombstone.path) || isExcluded(tombstone.path, excluded)) {
			continue;
		}
		// Every device has long since applied a deletion this old, and the list is
		// carried in full inside every commit. Without this it only ever grows.
		if (now - tombstone.deletedAt > TOMBSTONE_TTL_MS) {
			continue;
		}
		tombstones.set(tombstone.path, tombstone);
	}

	for (const action of actions) {
		if (
			action.kind === 'deleteRemote' &&
			!present.has(action.path) &&
			!isExcluded(action.path, excluded)
		) {
			tombstones.set(action.path, { path: action.path, deletedAt: now });
		}
	}

	return [...tombstones.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Second-guesses every deletion this run inferred, before anything acts on one.
 *
 * `deleteRemote` is reached by a file being absent from the local index while the
 * base still lists it — and absence is not evidence. `vault.getFiles()` is
 * Obsidian's index, not the disk, and a phone that has just been woken has a
 * partial one; `src/core/vault-fs.ts` exists because of exactly this. So the disk
 * is asked about every candidate, and one that is still there was never deleted.
 *
 * What survives that is then weighed as a whole. A device does delete things and
 * a handful is ordinary, but a run that has concluded most of the vault is gone
 * has almost certainly been handed a partial index or another device's base. The
 * useful thing to do with a conclusion that large is to refuse to act on it.
 */
async function vetDeletions(
	deps: SyncDeps,
	actions: readonly SyncAction[],
	base: VaultManifest | undefined
): Promise<SyncAction[]> {
	const kept: SyncAction[] = [];
	let deletions = 0;

	for (const action of actions) {
		if (action.kind !== 'deleteRemote') {
			kept.push(action);
			continue;
		}
		if (await pathExists(deps.app, action.path)) {
			// The index had not caught up with the disk. Nobody deleted this.
			continue;
		}
		deletions += 1;
		kept.push(action);
	}

	const known = base?.files.length ?? 0;
	if (
		!deps.allowBulkDeletion &&
		deletions > MIN_SUSPECT_DELETIONS &&
		deletions > known * SUSPECT_DELETION_SHARE
	) {
		throw new SuspectDeletionError(deletions, known);
	}

	return kept;
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

	// A head behind what this device has already applied is the server going
	// backwards, which it has no legitimate reason to do: commits are append-only
	// and a sequence only ever grows. Working from it would reconcile against a
	// manifest that predates this device's own state — every file missing from it
	// re-uploaded, every one that differs kept as a conflicted copy. Restoring a
	// server from an old backup looks exactly like this, and the right answer
	// there is also to stop and say so rather than to churn.
	if (head.seq < deps.state.baseSeq) {
		throw new ServerBehindError(head.seq, deps.state.baseSeq);
	}

	const remote = await fetchRemote(deps, head.seq);

	const before = await buildLocalIndex(deps.app, {
		excluded: deps.excluded,
		cache: deps.state.cache,
	});
	const actions = await vetDeletions(
		deps,
		reconcile({
			base: deps.state.base ?? undefined,
			local: before.entries,
			remote,
			excluded: deps.excluded,
		}),
		deps.state.base ?? undefined
	);

	const snapshot = new Map(before.entries.map((entry) => [entry.path, entry.hash]));
	const report = emptyReport(head.seq);
	await applyLocally(deps, actions, report, snapshot);

	// Re-read: downloads and conflicted copies have changed what is on disk, and
	// the manifest must describe the vault as it actually is now.
	const after = await buildLocalIndex(deps.app, {
		excluded: deps.excluded,
		cache: before.cache,
	});

	const published = await publishBlobs(deps, after.entries, remote, report);
	const files = carryExcluded(published, remote, deps.excluded);
	const present = new Set(files.map((entry) => entry.path));
	const deleted = nextTombstones(remote, actions, present, deps.excluded);

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
