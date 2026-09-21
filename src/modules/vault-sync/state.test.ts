import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeVault } from '../../test/fake-vault';
import { SyncStateStore } from './state';
import type { SyncState } from './state';

/**
 * What this device is allowed to remember, and about what.
 *
 * A base is the one thing that turns a guess into a decision, which is exactly
 * why a base from somewhere else is worse than none at all. Two of them are
 * "somewhere else": another device, and another vault.
 *
 * The second one cost a working sync. Rebuilding the server and creating a new
 * ring gives a vault that legitimately starts at commit zero — while this file
 * still claimed to have synced commit 294. The run then refused to go backwards,
 * correctly, and said so on every attempt, for good. Nothing could clear it from
 * inside the app.
 */

const DIR = '.obsidian/plugins/signet';
const VAULT = 'a'.repeat(32);
const OTHER_VAULT = 'b'.repeat(32);

function store(vault: FakeVault, vaultId?: string): SyncStateStore {
	return new SyncStateStore(vault.app as App, DIR, vaultId);
}

function synced(deviceId: string, baseSeq: number): SyncState {
	return {
		deviceId,
		baseSeq,
		base: {
			version: 1,
			seq: baseSeq,
			device: { id: deviceId, name: deviceId },
			updatedAt: '2026-09-21T12:00:00.000Z',
			files: [],
			deleted: [],
		},
		cache: {},
	};
}

describe('a state written for this device and this vault', () => {
	it('comes back as it was saved', async () => {
		const vault = new FakeVault();
		await store(vault, VAULT).save(synced('desktop', 294));

		const loaded = await store(vault, VAULT).load('desktop');

		expect(loaded.baseSeq).toBe(294);
		expect(loaded.base).not.toBeNull();
	});
});

describe('a state from a different vault', () => {
	it('is treated as no state at all', async () => {
		// The ring changed, so every key and the vault id changed with it. The new
		// vault starts at commit zero and this base describes commits it never had.
		const vault = new FakeVault();
		await store(vault, OTHER_VAULT).save(synced('desktop', 294));

		const loaded = await store(vault, VAULT).load('desktop');

		expect(loaded.baseSeq).toBe(0);
		expect(loaded.base).toBeNull();
	});

	it('does not let a stale base block the next ring forever', async () => {
		// The failure this prevents: `runSync` refuses a server whose head is
		// behind the base, which is right for a restored backup and fatal for a
		// new ring. Without the check there is no way out from inside the app.
		const vault = new FakeVault();
		await store(vault, OTHER_VAULT).save(synced('desktop', 294));

		const loaded = await store(vault, VAULT).load('desktop');

		expect(loaded.baseSeq).toBeLessThanOrEqual(0);
	});
});

describe('a state written before it said which vault it was about', () => {
	it('is not trusted either', async () => {
		// It cannot say which sync it belongs to, and starting without a base is
		// noisy rather than destructive: every difference becomes a conflict and
		// nothing is deleted.
		const vault = new FakeVault();
		await vault.adapter.write(
			`${DIR}/vault-sync-state.json`,
			JSON.stringify(synced('desktop', 294))
		);

		const loaded = await store(vault, VAULT).load('desktop');

		expect(loaded.baseSeq).toBe(0);
	});

	it('is still read when there is no vault to compare it to', async () => {
		// Before there is a ring there is nothing to guard, and refusing the state
		// there would throw away a base for no reason.
		const vault = new FakeVault();
		await vault.adapter.write(
			`${DIR}/vault-sync-state.json`,
			JSON.stringify(synced('desktop', 294))
		);

		const loaded = await store(vault).load('desktop');

		expect(loaded.baseSeq).toBe(294);
	});
});

describe('a state from a different device', () => {
	it('is still refused, vault or no vault', async () => {
		// This file lives under the config folder, which some people sync.
		const vault = new FakeVault();
		await store(vault, VAULT).save(synced('desktop', 294));

		const loaded = await store(vault, VAULT).load('phone');

		expect(loaded.deviceId).toBe('phone');
		expect(loaded.baseSeq).toBe(0);
	});
});

describe('resetting', () => {
	it('leaves nothing for the next run to act on', async () => {
		const vault = new FakeVault();
		await store(vault, VAULT).save(synced('desktop', 294));

		await store(vault, VAULT).reset('desktop');
		const loaded = await store(vault, VAULT).load('desktop');

		expect(loaded.baseSeq).toBe(0);
		expect(loaded.base).toBeNull();
		expect(loaded.cache).toEqual({});
	});
});
