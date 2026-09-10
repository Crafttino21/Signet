import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeVault } from '../../test/fake-vault';
import { RingFile } from './ring-file';
import type { RingEnvelope } from '@signet/protocol';

/**
 * Finding the ring file, including when Obsidian does not know it is there.
 *
 * The index and the disk are not the same thing. A sync client that drops the ring
 * file into an open vault leaves a file that exists and is not indexed yet — the
 * everyday case on a phone, where the app is opened and the sync lands a second
 * later. Asking the index alone told the user there was no ring to join while the
 * file sat right there, which is the bug these tests hold the line on.
 */

const PATH = 'Signet/plugin-ring.json';

const envelope: RingEnvelope = {
	v: 1,
	ring: 'a'.repeat(64),
	iv: 'AAAAAAAAAAAAAAAA',
	data: 'ZGF0YQ==',
};

function ringFile(vault: FakeVault, path = PATH): RingFile {
	return new RingFile(vault.app as App, path);
}

describe('reading the ring file', () => {
	it('reads one the index knows about', async () => {
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify(envelope));

		await expect(ringFile(vault).read()).resolves.toEqual({ status: 'ok', envelope });
	});

	it('reads one that is on disk but not indexed yet', async () => {
		const vault = new FakeVault();
		// What a sync client leaves behind while Obsidian is already running.
		vault.hidden.set(PATH, JSON.stringify(envelope));
		expect(vault.vault.getFileByPath(PATH)).toBeNull();

		await expect(ringFile(vault).read()).resolves.toEqual({ status: 'ok', envelope });
	});

	it('says absent only when it is genuinely nowhere', async () => {
		const vault = new FakeVault();

		await expect(ringFile(vault).read()).resolves.toEqual({ status: 'absent' });
	});

	it('treats a half-written file as temporary rather than hostile', async () => {
		const vault = new FakeVault();
		// A sync client can be caught mid-write; that is not tampering.
		vault.put(PATH, '{"v":1,"ring":');

		const state = await ringFile(vault).read();
		expect(state.status).toBe('unreadable');
	});

	it('rejects valid JSON that is not a snapshot', async () => {
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify({ hello: 'world' }));

		const state = await ringFile(vault).read();
		expect(state.status).toBe('unreadable');
	});
});

describe('writing the ring file', () => {
	it('creates it, folder and all', async () => {
		const vault = new FakeVault();

		await ringFile(vault).write(envelope);

		expect(JSON.parse(vault.text(PATH) ?? '')).toEqual(envelope);
		expect(vault.folders.has('Signet')).toBe(true);
	});

	it('replaces one the index knows about', async () => {
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify({ v: 1, ring: 'old', iv: 'x', data: 'y' }));

		await ringFile(vault).write(envelope);

		expect(JSON.parse(vault.text(PATH) ?? '')).toEqual(envelope);
	});

	it('writes over one that is on disk but not indexed', async () => {
		const vault = new FakeVault();
		vault.hidden.set(PATH, 'whatever was there');

		// Obsidian's create() refuses a path that exists on disk, so a host whose
		// index had not caught up could otherwise never publish again.
		await expect(ringFile(vault).write(envelope)).resolves.toBeUndefined();
		expect(JSON.parse(vault.hidden.get(PATH) ?? '')).toEqual(envelope);
	});

	it('does not trip over a folder that exists but is not indexed', async () => {
		const vault = new FakeVault();
		// Something is in the folder, so the disk has it — but nothing told the index.
		vault.hidden.set('Signet/something-else.md', 'note');
		expect(vault.vault.getFolderByPath('Signet')).toBeNull();

		await expect(ringFile(vault).write(envelope)).resolves.toBeUndefined();
	});

	it('handles a path with no folder at all', async () => {
		const vault = new FakeVault();

		await ringFile(vault, 'ring.json').write(envelope);

		expect(JSON.parse(vault.text('ring.json') ?? '')).toEqual(envelope);
	});
});

describe('conflicting copies', () => {
	it('finds what a sync client left beside the real file', () => {
		const vault = new FakeVault();
		vault.put(PATH, JSON.stringify(envelope));
		vault.put('Signet/plugin-ring (conflicted copy 2026-09-08 093612).json', '{}');
		vault.put('Signet/notes.md', 'unrelated');
		vault.put('Elsewhere/plugin-ring.json', '{}');

		expect(ringFile(vault).findConflictCopies()).toEqual([
			'Signet/plugin-ring (conflicted copy 2026-09-08 093612).json',
		]);
	});
});
