// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { RoomFrame } from '@toolbox/protocol';
import { createSyncServer } from './http';
import { CollabRelay } from './relay';
import { RoomStore } from './rooms';
import { sha256Hex, VaultStore } from './storage';

/**
 * Two clients in one room, over a real socket.
 *
 * What is checked here is routing and storage, not merging — the CRDT does that,
 * and the server is deliberately incapable of understanding what it moves.
 */

const VAULT = 'a'.repeat(32);
const ROOM = 'b'.repeat(64);
const TOKEN = 'c'.repeat(64);

let dir: string;
let base: string;
let relay: CollabRelay;
let close: () => Promise<void>;

/**
 * A socket that remembers what it was sent.
 *
 * The server greets a new member with the room history immediately, so a test
 * that attaches its listener after connecting has already missed it. Queueing
 * from the moment the socket exists removes that race instead of sleeping past it.
 */
class Client {
	readonly socket: WebSocket;
	private readonly frames: RoomFrame[] = [];
	private waiting: ((frame: RoomFrame) => void) | undefined;

	constructor(room = ROOM, token = TOKEN) {
		// The token travels as a subprotocol, so it stays out of URLs and proxy logs.
		this.socket = new WebSocket(`${base}/v1/vaults/${VAULT}/rooms/${room}`, [token]);
		this.socket.on('message', (data: Buffer) => {
			const frame = JSON.parse(data.toString('utf8')) as RoomFrame;
			const waiting = this.waiting;
			if (waiting) {
				this.waiting = undefined;
				waiting(frame);
			} else {
				this.frames.push(frame);
			}
		});
	}

	opened(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.socket.readyState === this.socket.OPEN) {
				resolve();
				return;
			}
			this.socket.once('open', () => resolve());
			this.socket.once('error', reject);
		});
	}

	/** The next frame, with a deadline so a test cannot hang. */
	next(timeoutMs = 3_000): Promise<RoomFrame> {
		const queued = this.frames.shift();
		if (queued) {
			return Promise.resolve(queued);
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.waiting = undefined;
				reject(new Error('no frame arrived'));
			}, timeoutMs);
			this.waiting = (frame) => {
				clearTimeout(timer);
				resolve(frame);
			};
		});
	}

	send(frame: RoomFrame): void {
		this.socket.send(JSON.stringify(frame));
	}

	close(): void {
		this.socket.close();
	}
}

function settle(ms = 300): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'toolbox-relay-'));

	const vaults = new VaultStore(dir);
	await vaults.register(VAULT, sha256Hex(TOKEN));

	const server = createSyncServer(
		{
			host: '127.0.0.1',
			port: 0,
			dataDir: dir,
			registrationSecret: 'r'.repeat(32),
			maxBlobBytes: 1024,
			maxManifestBytes: 1024,
		},
		vaults
	);
	relay = new CollabRelay(vaults, new RoomStore(dir));
	relay.attach(server);

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
	close = () =>
		new Promise<void>((resolve) => {
			relay.close();
			server.close(() => resolve());
		});
});

afterAll(async () => {
	await close();
	await rm(dir, { recursive: true, force: true });
});

describe('getting into a room', () => {
	it('turns away a socket with the wrong token', async () => {
		const client = new Client(ROOM, 'd'.repeat(64));
		await expect(client.opened()).rejects.toThrow();
		client.close();
	});

	it('turns away a socket with no token at all', async () => {
		const socket = new WebSocket(`${base}/v1/vaults/${VAULT}/rooms/${ROOM}`);
		await expect(
			new Promise<void>((resolve, reject) => {
				socket.once('open', () => resolve());
				socket.once('error', reject);
			})
		).rejects.toThrow();
		socket.close();
	});

	it('sends the empty history to the first arrival', async () => {
		const client = new Client('e'.repeat(64));
		await client.opened();

		await expect(client.next()).resolves.toEqual({
			type: 'history',
			updates: [],
			generation: 0,
		});
		client.close();
	});
});

describe('two people in one room', () => {
	it('relays an update to the other, and not back to the sender', async () => {
		const room = 'f'.repeat(64);
		const alice = new Client(room);
		const bob = new Client(room);
		await Promise.all([alice.opened(), bob.opened()]);
		await Promise.all([alice.next(), bob.next()]);

		alice.send({ type: 'update', payload: 'sealed-1' });

		await expect(bob.next()).resolves.toEqual({ type: 'update', payload: 'sealed-1' });
		// The sender already has its own change; echoing it back would make the
		// CRDT apply its own work a second time.
		await expect(alice.next(400)).rejects.toThrow('no frame');

		alice.close();
		bob.close();
	});

	it('gives a late arrival everything it missed', async () => {
		const room = '1'.repeat(64);
		const alice = new Client(room);
		await alice.opened();
		await alice.next();

		alice.send({ type: 'update', payload: 'sealed-a' });
		alice.send({ type: 'update', payload: 'sealed-b' });
		await settle();

		const late = new Client(room);
		await late.opened();

		await expect(late.next()).resolves.toMatchObject({
			type: 'history',
			updates: ['sealed-a', 'sealed-b'],
		});

		alice.close();
		late.close();
	});

	it('passes presence along but never writes it down', async () => {
		const room = '2'.repeat(64);
		const alice = new Client(room);
		const bob = new Client(room);
		await Promise.all([alice.opened(), bob.opened()]);
		await Promise.all([alice.next(), bob.next()]);

		alice.send({ type: 'presence', payload: 'cursor' });
		await expect(bob.next()).resolves.toEqual({ type: 'presence', payload: 'cursor' });

		alice.close();
		bob.close();
		await settle();

		// Where someone's cursor was is nobody's business, this server included.
		await expect(new RoomStore(dir).read(VAULT, room)).resolves.toEqual({
			generation: 0,
			updates: [],
		});
	});

	it('keeps rooms apart', async () => {
		const alice = new Client('3'.repeat(64));
		const bob = new Client('4'.repeat(64));
		await Promise.all([alice.opened(), bob.opened()]);
		await Promise.all([alice.next(), bob.next()]);

		alice.send({ type: 'update', payload: 'not-for-bob' });
		await expect(bob.next(400)).rejects.toThrow('no frame');

		alice.close();
		bob.close();
	});
});

describe('compaction', () => {
	it('replaces the log with a merged one, keeping the old generation', async () => {
		const room = '5'.repeat(64);
		const store = new RoomStore(dir);

		const alice = new Client(room);
		await alice.opened();
		await alice.next();
		alice.send({ type: 'update', payload: 'one' });
		alice.send({ type: 'update', payload: 'two' });
		await settle();

		alice.send({ type: 'compact', payload: 'merged', generation: 1 });
		await settle();

		await expect(store.read(VAULT, room)).resolves.toEqual({
			generation: 2,
			updates: ['merged'],
		});

		// Nothing was destroyed; the old generation is simply no longer read.
		const files = await readdir(join(dir, 'vaults', VAULT, 'rooms', room));
		expect(files.sort()).toEqual(['gen-1.log', 'gen-2.log']);

		alice.close();
	});

	it('refuses a compaction based on a generation that has moved on', async () => {
		const room = '6'.repeat(64);
		const store = new RoomStore(dir);
		await store.append(VAULT, room, 'one');
		await store.compact(VAULT, room, 1, 'merged');

		// A client that rebuilt from generation 1 must not overwrite generation 2:
		// it never saw what went into it.
		await expect(store.compact(VAULT, room, 1, 'stale')).resolves.toEqual({
			ok: false,
			generation: 2,
		});
	});
});
