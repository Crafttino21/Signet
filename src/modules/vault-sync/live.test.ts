import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSession } from './live';
import type { LiveHandlers } from './live';

/**
 * The live loop has to behave when the network is slow, when the server is down,
 * and when someone closes the window mid-request. Those are the moments a naive
 * loop turns into a busy loop or an unstoppable one.
 */

const OPTIONS = { waitSeconds: 1, debounceMs: 50, backoffMs: 100, minIntervalMs: 20 };

let seq = 0;
let active = true;
let syncs: number;
let errors: unknown[];

function session(waitForRemote: LiveHandlers['waitForRemote']): LiveSession {
	return new LiveSession(
		{
			currentSeq: () => seq,
			waitForRemote,
			sync: () => {
				syncs += 1;
				return Promise.resolve();
			},
			isActive: () => active,
			onError: (error) => errors.push(error),
		},
		OPTIONS
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	seq = 0;
	active = true;
	syncs = 0;
	errors = [];
});

afterEach(() => {
	vi.useRealTimers();
});

describe('listening for remote changes', () => {
	it('syncs when the server reports a newer commit', async () => {
		const live = session(() => Promise.resolve(seq + 1));
		live.start();

		await vi.advanceTimersByTimeAsync(10);
		live.stop();

		expect(syncs).toBeGreaterThan(0);
	});

	it('does not sync when the wait simply timed out', async () => {
		// The server answers with the unchanged head when nothing happened. That is
		// an ordinary answer, and acting on it would mean syncing in a loop forever.
		const live = session(() => Promise.resolve(seq));
		live.start();

		await vi.advanceTimersByTimeAsync(50);
		live.stop();

		expect(syncs).toBe(0);
	});

	it('stops itself when the window is no longer in front of anyone', async () => {
		active = false;
		const live = session(() => Promise.resolve(seq + 1));
		live.start();

		await vi.advanceTimersByTimeAsync(10);

		// Parking a request that the operating system may kill helps nobody.
		expect(live.isRunning).toBe(false);
		expect(syncs).toBe(0);
	});

	it('does not spin when the server answers instantly instead of parking', async () => {
		// An old server, or a proxy that refuses to hold a connection, answers the
		// long-poll immediately. The loop must not become a request flood.
		let calls = 0;
		const live = session(() => {
			calls += 1;
			return Promise.resolve(seq);
		});

		live.start();
		await vi.advanceTimersByTimeAsync(200);
		live.stop();

		expect(calls).toBeGreaterThan(0);
		expect(calls).toBeLessThan(15);
	});

	it('backs off instead of hammering a server that is down', async () => {
		let attempts = 0;
		const live = session(() => {
			attempts += 1;
			return Promise.reject(new Error('connection refused'));
		});

		live.start();
		await vi.advanceTimersByTimeAsync(10);
		const immediately = attempts;

		await vi.advanceTimersByTimeAsync(250);
		live.stop();

		expect(immediately).toBe(1);
		// A few retries over a quarter of a second, not hundreds.
		expect(attempts).toBeLessThan(5);
		expect(errors.length).toBeGreaterThan(0);
	});

	it('stops for good once told to', async () => {
		const live = session(() => Promise.resolve(seq + 1));
		live.start();
		live.stop();

		await vi.advanceTimersByTimeAsync(500);
		const after = syncs;
		await vi.advanceTimersByTimeAsync(500);

		expect(syncs).toBe(after);
	});
});

describe('announcing local changes', () => {
	it('turns a burst of edits into one sync', async () => {
		const live = session(() => new Promise(() => undefined));
		live.start();

		for (let i = 0; i < 20; i += 1) {
			live.noteLocalChange();
			await vi.advanceTimersByTimeAsync(10);
		}
		await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs);
		live.stop();

		// Holding a key down must not produce a commit per character.
		expect(syncs).toBe(1);
	});

	it('waits for the typing to stop', async () => {
		const live = session(() => new Promise(() => undefined));
		live.start();

		live.noteLocalChange();
		await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs - 10);
		expect(syncs).toBe(0);

		await vi.advanceTimersByTimeAsync(20);
		expect(syncs).toBe(1);

		live.stop();
	});

	it('ignores edits once stopped', async () => {
		const live = session(() => new Promise(() => undefined));
		live.start();
		live.stop();

		live.noteLocalChange();
		await vi.advanceTimersByTimeAsync(500);

		expect(syncs).toBe(0);
	});

	it('drops a pending push when stopped before it fires', async () => {
		const live = session(() => new Promise(() => undefined));
		live.start();

		live.noteLocalChange();
		await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs - 10);
		live.stop();
		await vi.advanceTimersByTimeAsync(500);

		expect(syncs).toBe(0);
	});
});
