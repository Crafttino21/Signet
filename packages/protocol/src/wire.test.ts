import { describe, expect, it } from 'vitest';
import { isFileEntry, isRoomFrame, isSafeId, isVaultManifest } from './wire';

/**
 * These guards used to check the shape around the data and not the data.
 *
 * `isVaultManifest` asked whether `files` was an array and nothing about what was
 * in it, and `files[].path` goes on to become a path on somebody's disk.
 * `isRoomFrame` asked only for `type`, and `payload` went from there into a log
 * file the server writes one entry per line.
 *
 * Decryption proves a message was sealed by somebody holding the ring secret. It
 * proves nothing at all about what is inside, and a device trusted to sync notes
 * is not a reason to stop reading what it sent.
 */

const entry = { path: 'Notes/a.md', hash: 'abc', blob: 'def', size: 1, mtime: 2 };

function manifest(over: Record<string, unknown> = {}): unknown {
	return { version: 1, seq: 1, updatedAt: 'now', files: [entry], deleted: [], ...over };
}

describe('isVaultManifest', () => {
	it('accepts a manifest that is actually one', () => {
		expect(isVaultManifest(manifest())).toBe(true);
	});

	it('accepts an empty vault', () => {
		expect(isVaultManifest(manifest({ files: [], deleted: [] }))).toBe(true);
	});

	it('accepts a tombstone', () => {
		const deleted = [{ path: 'Notes/gone.md', deletedAt: 1 }];
		expect(isVaultManifest(manifest({ deleted }))).toBe(true);
	});

	it('refuses entries that are not entries', () => {
		for (const files of [[null], [undefined], [{}], ['Notes/a.md'], [[]], [42]]) {
			expect(isVaultManifest(manifest({ files }))).toBe(false);
		}
	});

	it('refuses a path that is not a string', () => {
		// The one that mattered: it reached `normalizePath` and then `createBinary`.
		expect(isVaultManifest(manifest({ files: [{ ...entry, path: 42 }] }))).toBe(false);
		expect(isVaultManifest(manifest({ files: [{ ...entry, path: null }] }))).toBe(false);
		expect(isVaultManifest(manifest({ files: [{ ...entry, path: '' }] }))).toBe(false);
	});

	it('refuses an absurdly long path', () => {
		const path = 'a'.repeat(2000);
		expect(isVaultManifest(manifest({ files: [{ ...entry, path }] }))).toBe(false);
	});

	it('refuses a tombstone that is not one', () => {
		expect(isVaultManifest(manifest({ deleted: [{ path: 'x' }] }))).toBe(false);
		expect(isVaultManifest(manifest({ deleted: [null] }))).toBe(false);
	});

	it('still refuses the outer shape', () => {
		expect(isVaultManifest(null)).toBe(false);
		expect(isVaultManifest('manifest')).toBe(false);
		expect(isVaultManifest(manifest({ files: 'none' }))).toBe(false);
		expect(isVaultManifest(manifest({ seq: '1' }))).toBe(false);
	});
});

describe('isFileEntry', () => {
	it('is exported so the manifest guard can be read at a glance', () => {
		expect(isFileEntry(entry)).toBe(true);
		expect(isFileEntry({ ...entry, size: '1' })).toBe(false);
	});
});

describe('isRoomFrame', () => {
	it('accepts the frames a client really sends', () => {
		expect(isRoomFrame({ type: 'update', payload: 'AAAA' })).toBe(true);
		expect(isRoomFrame({ type: 'presence', payload: 'AAAA' })).toBe(true);
		expect(isRoomFrame({ type: 'compact', payload: 'AAAA', generation: 3 })).toBe(true);
		expect(isRoomFrame({ type: 'history', updates: ['AAAA'], generation: 1 })).toBe(true);
		expect(isRoomFrame({ type: 'history', updates: [], generation: 0 })).toBe(true);
		expect(isRoomFrame({ type: 'error', message: 'no' })).toBe(true);
	});

	it('refuses a payload with a newline in it', () => {
		// The room log is one update per line and the reader splits on newlines, so
		// a payload carrying one forges extra entries. Real payloads are base64 and
		// never contain one.
		expect(isRoomFrame({ type: 'update', payload: 'AAAA\nBBBB' })).toBe(false);
		expect(isRoomFrame({ type: 'update', payload: 'AAAA\rBBBB' })).toBe(false);
	});

	it('refuses a payload that is not a string', () => {
		// These reached `appendFile` and were written as the text `undefined` or
		// `[object Object]`, then handed to the next client to join as an update.
		for (const payload of [undefined, null, 42, {}, [], true]) {
			expect(isRoomFrame({ type: 'update', payload })).toBe(false);
		}
	});

	it('refuses an empty payload', () => {
		expect(isRoomFrame({ type: 'update', payload: '' })).toBe(false);
	});

	it('refuses a generation that is not a whole number', () => {
		// It ends up in a filename.
		for (const generation of [1.5, -1, NaN, Infinity, '1', null, undefined]) {
			expect(isRoomFrame({ type: 'compact', payload: 'AAAA', generation })).toBe(false);
		}
	});

	it('refuses history whose entries are not payloads', () => {
		expect(isRoomFrame({ type: 'history', updates: [null], generation: 1 })).toBe(false);
		expect(isRoomFrame({ type: 'history', updates: 'AAAA', generation: 1 })).toBe(false);
	});

	it('refuses a type it does not know', () => {
		expect(isRoomFrame({ type: 'delete-everything', payload: 'AAAA' })).toBe(false);
		expect(isRoomFrame({})).toBe(false);
		expect(isRoomFrame(null)).toBe(false);
	});
});

describe('isSafeId', () => {
	it('accepts the ids this protocol makes', () => {
		expect(isSafeId('0123456789abcdef')).toBe(true);
		expect(isSafeId('a'.repeat(64))).toBe(true);
	});

	it('refuses anything that could be a path', () => {
		for (const id of ['../../etc/passwd', 'a/b', 'a.b', '..', '', 'ABCDEF0123456789']) {
			expect(isSafeId(id)).toBe(false);
		}
	});
});
