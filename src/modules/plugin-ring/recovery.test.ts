// @vitest-environment node
// jsdom does not provide crypto.subtle, and telling a foreign ring file from a
// broken one is a question about real envelopes.

import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { generateRingSecret, sealSnapshot } from '@signet/protocol';
import { FakeVault } from '../../test/fake-vault';
import { classifyRingFile, RingFile } from './ring-file';
import type { RingSnapshot } from './types';

/**
 * The state that stranded a real host: a ring was created afresh while the file
 * of an earlier ring was still lying at the same path. It does not decrypt, so
 * publishing stopped at it — and stopped there again on every later attempt, with
 * nothing in the interface saying why or offering a way out.
 *
 * Telling the three cases apart is what makes a way out safe: only a file that is
 * demonstrably not ours may be moved aside.
 */

const PATH = 'Signet/plugin-ring.json';

const snapshot: RingSnapshot = {
	version: 1,
	seq: 3,
	host: { id: 'device-a', name: 'Desktop' },
	updatedAt: '2026-09-09T20:00:00.000Z',
	plugins: [],
};

function ringFile(vault: FakeVault): RingFile {
	return new RingFile(vault.app as App, PATH);
}

describe('classifying the ring file', () => {
	it('calls an empty path free', async () => {
		const vault = new FakeVault();
		const state = await ringFile(vault).read();

		await expect(classifyRingFile(state, generateRingSecret())).resolves.toBe('free');
	});

	it('recognises its own ring', async () => {
		const secret = generateRingSecret();
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify(await sealSnapshot(secret, snapshot)));

		const state = await ringFile(vault).read();
		await expect(classifyRingFile(state, secret)).resolves.toBe('ours');
	});

	it('recognises another ring without trying to decrypt it', async () => {
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify(await sealSnapshot(generateRingSecret(), snapshot)));

		const state = await ringFile(vault).read();
		await expect(classifyRingFile(state, generateRingSecret())).resolves.toBe('foreign');
	});

	it('does not call a damaged file of its own foreign', async () => {
		// The distinction that matters: `foreign` may be moved aside, `corrupt` may
		// not be, because a file that only looks broken is still the ring.
		const secret = generateRingSecret();
		const vault = new FakeVault();
		const envelope = await sealSnapshot(secret, snapshot);
		vault.put(PATH, JSON.stringify({ ...envelope, data: `${envelope.data.slice(4)}AAAA` }));

		const state = await ringFile(vault).read();
		await expect(classifyRingFile(state, secret)).resolves.toBe('corrupt');
	});

	it('treats something that is not an envelope at all as corrupt', async () => {
		const vault = new FakeVault();
		vault.put(PATH, '{"hello":"world"}');

		const state = await ringFile(vault).read();
		await expect(classifyRingFile(state, generateRingSecret())).resolves.toBe('corrupt');
	});
});

describe('moving a ring file aside', () => {
	it('trashes it rather than deleting it', async () => {
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify(await sealSnapshot(generateRingSecret(), snapshot)));

		await expect(ringFile(vault).trashExisting()).resolves.toBe(true);
		expect(vault.trashed).toEqual([PATH]);
		expect(vault.text(PATH)).toBeUndefined();
	});

	it('reports a clear path as clear', async () => {
		const vault = new FakeVault();

		await expect(ringFile(vault).trashExisting()).resolves.toBe(true);
		expect(vault.trashed).toEqual([]);
	});

	it('refuses a file the index has not caught up with', async () => {
		// Trashing needs a TFile. Writing over it through the adapter instead would
		// destroy the very file being protected, so this says no and waits.
		const vault = new FakeVault();
		vault.hidden.set(PATH, JSON.stringify(await sealSnapshot(generateRingSecret(), snapshot)));

		await expect(ringFile(vault).trashExisting()).resolves.toBe(false);
		expect(vault.trashed).toEqual([]);
		expect(vault.hidden.has(PATH)).toBe(true);
	});
});
