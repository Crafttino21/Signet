import { describe, expect, it } from 'vitest';
import {
	chosenRingPath,
	LEGACY_RING_FILE,
	locateRingFile,
	RING_FILE,
	ringWriteTargets,
} from './ring-path';
import type { Exists } from './ring-path';

/**
 * Where the ring file is, decided from the vault rather than remembered.
 *
 * This broke twice and in the same shape both times. The path is a property of
 * the ring — every device has to look at the same file or each one is talking
 * to itself — and it was being treated as a property of the device: worked out
 * once at the first start after the rename, from whatever had synced by that
 * moment, written into that device's settings and never revisited. Two devices
 * in the same ring, in the same vault, on the same build, would then read and
 * publish different files and share nothing at all.
 */

function vault(...present: string[]): Exists {
	const there = new Set(present);
	return (path) => Promise.resolve(there.has(path));
}

describe('locateRingFile', () => {
	it('finds a ring still living under the old name', async () => {
		await expect(locateRingFile('', vault(LEGACY_RING_FILE))).resolves.toBe(LEGACY_RING_FILE);
	});

	it('prefers the new path when both are there', async () => {
		// A host on this build publishes to both, so the new file is at least as
		// fresh as the old one beside it — and that is the direction to settle in.
		await expect(locateRingFile('', vault(RING_FILE, LEGACY_RING_FILE))).resolves.toBe(
			RING_FILE
		);
	});

	it('answers with the new path when the vault holds neither', async () => {
		// A ring made from here on, and a device waiting for one to arrive.
		await expect(locateRingFile('', vault())).resolves.toBe(RING_FILE);
	});

	it('obeys a path somebody typed, whatever is in the vault', async () => {
		const chosen = 'Shared/ring.json';
		await expect(locateRingFile(chosen, vault(RING_FILE, LEGACY_RING_FILE))).resolves.toBe(
			chosen
		);
	});

	it('does not treat either of its own names as a choice', async () => {
		// The previous build wrote the old path into the settings of every device
		// that had it. Reading that back as a deliberate answer is what kept those
		// devices pinned to it forever.
		await expect(locateRingFile(LEGACY_RING_FILE, vault(RING_FILE))).resolves.toBe(RING_FILE);
		await expect(locateRingFile(RING_FILE, vault(LEGACY_RING_FILE))).resolves.toBe(
			LEGACY_RING_FILE
		);
	});
});

describe('chosenRingPath', () => {
	it('is nothing for blank input and for either default', () => {
		expect(chosenRingPath('')).toBeUndefined();
		expect(chosenRingPath('   ')).toBeUndefined();
		expect(chosenRingPath(RING_FILE)).toBeUndefined();
		expect(chosenRingPath(LEGACY_RING_FILE)).toBeUndefined();
	});

	it('is whatever else was typed, tidied up', () => {
		expect(chosenRingPath('  Shared/ring.json  ')).toBe('Shared/ring.json');
		expect(chosenRingPath('Shared//ring.json')).toBe('Shared/ring.json');
	});
});

describe('ringWriteTargets', () => {
	it('writes only the new path when nothing older is about', async () => {
		await expect(ringWriteTargets('', vault())).resolves.toEqual([RING_FILE]);
	});

	it('moves a ring off the old name and keeps feeding it', async () => {
		// Both, because a device still on the build called Toolbox reads that file
		// and nothing else: writing only the new one strands it on a snapshot that
		// never changes again, which is a worse failure than the untidiness.
		await expect(ringWriteTargets(LEGACY_RING_FILE, vault(LEGACY_RING_FILE))).resolves.toEqual([
			RING_FILE,
			LEGACY_RING_FILE,
		]);
	});

	it('stops copying to the old path once it has been deleted', async () => {
		// How the move finishes: nobody has to be told it is over.
		await expect(ringWriteTargets('', vault(RING_FILE))).resolves.toEqual([RING_FILE]);
	});

	it('writes where somebody said to and nowhere else', async () => {
		await expect(
			ringWriteTargets('Shared/ring.json', vault(LEGACY_RING_FILE))
		).resolves.toEqual(['Shared/ring.json']);
	});
});
