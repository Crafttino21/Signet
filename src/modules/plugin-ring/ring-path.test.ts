import { describe, expect, it } from 'vitest';
import {
	chosenRingPath,
	LEGACY_RING_FILE,
	locateRingFile,
	RING_FILE,
	ringWriteTargets,
	rosterFolders,
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
	it('writes the new path and nothing else', () => {
		expect(ringWriteTargets('')).toEqual([RING_FILE]);
	});

	it('writes the new path even while the ring is still found at the old one', () => {
		// It used to write both, so that a device on the build called Toolbox —
		// which reads that file and nothing else — kept following the ring. That
		// device is retired, and a second file nobody reads is just another thing
		// that can disagree with the first.
		expect(ringWriteTargets(LEGACY_RING_FILE)).toEqual([RING_FILE]);
	});

	it('writes where somebody said to and nowhere else', () => {
		expect(ringWriteTargets('Shared/ring.json')).toEqual(['Shared/ring.json']);
	});
});

describe('rosterFolders', () => {
	it('still reads an old folder that is lying there', async () => {
		// Nothing writes it any more, so what is in it is the last thing a device
		// said before it was updated. Worth showing while it is there — the roster
		// carries each device's version, which is how a straggler is spotted.
		await expect(rosterFolders('', vault('Toolbox/devices'))).resolves.toEqual([
			'Signet/devices',
			'Toolbox/devices',
		]);
	});

	it('does not invent one because an old ring file exists', async () => {
		// Deriving this from the ring file's write targets created `Toolbox/devices`
		// on devices that never had one — and grew it back every five minutes after
		// somebody deleted it. A folder that will not stay deleted cannot be the
		// thing we ask people to delete.
		await expect(rosterFolders(LEGACY_RING_FILE, vault(LEGACY_RING_FILE))).resolves.toEqual([
			'Signet/devices',
		]);
	});

	it('writes to the new folder even while the ring file is still at the old path', async () => {
		// One folder every updated device agrees on, whatever state the ring file
		// happens to be in.
		await expect(rosterFolders(LEGACY_RING_FILE, vault())).resolves.toEqual(['Signet/devices']);
	});

	it('is one folder once the old ring file is gone', async () => {
		await expect(rosterFolders('', vault(RING_FILE))).resolves.toEqual(['Signet/devices']);
	});

	it('follows a path somebody typed', async () => {
		await expect(rosterFolders('Shared/ring.json', vault(LEGACY_RING_FILE))).resolves.toEqual([
			'Shared/devices',
		]);
	});

	it('copes with a ring file at the vault root', async () => {
		await expect(rosterFolders('ring.json', vault())).resolves.toEqual(['devices']);
	});
});
