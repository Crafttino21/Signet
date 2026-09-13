import { describe, expect, it } from 'vitest';
import { CHANGELOG, compareVersions, isNewer, notesFor, notesSince } from './release';

describe('compareVersions', () => {
	it('orders by number, not by string', () => {
		// The one this project will actually reach, and the one string comparison
		// gets backwards: '0.10.0' sorts before '0.9.0' as text.
		expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
		expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
		expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
	});

	it('treats equal versions as equal', () => {
		expect(compareVersions('0.4.0', '0.4.0')).toBe(0);
	});

	it('reads a missing part as zero', () => {
		expect(compareVersions('1.2', '1.2.0')).toBe(0);
		expect(compareVersions('1.2', '1.2.1')).toBe(-1);
	});

	it('does not choke on something that is not a version', () => {
		// A manifest fetched from a repository is somebody else's file. Nonsense in
		// it must produce "apparently not newer" rather than an exception.
		expect(compareVersions('', '0.4.0')).toBe(-1);
		expect(compareVersions('not-a-version', '0.4.0')).toBe(-1);
	});
});

describe('isNewer', () => {
	it('is false for the same version', () => {
		expect(isNewer('0.4.0', '0.4.0')).toBe(false);
	});

	it('is false for an older one', () => {
		expect(isNewer('0.3.0', '0.4.0')).toBe(false);
	});

	it('is true for a newer one', () => {
		expect(isNewer('0.4.1', '0.4.0')).toBe(true);
	});
});

describe('notesSince', () => {
	const installed = CHANGELOG[0]?.version ?? '0.4.0';

	it('says nothing on a first install', () => {
		// Nothing has been skipped, so there is no changelog to show. Opening one
		// at somebody the moment they install is answering a question they have
		// not asked.
		expect(notesSince(installed, null)).toEqual([]);
	});

	it('says nothing when the version has not moved', () => {
		expect(notesSince(installed, installed)).toEqual([]);
	});

	it('says nothing when an older build has been installed on purpose', () => {
		// Going backwards is not an update, and the notes for versions just left
		// behind would be actively misleading.
		expect(notesSince('0.1.0', installed)).toEqual([]);
	});

	it('reports the release that has just been installed', () => {
		const notes = notesSince(installed, '0.0.1');
		expect(notes.map((note) => note.version)).toContain(installed);
	});

	it('never offers notes for a version that is not installed yet', () => {
		// The list ships with the build, so it can only ever describe this one or
		// an older one — but a note written ahead of its release must not leak out
		// to somebody running the version before it.
		for (const note of notesSince('0.0.1', null)) {
			expect(compareVersions(note.version, '0.0.1')).toBeLessThanOrEqual(0);
		}
	});
});

describe('notesFor', () => {
	it('finds the notes for a released version', () => {
		const version = CHANGELOG[0]?.version ?? '0.4.0';
		expect(notesFor(version).map((note) => note.version)).toEqual([version]);
	});

	it('finds nothing for a version nobody wrote about', () => {
		expect(notesFor('0.0.1')).toEqual([]);
	});
});

describe('the changelog itself', () => {
	it('is ordered newest first', () => {
		for (let i = 1; i < CHANGELOG.length; i += 1) {
			const newer = CHANGELOG[i - 1]?.version ?? '';
			const older = CHANGELOG[i]?.version ?? '';
			expect(compareVersions(newer, older)).toBe(1);
		}
	});

	it('has something to say in every entry', () => {
		// A release listed with no lines under it would open an empty dialog at
		// somebody, which is worse than not being listed at all.
		for (const note of CHANGELOG) {
			expect(note.entries.length).toBeGreaterThan(0);
		}
	});
});
