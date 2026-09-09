// @vitest-environment node

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { secretsMatch, sha256Hex, VaultStore } from './storage';

/**
 * These tests guard the one property the whole design rests on: the server never
 * destroys anything. If any of them starts failing, a client bug can cost notes.
 */

const VAULT = 'a'.repeat(32);
let dir: string;
let store: VaultStore;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'toolbox-store-'));
	store = new VaultStore(dir);
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function commit(text: string): Buffer {
	return Buffer.from(text, 'utf8');
}

describe('registration', () => {
	it('creates a vault once and never re-keys it', async () => {
		await expect(store.register(VAULT, sha256Hex('first'))).resolves.toBe('created');

		// Re-registering must not hand the vault to whoever asked last, or the
		// registration secret alone would be enough to take over someone's vault.
		await expect(store.register(VAULT, sha256Hex('attacker'))).resolves.toBe('exists');
		expect((await store.readAuth(VAULT))?.tokenHash).toBe(sha256Hex('first'));
	});

	it('reports nothing for an unknown vault', async () => {
		await expect(store.readAuth('b'.repeat(32))).resolves.toBeUndefined();
	});
});

describe('commits', () => {
	it('starts empty', async () => {
		await expect(store.readHead(VAULT)).resolves.toEqual({ seq: 0, updatedAt: null });
	});

	it('appends in order and moves the head', async () => {
		await expect(store.appendCommit(VAULT, 0, commit('one'))).resolves.toEqual({
			ok: true,
			seq: 1,
		});
		await expect(store.appendCommit(VAULT, 1, commit('two'))).resolves.toEqual({
			ok: true,
			seq: 2,
		});

		expect((await store.readHead(VAULT)).seq).toBe(2);
		expect((await store.readCommit(VAULT, 1))?.toString('utf8')).toBe('one');
		expect((await store.readCommit(VAULT, 2))?.toString('utf8')).toBe('two');
	});

	it('refuses a push built on an old commit', async () => {
		await store.appendCommit(VAULT, 0, commit('one'));

		// The second device never saw commit 1, so its push must bounce instead of
		// replacing work it has not seen.
		await expect(store.appendCommit(VAULT, 0, commit('stale'))).resolves.toEqual({
			ok: false,
			head: 1,
		});
		expect((await store.readCommit(VAULT, 1))?.toString('utf8')).toBe('one');
	});

	it('keeps every earlier commit readable', async () => {
		for (let i = 0; i < 5; i += 1) {
			await store.appendCommit(VAULT, i, commit(`commit-${String(i + 1)}`));
		}

		// Append-only is the safety net: any past state stays reachable.
		for (let seq = 1; seq <= 5; seq += 1) {
			expect((await store.readCommit(VAULT, seq))?.toString('utf8')).toBe(
				`commit-${String(seq)}`
			);
		}
	});

	it('lets only one of two simultaneous pushes win', async () => {
		const [first, second] = await Promise.all([
			store.appendCommit(VAULT, 0, commit('device-a')),
			store.appendCommit(VAULT, 0, commit('device-b')),
		]);

		// Both built on commit 0; exactly one may succeed, or one device's work
		// would vanish without either of them noticing.
		expect([first?.ok, second?.ok].filter(Boolean)).toHaveLength(1);
		expect((await store.readHead(VAULT)).seq).toBe(1);
	});
});

describe('blobs', () => {
	it('stores and returns bytes unchanged', async () => {
		const bytes = Buffer.from([0, 1, 2, 250, 255]);
		await store.writeBlob(VAULT, 'b'.repeat(64), bytes);

		expect(await store.readBlob(VAULT, 'b'.repeat(64))).toEqual(bytes);
	});

	it('never overwrites an existing blob', async () => {
		const id = 'c'.repeat(64);
		await store.writeBlob(VAULT, id, Buffer.from('original'));
		await store.writeBlob(VAULT, id, Buffer.from('replacement'));

		// Blobs are content-addressed, so a second write for the same id is either
		// identical or a client bug. Either way the stored bytes stay put, because
		// an older commit may still point at them.
		expect((await store.readBlob(VAULT, id))?.toString('utf8')).toBe('original');
	});

	it('reports a missing blob rather than throwing', async () => {
		await expect(store.readBlob(VAULT, 'd'.repeat(64))).resolves.toBeUndefined();
		await expect(store.hasBlob(VAULT, 'd'.repeat(64))).resolves.toBe(false);
	});

	it('spreads blobs over subdirectories', async () => {
		const id = `ab${'0'.repeat(62)}`;
		await store.writeBlob(VAULT, id, Buffer.from('x'));

		// A flat directory of tens of thousands of files gets slow.
		await expect(readFile(join(dir, 'vaults', VAULT, 'blobs', 'ab', id), 'utf8')).resolves.toBe(
			'x'
		);
	});

	it('leaves no temporary files behind', async () => {
		await store.writeBlob(VAULT, 'e'.repeat(64), Buffer.from('x'));
		await store.appendCommit(VAULT, 0, commit('one'));

		const { readdir } = await import('node:fs/promises');
		const entries = await readdir(join(dir, 'vaults', VAULT), { recursive: true });
		expect(entries.filter((name) => String(name).includes('.tmp'))).toEqual([]);
	});
});

describe('secretsMatch', () => {
	it('accepts an identical secret and rejects anything else', () => {
		expect(secretsMatch('abc', 'abc')).toBe(true);
		expect(secretsMatch('abc', 'abd')).toBe(false);
		expect(secretsMatch('abc', 'abcd')).toBe(false);
		expect(secretsMatch('', '')).toBe(true);
	});
});
