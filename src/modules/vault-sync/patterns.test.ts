import { describe, expect, it } from 'vitest';
import { findConflictMarkers, matchConflictName } from './patterns';

describe('matchConflictName', () => {
	it('recognises the Nextcloud desktop client form and finds the original', () => {
		// The exact shape from Nextcloud's own documentation.
		expect(matchConflictName('Arbeit/Projekt (conflicted copy 2026-08-28 093612).md')).toEqual({
			source: 'nextcloud-client',
			originalPath: 'Arbeit/Projekt.md',
			detail: '2026-08-28 093612',
		});
	});

	it('keeps dots in the name out of the extension', () => {
		expect(
			matchConflictName('Notes/v1.2 release (conflicted copy 2026-08-28 093612).md')
				?.originalPath
		).toBe('Notes/v1.2 release.md');
	});

	it('handles a file with no extension', () => {
		expect(matchConflictName('LICENSE (conflicted copy 2026-08-28 093612)')?.originalPath).toBe(
			'LICENSE'
		);
	});

	it('recognises the Dropbox-style variant with a user name', () => {
		const match = matchConflictName("Notiz (Santinos's conflicted copy 2026-08-28).md");

		expect(match?.source).toBe('copy-suffix');
		expect(match?.originalPath).toBe('Notiz.md');
	});

	it('recognises Syncthing conflicts', () => {
		expect(matchConflictName('Ordner/Notiz.sync-conflict-20260908-120000-ABCD123.md')).toEqual({
			source: 'syncthing',
			originalPath: 'Ordner/Notiz.md',
			detail: '20260908-120000-ABCD123',
		});
	});

	it('leaves ordinary files alone, including ones with brackets', () => {
		// A false positive sends the user after a healthy file, which costs more
		// trust than missing an exotic naming scheme.
		expect(matchConflictName('Notiz.md')).toBeUndefined();
		expect(matchConflictName('Rezept (Variante 2).md')).toBeUndefined();
		expect(matchConflictName('Meeting (2026-08-28).md')).toBeUndefined();
		expect(matchConflictName('Kopie von Notiz.md')).toBeUndefined();
	});

	it('does not treat a name that is only the suffix as a copy', () => {
		expect(matchConflictName('(conflicted copy 2026-08-28 093612).md')).toBeUndefined();
	});
});

describe('findConflictMarkers', () => {
	const conflicted = [
		'Vorher',
		'<<<<<<< local',
		'meine Fassung',
		'=======',
		'ihre Fassung',
		'>>>>>>> remote',
		'Nachher',
	].join('\n');

	it('finds a complete marker block with its line numbers', () => {
		expect(findConflictMarkers(conflicted)).toEqual([{ line: 2, endLine: 6 }]);
	});

	it('finds several blocks in one note', () => {
		expect(findConflictMarkers(`${conflicted}\n${conflicted}`)).toHaveLength(2);
	});

	it('ignores markers inside a fenced code block', () => {
		// A note explaining git conflicts must not report itself forever.
		const note = [
			'So sieht ein Git-Konflikt aus:',
			'```',
			'<<<<<<< HEAD',
			'a',
			'=======',
			'b',
			'>>>>>>> branch',
			'```',
			'Ende',
		].join('\n');

		expect(findConflictMarkers(note)).toEqual([]);
	});

	it('ignores an incomplete block', () => {
		expect(findConflictMarkers('<<<<<<< local\nnur der Anfang')).toEqual([]);
		expect(findConflictMarkers('<<<<<<< local\ntext\n=======\nkein Abschluss')).toEqual([]);
	});

	it('does not fire on ordinary text that merely contains angle brackets', () => {
		expect(findConflictMarkers('a --> b, und <<< das hier')).toEqual([]);
		expect(findConflictMarkers('Zitat: >>>>>>> wichtig')).toEqual([]);
	});

	it('handles Windows line endings', () => {
		expect(findConflictMarkers(conflicted.replace(/\n/g, '\r\n'))).toEqual([
			{ line: 2, endLine: 6 },
		]);
	});
});
