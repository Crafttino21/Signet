import { describe, expect, it } from 'vitest';
import { minimalChange } from './editor-binding';

/**
 * The bug this file exists for: a note appearing twice for a second or two after
 * it is opened.
 *
 * Obsidian fills the editor from the file, and the shared document starts empty
 * and only becomes the note once the room has answered. `y-codemirror.next` never
 * compares the two — it watches the document for changes and assumes the editor
 * started out as a copy of it — so the note arriving in the document was pushed
 * into an editor that already had it, and every remote change after that landed
 * at an offset computed against a buffer twice the length it should be.
 *
 * The answer is to bring the buffer in line *before* binding, and to do it with
 * the smallest edit that works so that a cursor sitting elsewhere does not move.
 */
describe('minimalChange', () => {
	it('asks for nothing when the two already agree', () => {
		// The ordinary case, and the one worth being sure about: a room seeded from
		// this very note matches it exactly, so opening a note must be invisible.
		expect(minimalChange('# Notes\n\nSomething.', '# Notes\n\nSomething.')).toBeUndefined();
		expect(minimalChange('', '')).toBeUndefined();
	});

	it('replaces only what actually differs', () => {
		expect(minimalChange('the quick brown fox', 'the slow brown fox')).toEqual({
			from: 4,
			to: 9,
			insert: 'slow',
		});
	});

	it('inserts without touching what is around it', () => {
		expect(minimalChange('ab', 'axb')).toEqual({ from: 1, to: 1, insert: 'x' });
	});

	it('deletes without touching what is around it', () => {
		expect(minimalChange('axb', 'ab')).toEqual({ from: 1, to: 2, insert: '' });
	});

	it('fills an empty buffer', () => {
		expect(minimalChange('', 'hello')).toEqual({ from: 0, to: 0, insert: 'hello' });
	});

	it('empties a buffer', () => {
		expect(minimalChange('hello', '')).toEqual({ from: 0, to: 5, insert: '' });
	});

	it('never rewrites a note as itself twice over', () => {
		// Literally the reported symptom. Binding used to hand CodeMirror an insert
		// of the whole note at position 0; the smallest correct edit here is none.
		const note = '# Meeting\n\n- one\n- two\n';
		expect(minimalChange(note, note)).toBeUndefined();
		// And if the room really does hold the note twice over, we say so as a
		// single append rather than a rewrite of the whole buffer.
		expect(minimalChange(note, note + note)).toEqual({
			from: note.length,
			to: note.length,
			insert: note,
		});
	});

	it('does not let the prefix and the suffix overlap', () => {
		// 'aa' -> 'aaa' shares two characters at the front and two at the back, but
		// only two exist. Counting both would produce a negative-length range.
		const change = minimalChange('aa', 'aaa');
		expect(change).toBeDefined();
		expect(change?.to).toBeGreaterThanOrEqual(change?.from ?? 0);
		expect(applied('aa', change)).toBe('aaa');
	});

	it('round-trips a handful of awkward pairs', () => {
		const pairs: [string, string][] = [
			['', 'x'],
			['x', ''],
			['abc', 'abc'],
			['abcabc', 'abc'],
			['line one\nline two\n', 'line one\nline 2\nline three\n'],
			['🙂 hello', '🙂 hi'],
			['aaaa', 'aa'],
		];
		for (const [from, to] of pairs) {
			expect(applied(from, minimalChange(from, to))).toBe(to);
		}
	});
});

/** What CodeMirror would end up with, so the tests check the result and not the shape. */
function applied(
	source: string,
	change: { from: number; to: number; insert: string } | undefined
): string {
	if (!change) {
		return source;
	}
	return source.slice(0, change.from) + change.insert + source.slice(change.to);
}
