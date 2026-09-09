// @vitest-environment node

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
} from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { createSyncServer } from '../../../packages/server/src/http';
import { CollabRelay } from '../../../packages/server/src/relay';
import { RoomStore } from '../../../packages/server/src/rooms';
import { VaultStore } from '../../../packages/server/src/storage';
import { CollabSession } from './session';

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

	constructor(name: string, path: string, roomId: string, onDisk: string) {
		this.session = new CollabSession({
			path,
			serverUrl: base,
			vaultId,
			roomId,
			token,
			contentKey,
			secret,
			deviceName: name,
			readFile: () => Promise.resolve(onDisk),
			onStatus: () => undefined,
			onError: (error) => {
				throw error instanceof Error ? error : new Error(String(error));
			},
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

	open(name: string, onDisk = ''): Device {
		const device = new Device(name, this.path, this.roomId, onDisk);
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
	stored(): Promise<void> {
		return until(
			'the server has stored the room',
			() => this.storedUpdates > 0,
			4_000,
			async () => {
				this.storedUpdates = (await rooms.read(vaultId, this.roomId)).updates.length;
			}
		);
	}

	private storedUpdates = 0;
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
	dir = await mkdtemp(join(tmpdir(), 'toolbox-collab-'));

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
