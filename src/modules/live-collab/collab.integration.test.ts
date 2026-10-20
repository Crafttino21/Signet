// @vitest-environment node

/**
 * There is no DOM here, and the code under test schedules through `window`.
 *
 * That is not an oversight on its side: Obsidian can put a note in a popout
 * window, and a timer taken from the main window never fires there, which is why
 * `eslint-plugin-obsidianmd` insists on it. This file is the one place that runs
 * the session against a real server instead of the app, so it brings the two
 * timer functions the session and its socket actually use.
 */
const globals = globalThis as { window?: unknown };
globals.window ??= {
	setTimeout: (handler: () => void, ms?: number): unknown => setTimeout(handler, ms),
	clearTimeout: (id: unknown): void => {
		clearTimeout(id as ReturnType<typeof setTimeout>);
	},
};

import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	deriveAuthToken,
	deriveContentKey,
	deriveNameKey,
	deriveRoomId,
	deriveVaultId,
	generateRingSecret,
	hashAuthToken,
} from '@signet/protocol';
import type { Bytes } from '@signet/protocol';
import { createSyncServer } from '../../../packages/server/src/http';
import { CollabRelay } from '../../../packages/server/src/relay';
import { RoomStore } from '../../../packages/server/src/rooms';
import { VaultStore } from '../../../packages/server/src/storage';
import * as Y from 'yjs';
import { CollabSession, seedUpdate } from './session';
import type { SessionOptions } from './session';

/**
 * Two devices typing into one note at the same time, over a real socket.
 *
 * This is the claim the whole feature rests on: that two people editing the same
 * paragraph end up with one text rather than two versions of it. The parts are
 * tested elsewhere — what is proved here is that they add up, through real
 * encryption and a real server that cannot read a word of what it relays.
 *
 * Each test gets its own note, because a room keeps its history for as long as
 * the server does. Sharing one between tests would mean each starts from
 * whatever the last one left behind.
 */

const REGISTRATION_SECRET = 'r'.repeat(32);

let dir: string;
let base: string;
let close: () => Promise<void>;
let secret: Bytes;
let vaultId: string;
let token: string;
let contentKey: CryptoKey;
let nameKey: Bytes;
let rooms: RoomStore;

/** One device's view of one note. */
class Device {
	readonly session: CollabSession;

	constructor(
		name: string,
		path: string,
		roomId: string,
		onDisk: string,
		extra: Partial<SessionOptions> = {}
	) {
		this.session = new CollabSession({
			path,
			serverUrl: base,
			vaultId,
			roomId,
			token,
			contentKey,
			secret,
			deviceName: name,
			readCurrent: () => Promise.resolve(onDisk),
			onStatus: () => undefined,
			onError: (error) => {
				throw error instanceof Error ? error : new Error(String(error));
			},
			...extra,
		});
		this.session.start();
	}

	get text(): string {
		return this.session.contents();
	}

	type(index: number, what: string): void {
		this.session.text.insert(index, what);
	}

	destroy(): void {
		this.session.destroy();
	}
}

/** A note nobody else in this file touches, and the devices that have it open. */
class Note {
	private readonly devices: Device[] = [];

	private constructor(
		private readonly path: string,
		private readonly roomId: string
	) {}

	static async create(path: string): Promise<Note> {
		return new Note(path, await deriveRoomId(nameKey, path));
	}

	open(name: string, onDisk = '', extra: Partial<SessionOptions> = {}): Device {
		const device = new Device(name, this.path, this.roomId, onDisk, extra);
		this.devices.push(device);
		return device;
	}

	/** As if the app were closed on that device. */
	closeOn(device: Device): void {
		device.destroy();
		const at = this.devices.indexOf(device);
		if (at >= 0) {
			this.devices.splice(at, 1);
		}
	}

	closeAll(): void {
		while (this.devices.length > 0) {
			this.devices.pop()?.destroy();
		}
	}

	/**
	 * Waits until the room on the server actually holds something.
	 *
	 * A device having the text is not the same as the room having it — the update
	 * is still in flight. Tests about what a later joiner sees have to wait for the
	 * server, or they are really testing the timing of the first send.
	 */
	stored(atLeast = 1): Promise<void> {
		return until(
			'the server has stored the room',
			() => this.storedUpdates >= atLeast,
			4_000,
			async () => {
				this.storedUpdates = (await rooms.read(vaultId, this.roomId)).updates.length;
			}
		);
	}

	private storedUpdates = 0;

	/** How many updates the server holds for this room right now. */
	async held(): Promise<number> {
		return (await rooms.read(vaultId, this.roomId)).updates.length;
	}
}

const notes: Note[] = [];

async function note(path: string): Promise<Note> {
	const created = await Note.create(path);
	notes.push(created);
	return created;
}

/** Waits for a condition rather than for a duration, so the test cannot flake. */
async function until(
	what: string,
	predicate: () => boolean,
	timeoutMs = 4_000,
	refresh?: () => Promise<void>
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await refresh?.();
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`timed out waiting until ${what}`);
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'signet-collab-'));

	secret = generateRingSecret();
	vaultId = await deriveVaultId(secret);
	token = await deriveAuthToken(secret);
	contentKey = await deriveContentKey(secret);
	nameKey = await deriveNameKey(secret);

	const vaults = new VaultStore(dir);
	await vaults.register(vaultId, await hashAuthToken(token));

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
		vaults
	);
	rooms = new RoomStore(dir);
	const relay = new CollabRelay(vaults, rooms);
	relay.attach(server);

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
	close = () =>
		new Promise<void>((resolve) => {
			relay.close();
			server.close(() => resolve());
		});
});

afterEach(() => {
	while (notes.length > 0) {
		notes.pop()?.closeAll();
	}
});

afterAll(async () => {
	await close();
	await rm(dir, { recursive: true, force: true });
});

describe('two devices in one note', () => {
	it('merges edits made in the same line at the same time', async () => {
		const shared = await note('Notes/Merging.md');

		const one = shared.open('Laptop', 'shared\n');
		await until('the first device seeds the room', () => one.text === 'shared\n');
		await shared.stored();

		const two = shared.open('Phone', 'a completely different file\n');
		await until('the second device catches up', () => two.text === 'shared\n');

		// Neither knows about the other's keystroke when it makes its own — this is
		// the case a file sync can only answer with two conflicting copies.
		one.type(0, 'left ');
		two.type(6, ' right');

		await until('both agree', () => one.text === two.text && one.text.includes('right'));
		expect(one.text).toContain('left ');
		expect(one.text).toContain('right');
		expect(two.text).toBe(one.text);
	});

	it('keeps what the room already holds instead of the file on disk', async () => {
		const shared = await note('Notes/Stale.md');

		// The file a second device has may be an older copy. Seeding from it would
		// throw away everything the others wrote.
		const one = shared.open('Laptop', 'the current text\n');
		await until('the room is seeded', () => one.text === 'the current text\n');
		await shared.stored();

		const stale = shared.open('Tablet', 'a stale copy nobody wants\n');
		await until('the stale device is corrected', () => stale.text === 'the current text\n');

		expect(stale.text).not.toContain('stale');
	});

	it('lets each device see the others are there', async () => {
		const shared = await note('Notes/Presence.md');

		const one = shared.open('Laptop', 'hello\n');
		await until('the room is seeded', () => one.text === 'hello\n');

		const two = shared.open('Phone');
		await until(
			'both see one another',
			() => one.session.peers === 1 && two.session.peers === 1
		);

		expect(one.session.connected).toBe(true);
		expect(two.session.connected).toBe(true);
	});

	it('gives a device that was away everything typed while it was gone', async () => {
		const shared = await note('Notes/Away.md');

		const one = shared.open('Laptop', 'start\n');
		await until('the room is seeded', () => one.text === 'start\n');
		await shared.stored();

		const two = shared.open('Phone');
		await until('the second device joins', () => two.text === 'start\n');
		shared.closeOn(two);

		one.type(5, ' more');

		const rejoined = shared.open('Phone');
		await until('the rejoining device is current', () => rejoined.text === 'start more\n');
		expect(rejoined.text).toBe('start more\n');
	});

	it('does not double the file when both devices open it at once', async () => {
		const shared = await note('Notes/Race.md');

		// Neither has seen the other's first update yet, so both find an empty room
		// and both seed it from their own copy of the same file.
		const one = shared.open('Laptop', 'one copy\n');
		const two = shared.open('Phone', 'one copy\n');

		await until(
			'both have the text',
			() => one.text.includes('one copy') && two.text.includes('one copy')
		);
		await until('both agree', () => one.text === two.text);

		expect(one.text).toBe('one copy\n');
		expect(two.text).toBe('one copy\n');
	});

	it('says it is seeded only once the document is the note', async () => {
		// What binding an editor waits for. Before this resolves the document is
		// empty, or half a note, and an editor pointed at it is shown the rest
		// arriving as an edit — which is how the note came to be displayed twice.
		const shared = await note('Notes/Seeded.md');

		const one = shared.open('Laptop', 'on disk\n');
		expect(one.session.isSeeded).toBe(false);

		await one.session.whenSeeded;

		expect(one.session.isSeeded).toBe(true);
		expect(one.text).toBe('on disk\n');
	});

	it('hands a late joiner the room, not the room plus its own file', async () => {
		// The case the reconciliation in editor-binding.ts has to survive: the room
		// already holds something and the joining device's file says otherwise. By
		// the time it reports itself seeded it must hold the room's text exactly
		// once, with nothing of its own stuck to the front or the back.
		const shared = await note('Notes/Late.md');

		const one = shared.open('Laptop', 'the room wins\n');
		await until('the room is seeded', () => one.text === 'the room wins\n');
		await shared.stored();

		const two = shared.open('Phone', 'a stale copy\n');
		await two.session.whenSeeded;

		expect(two.text).toBe('the room wins\n');
		expect(two.text).not.toContain('a stale copy');
	});

	it('shows two names in a room of two', async () => {
		const shared = await note('Notes/Names.md');

		const one = shared.open('Laptop', 'hi\n');
		await until('the room is seeded', () => one.text === 'hi\n');
		shared.open('Phone');

		await until('the other name arrives', () => one.session.peers === 1);
		const names = [...one.session.awareness.getStates().values()].map(
			(state) => (state as { user?: { name?: string } }).user?.name
		);
		expect(names).toContain('Laptop');
		expect(names).toContain('Phone');
	});
});

describe('seeding', () => {
	// What two devices produce when both find a room empty and seed it at once.
	// No server needed: this is about the bytes.

	function merged(left: string, right: string): [string, string] {
		const one = new Y.Doc();
		const two = new Y.Doc();
		Y.applyUpdate(one, seedUpdate(left));
		Y.applyUpdate(two, seedUpdate(right));
		Y.applyUpdate(one, Y.encodeStateAsUpdate(two));
		Y.applyUpdate(two, Y.encodeStateAsUpdate(one));
		return [one.getText('content').toJSON(), two.getText('content').toJSON()];
	}

	it('applies the same file once', () => {
		expect(merged('same\n', 'same\n')).toEqual(['same\n', 'same\n']);
	});

	it('keeps both of two different files, and agrees on the result', () => {
		// Seeded under one shared identity, the second file was dropped as a
		// duplicate of the first — and every later edit pointed at characters the
		// other device did not have.
		const [one, two] = merged('left\n', 'right\n');
		expect(one).toBe(two);
		expect(one).toContain('left\n');
		expect(one).toContain('right\n');
	});
});

describe('coming back after being cut off', () => {
	it('merges what a device wrote while away with what the room did meanwhile', async () => {
		const shared = await note('Notes/Away-merge.md');
		const original = 'top\n\nmiddle\n\nbottom\n';

		const one = shared.open('Laptop', original);
		await until('the room is seeded', () => one.text === original);
		await shared.stored();

		const two = shared.open('Phone', original);
		await two.session.whenSeeded;
		// What the module remembers once the note on disk matches the document.
		const base = two.session.snapshotBase();
		shared.closeOn(two);

		const before = await shared.held();
		one.type(one.text.indexOf('bottom'), 'new ');
		await shared.stored(before + 1);

		// Edited on the phone while it was away.
		const back = shared.open('Phone', 'TOP\n\nmiddle\n\nbottom\n', {
			loadBase: () => Promise.resolve(base),
		});
		await until(
			'both have both edits',
			() => back.text === one.text && one.text.includes('TOP') && one.text.includes('new ')
		);
		expect(back.text).toBe('TOP\n\nmiddle\n\nnew bottom\n');
	});

	it('keeps a stretch both sides changed differently beside the note', async () => {
		const shared = await note('Notes/Away-conflict.md');
		const kept: string[] = [];

		const one = shared.open('Laptop', 'alpha beta\n');
		await until('the room is seeded', () => one.text === 'alpha beta\n');
		await shared.stored();

		const two = shared.open('Phone', 'alpha beta\n');
		await two.session.whenSeeded;
		const base = two.session.snapshotBase();
		shared.closeOn(two);

		const before = await shared.held();
		one.session.text.delete(6, 4);
		one.type(6, 'gamma');
		await shared.stored(before + 2);

		const back = shared.open('Phone', 'alpha delta\n', {
			loadBase: () => Promise.resolve(base),
			keepAside: (text) => {
				kept.push(text);
				return Promise.resolve();
			},
		});
		await back.session.whenSeeded;

		expect(back.text).toBe('alpha gamma\n');
		expect(kept).toEqual(['alpha delta\n']);
	});

	it('keeps the note beside the room when there is nothing to merge by', async () => {
		const shared = await note('Notes/No-base.md');
		const kept: string[] = [];

		const one = shared.open('Laptop', 'room text\n');
		await until('the room is seeded', () => one.text === 'room text\n');
		await shared.stored();

		const two = shared.open('Phone', 'my own text\n', {
			keepAside: (text) => {
				kept.push(text);
				return Promise.resolve();
			},
		});
		await two.session.whenSeeded;

		expect(two.text).toBe('room text\n');
		expect(kept).toEqual(['my own text\n']);
	});

	it('does not apply a base to a room it did not come from', async () => {
		// A wiped server: the room is new, and the base describes history it does
		// not have. Applying it would put the note in twice.
		const elsewhere = await note('Notes/Reset-old.md');
		const old = elsewhere.open('Phone', 'old room\n');
		await old.session.whenSeeded;
		const base = old.session.snapshotBase();
		elsewhere.closeAll();

		const shared = await note('Notes/Reset-new.md');
		const kept: string[] = [];
		const one = shared.open('Laptop', 'new room\n');
		await until('the room is seeded', () => one.text === 'new room\n');
		await shared.stored();

		const back = shared.open('Phone', 'old room, edited\n', {
			loadBase: () => Promise.resolve(base),
			keepAside: (text) => {
				kept.push(text);
				return Promise.resolve();
			},
		});
		await back.session.whenSeeded;

		expect(back.text).toBe('new room\n');
		expect(kept).toEqual(['old room, edited\n']);
	});

	it('leaves the note alone while the room does not answer', async () => {
		let waited = false;
		const session = new CollabSession({
			path: 'Slow.md',
			serverUrl: 'http://127.0.0.1:1',
			vaultId,
			roomId: 'b'.repeat(32),
			token,
			contentKey,
			secret,
			deviceName: 'slow',
			readCurrent: () => Promise.resolve('typed while waiting\n'),
			onStatus: () => undefined,
			onError: () => undefined,
			onWaiting: () => {
				waited = true;
			},
		});
		session.start();

		await until('the wait is reported', () => waited, 8_000);
		// Not seeded from the note: that seed is what collided with the room's
		// history when it arrived late.
		expect(session.isSeeded).toBe(false);
		expect(session.contents()).toBe('');

		session.destroy();
	}, 10_000);
});

describe('a server address that cannot be used', () => {
	// Live editing built its socket address by rewriting the sync's setting as a
	// string, so an address with no scheme travelled all the way to
	// `new WebSocket` and threw from inside `start()` — which the module called
	// after it had already put the session in its map and claimed the path.

	function sessionFor(serverUrl: string): CollabSession {
		return new CollabSession({
			path: 'Kaputt.md',
			serverUrl,
			vaultId,
			roomId: 'a'.repeat(32),
			token,
			contentKey,
			secret,
			deviceName: 'broken',
			readCurrent: () => Promise.resolve(''),
			onStatus: () => undefined,
			onError: () => undefined,
		});
	}

	it('says so when the session starts, rather than later', () => {
		const session = sessionFor('192.168.1.5:8787');

		// Synchronously, which is what lets the module undo everything it had just
		// set up for this session instead of leaving it half-open.
		expect(() => {
			session.start();
		}).toThrow();

		session.destroy();
	});

	it('leaves nothing waiting on a document that can never arrive', async () => {
		const session = sessionFor('not a url at all');
		expect(() => {
			session.start();
		}).toThrow();

		// The module ends a session it could not start. That has to settle
		// `whenSeeded`, because every later attach for this note waits on it — and
		// a note whose attach never returns stays claimed, which takes it out of
		// the file sync for as long as the vault is open.
		session.destroy();
		await expect(session.whenSeeded).resolves.toBeUndefined();
		expect(session.isSeeded).toBe(false);
	});

	it('reports no text at all until it has been seeded', () => {
		// What the write-back guard rests on: an unseeded session is not an empty
		// note, it is a session with nothing to say about the note.
		const session = sessionFor('http://127.0.0.1:1');

		expect(session.isSeeded).toBe(false);
		expect(session.contents()).toBe('');

		session.destroy();
	});
});
