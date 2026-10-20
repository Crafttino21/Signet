import { describe, expect, it } from 'vitest';
import { diffText, mergeText } from './text-merge';
import type { TextChange } from './text-merge';

/** Applies changes the way the session does: back to front. */
function apply(text: string, changes: readonly TextChange[]): string {
	let result = text;
	for (const change of [...changes].reverse()) {
		result = result.slice(0, change.from) + change.insert + result.slice(change.to);
	}
	return result;
}

describe('diffText', () => {
	it('says nothing about equal texts', () => {
		expect(diffText('same\n', 'same\n')).toEqual([]);
	});

	it('finds the word that changed, not the line', () => {
		const changes = diffText('the quick brown fox\n', 'the slow brown fox\n');
		expect(apply('the quick brown fox\n', changes)).toBe('the slow brown fox\n');
		// Only the differing letters, so the rest of the line keeps its author.
		expect(changes.every((change) => change.to - change.from <= 5)).toBe(true);
	});

	it('keeps two separate edits separate', () => {
		// Prefix and suffix alone would make this one replacement of everything in
		// between, and anything another device typed there would be torn loose.
		const before = 'one\ntwo\nthree\nfour\n';
		const after = 'ONE\ntwo\nthree\nFOUR\n';
		const changes = diffText(before, after);
		expect(apply(before, changes)).toBe(after);
		expect(changes.some((change) => before.slice(change.from, change.to).includes('two'))).toBe(
			false
		);
	});

	it('does not split a character outside the basic plane', () => {
		const before = 'a😀b\n';
		const after = 'a😃b\n';
		expect(apply(before, diffText(before, after))).toBe(after);
	});

	it('copes with texts that have nothing in common', () => {
		expect(apply('abc', diffText('abc', 'xyz'))).toBe('xyz');
		expect(apply('', diffText('', 'new\n'))).toBe('new\n');
		expect(apply('gone\n', diffText('gone\n', ''))).toBe('');
	});
});

describe('mergeText', () => {
	const base = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

	it('keeps the room when nothing changed here', () => {
		const theirs = base.replace('Third', 'Last');
		expect(mergeText(base, base, theirs)).toEqual({
			text: theirs,
			changes: [],
			conflicted: false,
		});
	});

	it('brings changes made here into a room that did not move', () => {
		const ours = base.replace('First', 'Opening');
		const merged = mergeText(base, ours, base);
		expect(merged.text).toBe(ours);
		expect(apply(base, merged.changes)).toBe(ours);
	});

	it('merges changes made in different places on both sides', () => {
		// The member who was cut off edited the top; the others edited the bottom.
		const ours = base.replace('First', 'Opening');
		const theirs = base.replace('Third', 'Closing');
		const merged = mergeText(base, ours, theirs);

		expect(merged.conflicted).toBe(false);
		expect(merged.text).toBe(
			'Opening paragraph.\n\nSecond paragraph.\n\nClosing paragraph.\n'
		);
		expect(apply(theirs, merged.changes)).toBe(merged.text);
	});

	it('merges two edits in the same line when they do not overlap', () => {
		const line = 'alpha beta gamma\n';
		const merged = mergeText(line, 'ALPHA beta gamma\n', 'alpha beta GAMMA\n');
		expect(merged.conflicted).toBe(false);
		expect(merged.text).toBe('ALPHA beta GAMMA\n');
	});

	it('applies a change both sides made only once', () => {
		// The file sync carried the room's own edit to this device before it
		// rejoined. Applying it again would write the sentence twice.
		const both = `${base}Added on one device.\n`;
		const theirs = `${both}And more since.\n`;
		const merged = mergeText(base, both, theirs);

		expect(merged.conflicted).toBe(false);
		expect(merged.text).toBe(theirs);
		expect(merged.changes).toEqual([]);
	});

	it('takes the longer of two insertions where one continues the other', () => {
		// The same typing caught at two moments.
		const merged = mergeText('ab\n', 'aXb\n', 'aXYZb\n');
		expect(merged.conflicted).toBe(false);
		expect(merged.text).toBe('aXYZb\n');
	});

	it('calls it a conflict when both changed the same words differently', () => {
		const ours = base.replace('Second', 'Mine');
		const theirs = base.replace('Second', 'Yours');
		const merged = mergeText(base, ours, theirs);

		expect(merged.conflicted).toBe(true);
		// The room's version stays; the caller keeps ours beside the note.
		expect(merged.text).toContain('Yours paragraph.');
		expect(merged.text).not.toContain('Mine');
	});

	it('still merges the rest of a note that has one conflict in it', () => {
		const ours = base.replace('Second', 'Mine').replace('Third', 'Closing');
		const theirs = base.replace('Second', 'Yours');
		const merged = mergeText(base, ours, theirs);

		expect(merged.conflicted).toBe(true);
		expect(merged.text).toContain('Yours paragraph.');
		expect(merged.text).toContain('Closing paragraph.');
		expect(apply(theirs, merged.changes)).toBe(merged.text);
	});

	it('keeps a deletion here and an insertion there', () => {
		const ours = base.replace('Second paragraph.\n\n', '');
		const theirs = `${base}Fourth paragraph.\n`;
		const merged = mergeText(base, ours, theirs);

		expect(merged.conflicted).toBe(false);
		expect(merged.text).toBe('First paragraph.\n\nThird paragraph.\nFourth paragraph.\n');
	});
});
