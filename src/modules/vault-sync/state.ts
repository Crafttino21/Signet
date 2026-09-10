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
 * The state carries the id of the device that wrote it, and a mismatch is treated
 * as no state at all. That matters because this file lives under the config
 * folder, which some people do sync — and adopting another device's base would
 * make this one believe it had already seen files it never had, which is how a
 * sync deletes things nobody deleted.
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
	constructor(
		private readonly app: App,
		private readonly pluginId: string
	) {}

	private path(): string {
		return normalizePath(
			`${this.app.vault.configDir}/plugins/${this.pluginId}/vault-sync-state.json`
		);
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
		await this.app.vault.adapter.write(this.path(), JSON.stringify(state));
	}

	/** Forgetting the base forces the next run to treat every difference as a conflict. */
	async reset(deviceId: string): Promise<void> {
		await this.save(emptyState(deviceId));
	}
}
