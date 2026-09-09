// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import {
	deriveAuthToken,
	deriveVaultId,
	generateRingSecret,
	hashAuthToken,
} from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { createSyncServer } from '../../../packages/server/src/http';
import { VaultStore } from '../../../packages/server/src/storage';
import { FakeVault } from '../../test/fake-vault';
import { SyncClient } from './client';
import { runSync } from './engine';
import type { SyncReport } from './engine';
import { SyncStateStore } from './state';

/**
 * Two devices, one real server, real encryption, over a real socket.
 *
 * Everything else in this module is tested in isolation, which proves each part
 * behaves — but a sync only earns trust when two independent copies of a vault
 * actually agree at the end. These are the cases that decide whether someone
 * loses a note.
 */

const REGISTRATION_SECRET = 'r'.repeat(32);

let dir: string;
let base: string;
let close: () => Promise<void>;
let secret: Bytes;

class Device {
	readonly vault = new FakeVault();

	constructor(readonly name: string) {}

	private client(): SyncClient {
		return new SyncClient(base, vaultId, token);
	}

	private store(): SyncStateStore {
		return new SyncStateStore(this.vault.app as App, 'toolbox');
	}

	/** One full run, remembering the resulting state the way the module does. */
	async sync(): Promise<SyncReport> {
		const store = this.store();
		const { report, state } = await runSync({
			app: this.vault.app as App,
			client: this.client(),
			secret,
			device: { id: this.name, name: this.name },
			excluded: [],
			state: await store.load(this.name),
		});
		await store.save(state);
		return report;
	}
}

let vaultId: string;
let token: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'toolbox-sync-'));

	const server = createSyncServer(
		{
			host: '127.0.0.1',
			port: 0,
			dataDir: dir,
			registrationSecret: REGISTRATION_SECRET,
			maxBlobBytes: 1024 * 1024,
			maxManifestBytes: 1024 * 1024,
		},
		new VaultStore(dir)
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
	close = () => new Promise<void>((resolve) => server.close(() => resolve()));

	secret = generateRingSecret();
	vaultId = await deriveVaultId(secret);
	token = await deriveAuthToken(secret);

	await new SyncClient(base, vaultId, token).register(
		REGISTRATION_SECRET,
		await hashAuthToken(token)
	);
});

afterAll(async () => {
	await close();
	await rm(dir, { recursive: true, force: true });
});

describe('two devices', () => {
	const desktop = new Device('desktop');
	const phone = new Device('phone');

	it("carries the first device's notes to the second", async () => {
		desktop.vault.put('Arbeit/Aktueller Arbeit.md', '# Arbeit\n\nErste Fassung.\n');
		desktop.vault.put('Privater Stuff/Wunschliste.md', '- Kaffee\n');

		const sent = await desktop.sync();
		expect(sent.uploaded).toHaveLength(2);

		const received = await phone.sync();
		expect(received.downloaded.sort()).toEqual([
			'Arbeit/Aktueller Arbeit.md',
			'Privater Stuff/Wunschliste.md',
		]);
		expect(phone.vault.text('Arbeit/Aktueller Arbeit.md')).toBe('# Arbeit\n\nErste Fassung.\n');
	});

	it('carries an edit back the other way', async () => {
		phone.vault.put('Privater Stuff/Wunschliste.md', '- Kaffee\n- Milch\n');
		await phone.sync();

		const pulled = await desktop.sync();
		expect(pulled.downloaded).toEqual(['Privater Stuff/Wunschliste.md']);
		expect(desktop.vault.text('Privater Stuff/Wunschliste.md')).toBe('- Kaffee\n- Milch\n');
	});

	it('says nothing when there is nothing to do', async () => {
		const quiet = await desktop.sync();

		expect(quiet.uploaded).toEqual([]);
		expect(quiet.downloaded).toEqual([]);
		expect(quiet.pushed).toBe(false);
	});

	it('keeps both versions when both devices edited the same note', async () => {
		// Neither has seen the other's change: the situation no sync can resolve
		// on its own, and the one where guessing costs a note.
		desktop.vault.put('Arbeit/Aktueller Arbeit.md', '# Arbeit\n\nVom Desktop.\n');
		phone.vault.put('Arbeit/Aktueller Arbeit.md', '# Arbeit\n\nVom Handy.\n');

		await desktop.sync();
		const report = await phone.sync();

		expect(report.conflicts).toHaveLength(1);
		// The phone's own work is untouched...
		expect(phone.vault.text('Arbeit/Aktueller Arbeit.md')).toBe('# Arbeit\n\nVom Handy.\n');
		// ...and the desktop's version arrived beside it rather than over it.
		const copy = report.conflicts[0] ?? '';
		expect(phone.vault.text(copy)).toBe('# Arbeit\n\nVom Desktop.\n');
		expect(copy).toContain('conflicted copy');
	});

	it('gives the conflicted copy back to the other device too', async () => {
		await phone.sync();
		const report = await desktop.sync();

		// Both devices end up holding both versions, so whichever one the user
		// opens next, nothing has been lost.
		expect(report.downloaded.some((path) => path.includes('conflicted copy'))).toBe(true);
	});

	it('moves a note to the trash when the other device deleted it', async () => {
		phone.vault.remove('Privater Stuff/Wunschliste.md');
		await phone.sync();

		const report = await desktop.sync();

		expect(report.trashed).toEqual(['Privater Stuff/Wunschliste.md']);
		// Trashed, not deleted: a wrong deletion has to stay recoverable.
		expect(desktop.vault.trashed).toContain('Privater Stuff/Wunschliste.md');
		expect(desktop.vault.text('Privater Stuff/Wunschliste.md')).toBeUndefined();
	});

	it('keeps a note the other device deleted if this one edited it', async () => {
		desktop.vault.put('Arbeit/Notiz.md', 'Von beiden gesehen.\n');
		await desktop.sync();
		await phone.sync();

		phone.vault.remove('Arbeit/Notiz.md');
		await phone.sync();

		// The desktop worked on it in the meantime. Work beats a deletion.
		desktop.vault.put('Arbeit/Notiz.md', 'Wichtige Ergaenzung.\n');
		const report = await desktop.sync();

		expect(report.resurrected).toEqual(['Arbeit/Notiz.md']);
		expect(desktop.vault.text('Arbeit/Notiz.md')).toBe('Wichtige Ergaenzung.\n');

		// And it comes back on the device that deleted it, rather than staying gone.
		await phone.sync();
		expect(phone.vault.text('Arbeit/Notiz.md')).toBe('Wichtige Ergaenzung.\n');
	});

	it('never lets a device with no memory delete anything', async () => {
		// A phone that reinstalled the plugin knows nothing; it must not read its
		// own emptiness as "the user deleted everything".
		const fresh = new Device('fresh-device');
		const report = await fresh.sync();

		expect(report.trashed).toEqual([]);
		expect(report.downloaded.length).toBeGreaterThan(0);
		expect(fresh.vault.text('Arbeit/Notiz.md')).toBe('Wichtige Ergaenzung.\n');
	});

	it('leaves the two devices holding exactly the same notes', async () => {
		await desktop.sync();
		await phone.sync();
		await desktop.sync();

		expect([...phone.vault.files.keys()].sort()).toEqual(
			[...desktop.vault.files.keys()].sort()
		);
	});
});

describe('a device that has only the ring code', () => {
	/**
	 * The whole point of deriving every key from the ring code: a second device has
	 * nothing left to arrange. The registration secret creates the vault once, on
	 * the host, and is a server-wide credential that has no business travelling to
	 * a phone. What follows is the check that replaces it.
	 */

	it('is recognised by the server without a registration secret', async () => {
		const joiner = new SyncClient(base, vaultId, await deriveAuthToken(secret));

		await expect(joiner.belongs()).resolves.toBe(true);
	});

	it('is turned away when it holds a different ring code', async () => {
		const stranger = generateRingSecret();
		const client = new SyncClient(
			base,
			await deriveVaultId(stranger),
			await deriveAuthToken(stranger)
		);

		// Not an error: the vault is simply not this one's, which is the same answer
		// the server gives for a vault that does not exist. It must not be possible
		// to tell those apart from outside.
		await expect(client.belongs()).resolves.toBe(false);
	});

	it('can sync straight away, with no registration of its own', async () => {
		const joiner = new Device('joined-with-code-only');
		const report = await joiner.sync();

		expect(report.downloaded.length).toBeGreaterThan(0);
		expect(joiner.vault.text('Arbeit/Notiz.md')).toBe('Wichtige Ergaenzung.\n');
	});
});
