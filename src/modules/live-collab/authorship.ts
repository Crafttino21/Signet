import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import type * as Y from 'yjs';
import { authorRanges, COLOUR_SLOTS } from './authors';
import type { AuthorEntry, ColourSlot } from './authors';

/**
 * Tints other devices' text in an editor following a shared note.
 *
 * Who wrote which character is worked out in `authors.ts`, which needs nothing
 * but Yjs; this is only the part that draws it.
 */

/**
 * How long after a change the marks are worked out again.
 *
 * In between, the existing marks are carried through each edit, which is cheap
 * and almost always right. Rebuilding on every keystroke would walk the whole
 * note each time somebody typed a letter.
 */
const REBUILD_MS = 150;

const rebuild = StateEffect.define<null>();

const MARKS = Object.fromEntries(
	COLOUR_SLOTS.map((slot) => [
		slot,
		Decoration.mark({ class: `signet-author signet-author--${slot}` }),
	])
) as Record<ColourSlot, Decoration>;

/** The editor extension that tints other devices' text. */
export function authorship(
	text: Y.Text,
	authors: Y.Map<AuthorEntry>,
	ownKey: string
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private timer: number | undefined;
			private readonly onAuthors = (): void => {
				this.schedule();
			};

			constructor(private readonly view: EditorView) {
				this.decorations = this.build();
				authors.observe(this.onAuthors);
			}

			update(update: ViewUpdate): void {
				if (update.transactions.some((tr) => tr.effects.some((e) => e.is(rebuild)))) {
					this.decorations = this.build();
					return;
				}
				if (update.docChanged) {
					this.decorations = this.decorations.map(update.changes);
					this.schedule();
				}
			}

			/**
			 * Rebuilt in a transaction of its own rather than inside the one that
			 * changed the text. During that one the shared document may not have
			 * caught up with the editor yet, and marks computed from it would sit a
			 * few characters off.
			 */
			private schedule(): void {
				if (this.timer !== undefined) {
					return;
				}
				this.timer = window.setTimeout(() => {
					this.timer = undefined;
					this.view.dispatch({ effects: rebuild.of(null) });
				}, REBUILD_MS);
			}

			private build(): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const length = this.view.state.doc.length;
				for (const range of authorRanges(text, authors, ownKey)) {
					const to = Math.min(range.to, length);
					if (range.from < to) {
						builder.add(range.from, to, MARKS[range.slot]);
					}
				}
				return builder.finish();
			}

			destroy(): void {
				authors.unobserve(this.onAuthors);
				if (this.timer !== undefined) {
					window.clearTimeout(this.timer);
					this.timer = undefined;
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations }
	);
}
