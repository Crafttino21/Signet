import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { authorRanges, colourSlot, COLOUR_SLOTS, otherAuthors } from './authors';
import type { AuthorEntry } from './authors';

/** Two devices' documents kept in step by hand, the way the room does it. */
function pair(): { mine: Y.Doc; theirs: Y.Doc; sync: () => void } {
	const mine = new Y.Doc();
	const theirs = new Y.Doc();
	return {
		mine,
		theirs,
		sync: () => {
			Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine, Y.encodeStateVector(theirs)));
			Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs, Y.encodeStateVector(mine)));
		},
	};
}

function sign(doc: Y.Doc, device: string, name: string): void {
	doc.getMap<AuthorEntry>('authors').set(String(doc.clientID), { device, name });
}

describe('authorRanges', () => {
	it('marks what another device wrote and leaves this one alone', () => {
		const { mine, theirs, sync } = pair();
		mine.getText('content').insert(0, 'mine ');
		sign(mine, 'laptop', 'Laptop');
		sync();
		theirs.getText('content').insert(5, 'theirs');
		sign(theirs, 'phone', 'Phone');
		sync();

		const ranges = authorRanges(
			mine.getText('content'),
			mine.getMap<AuthorEntry>('authors'),
			'laptop'
		);
		expect(mine.getText('content').toString()).toBe('mine theirs');
		expect(ranges).toEqual([{ from: 5, to: 11, device: 'phone', slot: colourSlot('phone') }]);
	});

	it('leaves the seed and unsigned text unmarked', () => {
		// Nobody wrote the note as it already was, and an older Signet does not
		// sign; neither has an author to show.
		const { mine, theirs, sync } = pair();
		theirs.getText('content').insert(0, 'unsigned');
		sync();

		expect(
			authorRanges(mine.getText('content'), mine.getMap<AuthorEntry>('authors'), 'laptop')
		).toEqual([]);
	});

	it('skips deleted text and keeps offsets right after it', () => {
		const { mine, theirs, sync } = pair();
		theirs.getText('content').insert(0, 'abcdef');
		sign(theirs, 'phone', 'Phone');
		sync();
		mine.getText('content').delete(1, 2);
		sync();

		expect(
			authorRanges(mine.getText('content'), mine.getMap<AuthorEntry>('authors'), 'laptop')
		).toEqual([{ from: 0, to: 4, device: 'phone', slot: colourSlot('phone') }]);
	});

	it('treats two sessions of one device as one author', () => {
		const { mine, theirs, sync } = pair();
		theirs.getText('content').insert(0, 'one ');
		sign(theirs, 'phone', 'Phone');
		sync();

		// The same phone again, in a new session with a new client id.
		const later = new Y.Doc();
		Y.applyUpdate(later, Y.encodeStateAsUpdate(mine));
		later.getText('content').insert(4, 'two');
		sign(later, 'phone', 'Phone');
		Y.applyUpdate(mine, Y.encodeStateAsUpdate(later, Y.encodeStateVector(mine)));

		expect(
			authorRanges(mine.getText('content'), mine.getMap<AuthorEntry>('authors'), 'laptop')
		).toEqual([{ from: 0, to: 7, device: 'phone', slot: colourSlot('phone') }]);
		expect(otherAuthors(mine.getMap<AuthorEntry>('authors'), 'laptop')).toEqual([
			{ device: 'phone', name: 'Phone', slot: colourSlot('phone') },
		]);
	});
});

describe('colourSlot', () => {
	it('gives a device the same colour every time', () => {
		expect(colourSlot('device-a')).toBe(colourSlot('device-a'));
		expect(COLOUR_SLOTS).toContain(colourSlot('device-a'));
	});
});
