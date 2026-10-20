import type * as Y from 'yjs';

/**
 * Who wrote what, in a note being edited together.
 *
 * Yjs already knows: every character carries the id of the client that inserted
 * it. What it does not know is who that client was — ids are random and new for
 * every session. So the document carries a small map beside the text, client id
 * to device, which every session signs on its first keystroke. It travels in the
 * room's history like the text does, so the text keeps its author after the
 * author has left, and survives compaction.
 *
 * A seed is nobody's: it is the note as it already was, written under an id
 * that no session signs. Text from a device that has not signed — an older
 * Signet — stays unmarked too, which is the honest answer to a question there is
 * no answer to.
 *
 * Shown as a tint behind the text rather than in the text's own colour. Links,
 * tags and headings already use colour to mean something, and the theme decides
 * what those are; a background stays out of their way in light and dark alike.
 */

/** One entry in the document's author map, keyed by Yjs client id. */
export interface AuthorEntry {
	/** The device id, or its name where there is none. Decides the colour. */
	device: string;
	/** What to call it. */
	name: string;
}

/**
 * Obsidian's own palette, which every theme defines in both modes.
 *
 * A fixed set of named slots rather than a colour computed per device: those
 * would be inline styles and hard-coded colours, and they would ignore the theme.
 */
export const COLOUR_SLOTS = [
	'red',
	'orange',
	'yellow',
	'green',
	'cyan',
	'blue',
	'purple',
	'pink',
] as const;

export type ColourSlot = (typeof COLOUR_SLOTS)[number];

/** A stable colour per device, so its cursor and its text always match. */
export function colourSlot(key: string): ColourSlot {
	let hash = 0;
	for (const character of key) {
		hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003;
	}
	return COLOUR_SLOTS[hash % COLOUR_SLOTS.length] ?? 'blue';
}

export interface AuthorRange {
	from: number;
	to: number;
	device: string;
	slot: ColourSlot;
}

/**
 * The stretches of the text written by somebody other than `ownKey`.
 *
 * Walks the text's items in document order, which is what Yjs keeps them in.
 * Offsets count UTF-16 units, the same as the editor's.
 */
export function authorRanges(
	text: Y.Text,
	authors: Y.Map<AuthorEntry>,
	ownKey: string
): AuthorRange[] {
	const ranges: AuthorRange[] = [];
	let position = 0;

	for (let item = text._start; item !== null; item = item.right) {
		if (item.deleted || !item.countable) {
			continue;
		}
		const author = authors.get(String(item.id.client));
		if (author && author.device !== ownKey) {
			const last = ranges[ranges.length - 1];
			if (last && last.to === position && last.device === author.device) {
				last.to += item.length;
			} else {
				ranges.push({
					from: position,
					to: position + item.length,
					device: author.device,
					slot: colourSlot(author.device),
				});
			}
		}
		position += item.length;
	}
	return ranges;
}

/** Everybody but this device who has signed the document, once each. */
export function otherAuthors(
	authors: Y.Map<AuthorEntry>,
	ownKey: string
): { device: string; name: string; slot: ColourSlot }[] {
	const byDevice = new Map<string, { device: string; name: string; slot: ColourSlot }>();
	for (const entry of authors.values()) {
		if (entry.device === ownKey) {
			continue;
		}
		byDevice.set(entry.device, {
			device: entry.device,
			name: entry.name,
			slot: colourSlot(entry.device),
		});
	}
	return [...byDevice.values()].sort((a, b) => a.name.localeCompare(b.name));
}
