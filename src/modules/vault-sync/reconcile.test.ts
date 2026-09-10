import { describe, expect, it } from 'vitest';
import type { VaultManifest } from '@signet/protocol';
import { conflictPath, reconcile, touchesLocalFiles } from './reconcile';
import type { IndexEntry } from './reconcile';
import { matchConflictName } from './patterns';

/**
 * The decisions these tests pin down are the ones that cost notes when they are
 * wrong. Each case names the situation it protects against.
 */

function entry(path: string, hash: string): IndexEntry {
	return { path, hash, size: hash.length, mtime: 1_000 };
}

function manifest(
	files: readonly IndexEntry[],
	deleted: readonly string[] = [],
	seq = 1
): VaultManifest {
	return {
		version: 1,
		seq,
		device: { id: 'other', name: 'Other device' },
		updatedAt: '2026-09-09T12:00:00.000Z',
		files: files.map((file) => ({ ...file, blob: `blob-${file.hash}` })),
		deleted: deleted.map((path) => ({ path, deletedAt: 1_000 })),
	};
}

describe('a file that only one side changed', () => {
	it('pulls when the remote moved and we did not', () => {
		const actions = reconcile({
			base: manifest([entry('a.md', 'v1')]),
			local: [entry('a.md', 'v1')],
			remote: manifest([entry('a.md', 'v2')]),
		});

		expect(actions).toEqual([expect.objectContaining({ kind: 'download', path: 'a.md' })]);
	});

	it('pushes when we moved and the remote did not', () => {
		const actions = reconcile({
			base: manifest([entry('a.md', 'v1')]),
			local: [entry('a.md', 'v2')],
			remote: manifest([entry('a.md', 'v1')]),
		});

		expect(actions).toEqual([{ kind: 'upload', path: 'a.md' }]);
	});

	it('does nothing when both sides already agree', () => {
		expect(
			reconcile({
				base: manifest([entry('a.md', 'v1')]),
				local: [entry('a.md', 'v1')],
				remote: manifest([entry('a.md', 'v1')]),
			})
		).toEqual([]);
	});

	it('does nothing when both changed to the same content', () => {
		// Two devices typing the same correction should converge, not conflict.
		expect(
			reconcile({
				base: manifest([entry('a.md', 'v1')]),
				local: [entry('a.md', 'v2')],
				remote: manifest([entry('a.md', 'v2')]),
			})
		).toEqual([]);
	});
});

describe('a file both sides changed', () => {
	it('keeps both rather than picking a winner', () => {
		const actions = reconcile({
			base: manifest([entry('a.md', 'v1')]),
			local: [entry('a.md', 'mine')],
			remote: manifest([entry('a.md', 'theirs')]),
		});

		// "Newer wins" would be a guess, and the guess costs a note.
		expect(actions).toEqual([expect.objectContaining({ kind: 'conflict', path: 'a.md' })]);
	});

	it('treats a difference with no base as a conflict', () => {
		// A first run cannot tell who changed, so it must not choose.
		const actions = reconcile({
			local: [entry('a.md', 'mine')],
			remote: manifest([entry('a.md', 'theirs')]),
		});

		expect(actions).toEqual([expect.objectContaining({ kind: 'conflict', path: 'a.md' })]);
	});
});

describe('new files', () => {
	it('uploads a file only this device has', () => {
		expect(reconcile({ local: [entry('new.md', 'v1')], remote: manifest([]) })).toEqual([
			{ kind: 'upload', path: 'new.md' },
		]);
	});

	it('downloads a file only the server has', () => {
		expect(reconcile({ local: [], remote: manifest([entry('new.md', 'v1')]) })).toEqual([
			expect.objectContaining({ kind: 'download', path: 'new.md' }),
		]);
	});

	it('uploads everything when the server is empty', () => {
		expect(reconcile({ local: [entry('a.md', 'v1'), entry('b.md', 'v2')] })).toEqual([
			{ kind: 'upload', path: 'a.md' },
			{ kind: 'upload', path: 'b.md' },
		]);
	});
});

describe('deletions', () => {
	it('follows a remote deletion of a file we had not touched', () => {
		const actions = reconcile({
			base: manifest([entry('a.md', 'v1')]),
			local: [entry('a.md', 'v1')],
			remote: manifest([], ['a.md']),
		});

		expect(actions).toEqual([{ kind: 'deleteLocal', path: 'a.md' }]);
	});

	it('keeps a file we edited even though the remote deleted it', () => {
		const actions = reconcile({
			base: manifest([entry('a.md', 'v1')]),
			local: [entry('a.md', 'edited')],
			remote: manifest([], ['a.md']),
		});

		// Losing work to someone else's deletion is the worst outcome available,
		// so the edit wins and the file goes back.
		expect(actions).toEqual([{ kind: 'resurrect', path: 'a.md' }]);
	});

	it('propagates a deletion this device made', () => {
		const actions = reconcile({
			base: manifest([entry('a.md', 'v1')]),
			local: [],
			remote: manifest([entry('a.md', 'v1')]),
		});

		expect(actions).toEqual([{ kind: 'deleteRemote', path: 'a.md' }]);
	});

	it('never infers a deletion without a base', () => {
		// A device that has not synced yet is simply missing files; treating that
		// as "the user deleted them" would wipe the vault everywhere.
		const actions = reconcile({ local: [], remote: manifest([entry('a.md', 'v1')]) });

		expect(actions).toEqual([expect.objectContaining({ kind: 'download', path: 'a.md' })]);
	});

	it('stays quiet when both sides deleted the same file', () => {
		expect(
			reconcile({
				base: manifest([entry('a.md', 'v1')]),
				local: [],
				remote: manifest([], ['a.md']),
			})
		).toEqual([]);
	});
});

describe('touchesLocalFiles', () => {
	it('lists only what would change on this device', () => {
		const actions = reconcile({
			base: manifest([entry('keep.md', 'v1'), entry('gone.md', 'v1')]),
			local: [entry('keep.md', 'v1'), entry('gone.md', 'v1'), entry('mine.md', 'v1')],
			remote: manifest([entry('keep.md', 'v2')], ['gone.md']),
		});

		expect(
			touchesLocalFiles(actions)
				.map((action) => action.kind)
				.sort()
		).toEqual(['deleteLocal', 'download']);
	});
});

describe('conflictPath', () => {
	const when = new Date('2026-09-09T13:30:00.000Z');

	it('names the copy so it is recognisable as one', () => {
		const path = conflictPath('Arbeit/Notiz.md', when);

		expect(path).toBe('Arbeit/Notiz (conflicted copy 2026-09-09 133000).md');
		// The guardian built earlier must be able to pair it with its original.
		expect(matchConflictName(path)?.originalPath).toBe('Arbeit/Notiz.md');
	});

	it('handles a name with dots and one without an extension', () => {
		expect(conflictPath('v1.2 Notes.md', when)).toBe(
			'v1.2 Notes (conflicted copy 2026-09-09 133000).md'
		);
		expect(conflictPath('LICENSE', when)).toBe('LICENSE (conflicted copy 2026-09-09 133000)');
	});

	it('does not mistake a folder dot for an extension', () => {
		expect(conflictPath('my.folder/note', when)).toBe(
			'my.folder/note (conflicted copy 2026-09-09 133000)'
		);
	});
});
