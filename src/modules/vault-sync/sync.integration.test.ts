// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import {
	deriveAuthToken,
	deriveBlobId,
	deriveContentKey,
	deriveNameKey,
	deriveVaultId,
	generateRingSecret,
	hashAuthToken,
	hashContent,
	sealBlob,
	sealSnapshot,
} from '@signet/protocol';
import type { Bytes } from '@signet/protocol';
import { createSyncServer } from '../../../packages/server/src/http';
import { VaultStore } from '../../../packages/server/src/storage';
import { FakeVault } from '../../test/fake-vault';
import { SyncClient } from './client';
import { runSync, SuspectDeletionError } from './engine';
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
	/**
	 * Runs after each blob comes back and before the engine writes it.
	 *
	 * The gap between deciding to overwrite a file and actually overwriting it is
	 * several network round-trips wide, and what a person types inside it used to
	 * be lost without trace. This is the only way to stand in that gap.
	 */
	whileFetching: (() => void) | undefined;

	constructor(readonly name: string) {}

	private client(): SyncClient {
		const client = new SyncClient(base, vaultId, token);
		const hook = this.whileFetching;
		if (!hook) {
			return client;
		}

		const inner = client.getBlob.bind(client);
		client.getBlob = async (blobId: string): Promise<Uint8Array | undefined> => {
			const bytes = await inner(blobId);
			hook();
			return bytes;
		};
		return client;
	}

	private store(): SyncStateStore {
		return new SyncStateStore(this.vault.app as App, '.obsidian/plugins/signet');
	}

	/** One full run, remembering the resulting state the way the module does. */
	async sync(excluded: readonly string[] = []): Promise<SyncReport> {
		const store = this.store();
		const { report, state } = await runSync({
			app: this.vault.app as App,
			client: this.client(),
			secret,
			device: { id: this.name, name: this.name },
			excluded,
			state: await store.load(this.name),
		});
		await store.save(state);
		return report;
	}
}

let vaultId: string;
let token: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'signet-sync-'));

	const server = createSyncServer(
		{
			host: '127.0.0.1',
			port: 0,
			dataDir: dir,
			registrationSecret: REGISTRATION_SECRET,
			maxBlobBytes: 1024 * 1024,
			maxManifestBytes: 1024 * 1024,
			maxVaultBytes: 0,
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

describe('a device in the ring that sends something it should not', () => {
	/**
	 * The ring code is the key to everything, so a device holding it is trusted to
	 * sync notes. That is not the same as being trusted to choose where on another
	 * machine a file lands.
	 *
	 * A manifest is sealed with the ring secret, so only such a device can produce
	 * one — which is why this is written as a device in the ring rather than as a
	 * hostile server. A lost phone is a likelier thing than a broken cipher.
	 */

	/** Puts a manifest on the server by hand, with a blob to match each entry. */
	async function publish(files: { path: string; text: string }[]): Promise<void> {
		const client = new SyncClient(base, vaultId, token);
		const contentKey = await deriveContentKey(secret);
		const nameKey = await deriveNameKey(secret);

		const entries = [];
		for (const file of files) {
			const bytes = new TextEncoder().encode(file.text);
			const hash = await hashContent(bytes);
			const blob = await deriveBlobId(nameKey, hash);
			await client.putBlob(blob, await sealBlob(contentKey, bytes));
			entries.push({ path: file.path, hash, blob, size: bytes.byteLength, mtime: 1 });
		}

		const head = await client.head();
		const outcome = await client.push(
			head.seq,
			await sealSnapshot(secret, {
				version: 1,
				seq: head.seq + 1,
				device: { id: 'hostile', name: 'Hostile' },
				updatedAt: new Date().toISOString(),
				files: entries,
				deleted: [],
			})
		);
		expect(outcome.ok).toBe(true);
	}

	it('does not let a path climb out of the vault', async () => {
		await publish([
			{ path: '../escaped.md', text: 'should never be written\n' },
			{ path: 'Legit/Fine.md', text: 'this one is ordinary\n' },
		]);

		const victim = new Device('victim');
		const report = await victim.sync();

		// Reported per file, like any other failure, and the rest of the run goes
		// through — one bad entry must not strand the notes beside it.
		expect(report.failed.map((failure) => failure.path)).toContain('../escaped.md');
		expect(victim.vault.text('Legit/Fine.md')).toBe('this one is ordinary\n');

		for (const path of victim.vault.files.keys()) {
			expect(path).not.toContain('escaped');
		}
	});

	it('does not let a path reach into the config folder', async () => {
		// Inside the vault, entirely legal as a path, and a file written there is
		// code that runs on the next start.
		await publish([{ path: '.obsidian/plugins/evil/main.js', text: 'pwned\n' }]);

		const victim = new Device('victim-config');
		const report = await victim.sync();

		expect(report.failed.map((failure) => failure.path)).toContain(
			'.obsidian/plugins/evil/main.js'
		);
		expect(victim.vault.text('.obsidian/plugins/evil/main.js')).toBeUndefined();
	});
});

describe('a server that answers with the wrong bytes', () => {
	/**
	 * The server is not trusted, and AES-GCM alone does not make it trustworthy.
	 * A tag proves the bytes were sealed by somebody with the content key; it says
	 * nothing about *which* file they were sealed as, and the server picks which
	 * blob it returns for a given id. So it can answer the request for one note
	 * with another note's blob, or with an older version of the same one, and
	 * every cryptographic check still passes.
	 *
	 * The manifest already carries the hash. It simply was not compared.
	 */
	it('is not believed when the contents do not match the manifest', async () => {
		const client = new SyncClient(base, vaultId, token);
		const contentKey = await deriveContentKey(secret);
		const nameKey = await deriveNameKey(secret);

		const announced = new TextEncoder().encode('what the manifest says\n');
		const substituted = new TextEncoder().encode('what the server returns\n');

		// The id is derived from the announced content, as an honest client would —
		// then a different note's ciphertext is stored under it.
		const hash = await hashContent(announced);
		const blob = await deriveBlobId(nameKey, hash);
		await client.putBlob(blob, await sealBlob(contentKey, substituted));

		const head = await client.head();
		await client.push(
			head.seq,
			await sealSnapshot(secret, {
				version: 1,
				seq: head.seq + 1,
				device: { id: 'swapper', name: 'Swapper' },
				updatedAt: new Date().toISOString(),
				files: [{ path: 'Swapped.md', hash, blob, size: announced.byteLength, mtime: 1 }],
				deleted: [],
			})
		);

		const victim = new Device('victim-swap');
		const report = await victim.sync();

		expect(report.failed.map((failure) => failure.path)).toContain('Swapped.md');
		expect(victim.vault.text('Swapped.md')).toBeUndefined();
	});
});

describe('a server that goes backwards', () => {
	it('is refused rather than reconciled against', async () => {
		// Commits are append-only and a sequence only grows, so a head behind what
		// this device has applied is the server having lost history — a restore
		// from an old backup looks exactly like this. Reconciling against it would
		// re-upload everything missing and keep a conflicted copy of everything
		// that differs.
		const device = new Device('time-traveller');
		await device.sync();

		// Only `head` is reached, because that is where the refusal happens — so a
		// stub that answers it and nothing else is the honest shape of this test.
		const rolled = {
			head: () => Promise.resolve({ seq: 0, updatedAt: null }),
		} as unknown as SyncClient;

		const store = new SyncStateStore(device.vault.app as App, '.obsidian/plugins/signet');
		await expect(
			runSync({
				app: device.vault.app as App,
				client: rolled,
				secret,
				device: { id: 'time-traveller', name: 'time-traveller' },
				excluded: [],
				state: await store.load('time-traveller'),
			})
		).rejects.toThrow(/behind/);
	});
});

describe('a note that is excluded while it is being worked on', () => {
	const one = new Device('exclude-one');
	const two = new Device('exclude-two');

	// This is the shape of the live-editing hand-off: a note is claimed by a
	// collaborative session, the file sync is told to leave it alone, and the very
	// next run has to not read that silence as "the user deleted it".

	it('stays on every other device', async () => {
		one.vault.put('Gemeinsam.md', 'Erste Fassung.\n');
		await one.sync();
		await two.sync();
		expect(two.vault.text('Gemeinsam.md')).toBe('Erste Fassung.\n');

		// The note is now live on device one, so it drops out of its index.
		const report = await one.sync(['Gemeinsam.md']);
		expect(report.removedRemotely).toEqual([]);

		const after = await two.sync();
		expect(after.trashed).toEqual([]);
		expect(two.vault.trashed).not.toContain('Gemeinsam.md');
		expect(two.vault.text('Gemeinsam.md')).toBe('Erste Fassung.\n');
	});

	it('is still there once the session lets it go', async () => {
		// The manifest kept carrying it, so nothing has to be re-uploaded and the
		// other device never saw a gap.
		const report = await one.sync();

		expect(report.uploaded).toEqual([]);
		expect(report.trashed).toEqual([]);
		expect(one.vault.text('Gemeinsam.md')).toBe('Erste Fassung.\n');
	});

	it('does not pull an excluded folder onto a fresh device', async () => {
		one.vault.put('Geheim/Tagebuch.md', 'Nur hier.\n');
		await one.sync();

		const fresh = new Device('exclude-three');
		const report = await fresh.sync(['Geheim']);

		expect(report.downloaded).not.toContain('Geheim/Tagebuch.md');
		expect(fresh.vault.text('Geheim/Tagebuch.md')).toBeUndefined();
		// And it did not take the chance to delete it for everybody either.
		expect(one.vault.text('Geheim/Tagebuch.md')).toBe('Nur hier.\n');
	});
});

describe('a vault index that has not caught up', () => {
	const one = new Device('index-one');
	const two = new Device('index-two');

	it('does not read its own blind spot as a deletion', async () => {
		one.vault.put('Zettel/Eins.md', 'Eins\n');
		one.vault.put('Zettel/Zwei.md', 'Zwei\n');
		await one.sync();
		await two.sync();

		// The files are still on disk; Obsidian simply has not listed them yet.
		one.vault.unindex('Zettel/Eins.md');
		one.vault.unindex('Zettel/Zwei.md');

		const report = await one.sync();
		expect(report.removedRemotely).toEqual([]);

		const after = await two.sync();
		expect(after.trashed).toEqual([]);
		expect(two.vault.text('Zettel/Eins.md')).toBe('Eins\n');
		expect(two.vault.text('Zettel/Zwei.md')).toBe('Zwei\n');
	});
});

describe('a run that concludes most of the vault is gone', () => {
	const device = new Device('brake');

	it('refuses to act on a conclusion that large', async () => {
		for (let i = 0; i < 12; i += 1) {
			device.vault.put(`Sammlung/Notiz ${String(i)}.md`, `Inhalt ${String(i)}\n`);
		}
		await device.sync();

		// Everything gone at once, and genuinely gone from the disk too — the shape
		// of a restored backup or another device's state file, not of an afternoon.
		for (let i = 0; i < 12; i += 1) {
			device.vault.remove(`Sammlung/Notiz ${String(i)}.md`);
		}

		await expect(device.sync()).rejects.toBeInstanceOf(SuspectDeletionError);
	});

	it('says how much it was asked to remove', async () => {
		const error = await device.sync().catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(SuspectDeletionError);
		expect((error as SuspectDeletionError).deletions).toBe(12);
		// Everything this file's devices have ever pushed shares one vault, so the
		// base is larger than this block's own twelve.
		expect((error as SuspectDeletionError).known).toBeGreaterThanOrEqual(12);
	});

	it('still lets an ordinary deletion through', async () => {
		const ordinary = new Device('ordinary');
		for (let i = 0; i < 12; i += 1) {
			ordinary.vault.put(`Andere/Notiz ${String(i)}.md`, `Inhalt ${String(i)}\n`);
		}
		await ordinary.sync();

		ordinary.vault.remove('Andere/Notiz 0.md');
		const report = await ordinary.sync();

		expect(report.removedRemotely).toEqual(['Andere/Notiz 0.md']);
	});
});

describe('a note somebody edits while the run is fetching it', () => {
	const one = new Device('race-one');
	const two = new Device('race-two');

	it('keeps the new work instead of writing over it', async () => {
		one.vault.put('Rennen.md', 'Erste Fassung.\n');
		await one.sync();
		await two.sync();
		expect(two.vault.text('Rennen.md')).toBe('Erste Fassung.\n');

		// One moves ahead, so two's next run will decide to download.
		one.vault.put('Rennen.md', 'Fassung von eins.\n');
		await one.sync();

		// ...and while that download is in flight, somebody types on two.
		two.whileFetching = () => {
			two.vault.put('Rennen.md', 'Gerade hier getippt.\n');
			two.whileFetching = undefined;
		};

		const report = await two.sync();

		// The typing survived...
		expect(two.vault.text('Rennen.md')).toBe('Gerade hier getippt.\n');
		// ...and the incoming version landed beside it rather than over it.
		expect(report.downloaded).toEqual([]);
		expect(report.conflicts).toHaveLength(1);
		expect(two.vault.text(report.conflicts[0] ?? '')).toBe('Fassung von eins.\n');
	});

	it('does not put a file in the trash that was just edited', async () => {
		const three = new Device('race-three');

		// Two files, because the window this is about is opened by the run's own
		// network time: the first action fetches, and the second acts on an index
		// photographed before that fetch began. Sorted by path, so the download is
		// reached first.
		one.vault.put('Rennen 1 Laden.md', 'Erste.\n');
		one.vault.put('Rennen 2 Loeschen.md', 'Da.\n');
		await one.sync();
		await three.sync();

		one.vault.put('Rennen 1 Laden.md', 'Zweite.\n');
		one.vault.remove('Rennen 2 Loeschen.md');
		await one.sync();

		// While the download is in flight, somebody types into the other file.
		three.whileFetching = () => {
			three.vault.put('Rennen 2 Loeschen.md', 'Doch noch gebraucht.\n');
			three.whileFetching = undefined;
		};

		const report = await three.sync();

		expect(report.trashed).toEqual([]);
		expect(three.vault.trashed).not.toContain('Rennen 2 Loeschen.md');
		expect(three.vault.text('Rennen 2 Loeschen.md')).toBe('Doch noch gebraucht.\n');
		expect(report.resurrected).toEqual(['Rennen 2 Loeschen.md']);
	});
});
