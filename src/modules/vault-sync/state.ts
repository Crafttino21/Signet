import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import type { VaultManifest } from '@signet/protocol';
import type { IndexCache } from './local-index';

/**
 * What this device remembers between runs.
 *
 * `base` is the manifest it last agreed with the server on, and it is what turns
 * a guess into a decision: without it, a file that differs could have been changed
 * on either side, and the reconciler would have to pick a winner.
 *
 * The state carries the id of the device that wrote it **and the vault it is
 * about**, and a mismatch in either is treated as no state at all.
 *
 * The device id matters because this file lives under the config folder, which
 * some people do sync — adopting another device's base would make this one
 * believe it had already seen files it never had, which is how a sync deletes
 * things nobody deleted.
 *
 * The vault id matters because the same device can be in a different ring
 * tomorrow. Every key, the token and the vault id all come out of the ring code,
 * so a new ring is a different vault that starts at commit zero — while this
 * file still claims to have synced commit 294. The run then refuses to go
 * backwards, correctly, and the device can never sync again. A base is only ever
 * about the vault it was taken from.
 */

export interface SyncState {
	deviceId: string;
	/** The commit `base` came from. 0 when nothing has been synced yet. */
	baseSeq: number;
	base: VaultManifest | null;
	cache: IndexCache;
}

export function emptyState(deviceId: string): SyncState {
	return { deviceId, baseSeq: 0, base: null, cache: {} };
}

export class SyncStateStore {
	/**
	 * @param pluginDir Where this plugin actually lives, from `manifest.dir`.
	 *
	 * Not built from the plugin id, which is only the folder name by convention.
	 * They came apart when the plugin was renamed: an install updated in place
	 * keeps the old folder while the manifest declares the new id, and a state
	 * file written to a folder Obsidian is not loading from is a state file
	 * nobody reads — every sync would start again from no base.
	 */
	/**
	 * @param vaultId The vault this state is allowed to describe, when it is
	 * known. Absent only before there is a ring, where there is nothing to guard.
	 */
	constructor(
		private readonly app: App,
		private readonly pluginDir: string,
		private readonly vaultId?: string
	) {}

	private path(): string {
		return normalizePath(`${this.pluginDir}/vault-sync-state.json`);
	}

	async load(deviceId: string): Promise<SyncState> {
		try {
			const raw: unknown = JSON.parse(await this.app.vault.adapter.read(this.path()));
			const state = raw as Partial<SyncState>;

			// Another device's memory is worse than none: it would claim knowledge of
			// files this device has never seen.
			if (state.deviceId !== deviceId || typeof state.baseSeq !== 'number') {
				return emptyState(deviceId);
			}

			// Another vault's memory is worse still, because it is about a server
			// that may legitimately be at commit zero. A state written before this
			// field existed has no vault to name, and is treated the same way: it
			// cannot say which sync it belongs to, so it does not get to speak for
			// this one. Starting without a base is noisy and never destructive.
			const stored = (raw as { vaultId?: unknown }).vaultId;
			if (this.vaultId !== undefined && stored !== this.vaultId) {
				return emptyState(deviceId);
			}

			return {
				deviceId,
				baseSeq: state.baseSeq,
				base: state.base ?? null,
				cache: state.cache ?? {},
			};
		} catch {
			return emptyState(deviceId);
		}
	}

	async save(state: SyncState): Promise<void> {
		// Stamped on the way out rather than carried through the engine: which vault
		// a run was against is the store's business, and nothing in the reconciler
		// has any use for it.
		await this.app.vault.adapter.write(
			this.path(),
			JSON.stringify({ ...state, vaultId: this.vaultId })
		);
	}

	/** Forgetting the base forces the next run to treat every difference as a conflict. */
	async reset(deviceId: string): Promise<void> {
		await this.save(emptyState(deviceId));
	}
}
