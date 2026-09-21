// @vitest-environment node

import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RoomStore } from './rooms';

/**
 * What a room store is allowed to say when it cannot answer.
 *
 * There are only two honest answers to "what is in this room": the history, or
 * an error. "Nothing" is a third, and it is not a safe default — a client told a
 * room is empty treats that as licence to seed the room from its own copy of the
 * note, and that copy becomes the room for every other device. Every read
 * failure used to collapse into that answer.
 */

const VAULT = 'a'.repeat(32);
const ROOM = 'b'.repeat(32);

let dir: string;
let store: RoomStore;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'signet-rooms-'));
	store = new RoomStore(dir);
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function roomDir(): string {
	return join(dir, 'vaults', VAULT, 'rooms', ROOM);
}

describe('a room nobody has written to', () => {
	it('is empty, and says so', async () => {
		// The one case where "nothing" is the truth.
		await expect(store.read(VAULT, ROOM)).resolves.toEqual({
			generation: 0,
			updates: [],
		});
	});
});

describe('a room that has history', () => {
	it('gives it back', async () => {
		await store.append(VAULT, ROOM, 'first');
		await store.append(VAULT, ROOM, 'second');

		await expect(store.read(VAULT, ROOM)).resolves.toEqual({
			generation: 1,
			updates: ['first', 'second'],
		});
	});
});

describe('a room that cannot be read', () => {
	it('refuses to answer rather than answering "empty"', async () => {
		// A log that is not a readable file. What it actually is does not matter —
		// a permission that changed, too many open files, a volume that hiccuped —
		// only that reading it fails for a reason other than "it is not there".
		await mkdir(join(roomDir(), 'gen-1.log'), { recursive: true });

		await expect(store.read(VAULT, ROOM)).rejects.toThrow();
	});

	it('refuses when the room directory itself cannot be listed', async () => {
		// `latestGeneration` swallowed this the same way, and a generation of 0 is
		// the same empty answer arriving by a different route.
		await mkdir(join(dir, 'vaults', VAULT, 'rooms'), { recursive: true });
		await rm(join(dir, 'vaults', VAULT, 'rooms'), { recursive: true, force: true });

		// A missing directory really is a new room, so that one still answers.
		await expect(store.read(VAULT, ROOM)).resolves.toEqual({
			generation: 0,
			updates: [],
		});
	});
});

describe('compacting a room', () => {
	it('keeps what arrived while the merge was being made', async () => {
		await store.append(VAULT, ROOM, 'one');
		await store.append(VAULT, ROOM, 'two');

		// The client read those two, and somebody typed again before its merge
		// landed. Checking only the generation number cannot see this: the third
		// update went into the same generation the client is compacting.
		await store.append(VAULT, ROOM, 'three');

		const outcome = await store.compact(VAULT, ROOM, 1, 'merged-one-and-two', 2);
		expect(outcome).toEqual({ ok: true, generation: 2 });

		// Only the newest generation is ever read, so anything missing from it has
		// stopped existing — invisibly, because every peer still connected is
		// holding it in memory.
		await expect(store.read(VAULT, ROOM)).resolves.toEqual({
			generation: 2,
			updates: ['merged-one-and-two', 'three'],
		});
	});

	it('replaces the log when the merge covered all of it', async () => {
		await store.append(VAULT, ROOM, 'one');
		await store.append(VAULT, ROOM, 'two');

		await expect(store.compact(VAULT, ROOM, 1, 'merged', 2)).resolves.toEqual({
			ok: true,
			generation: 2,
		});
		await expect(store.read(VAULT, ROOM)).resolves.toEqual({
			generation: 2,
			updates: ['merged'],
		});
	});

	it('still serves a client that does not say what it covered', async () => {
		// Refusing it outright would leave an older client unable to compact at
		// all, which is how a room's log grows until appends are refused.
		await store.append(VAULT, ROOM, 'one');

		await expect(store.compact(VAULT, ROOM, 1, 'merged')).resolves.toEqual({
			ok: true,
			generation: 2,
		});
	});

	it('refuses a merge built on a generation that has moved on', async () => {
		await store.append(VAULT, ROOM, 'one');
		await store.compact(VAULT, ROOM, 1, 'merged', 1);

		await expect(store.compact(VAULT, ROOM, 1, 'stale', 1)).resolves.toEqual({
			ok: false,
			generation: 2,
		});
	});

	it('never destroys the generation it replaced', async () => {
		await store.append(VAULT, ROOM, 'one');
		await store.compact(VAULT, ROOM, 1, 'merged', 1);

		const { readFile } = await import('node:fs/promises');
		await expect(readFile(join(roomDir(), 'gen-1.log'), 'utf8')).resolves.toBe('one\n');
	});
});
