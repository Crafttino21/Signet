import { ViewPlugin } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { editorInfoField } from 'obsidian';

/**
 * Getting from an open note to its CodeMirror view, without reaching into
 * Obsidian's internals.
 *
 * The obvious approach — asking the Markdown view for its editor and reading the
 * `cm` property off it — works but is undocumented. There is a supported path
 * instead: a plugin registers an editor extension, and any extension can see the
 * view it was installed into. So a tiny view plugin announces itself along with
 * the file it is showing, which `editorInfoField` provides and Obsidian exports
 * for precisely this.
 *
 * The compartment is what allows a session to be attached later. The extension is
 * registered once holding nothing, and each editor is reconfigured when its note
 * turns out to have a session.
 */

export interface EditorRegistry {
	/** An editor appeared, showing this file. */
	attach: (path: string, view: EditorView) => void;
	/** That editor is gone. */
	detach: (view: EditorView) => void;
}

/**
 * The smallest edit that turns one text into another.
 *
 * The common prefix and the common suffix are left alone and only what is
 * between them is replaced. Exported for its own tests, and pure so they need no
 * editor: given equal texts it returns nothing at all, which is the case that
 * matters most — it is what makes binding an already-correct note invisible.
 */
export function minimalChange(
	from: string,
	to: string
): { from: number; to: number; insert: string } | undefined {
	if (from === to) {
		return undefined;
	}

	let start = 0;
	const shortest = Math.min(from.length, to.length);
	while (start < shortest && from.charCodeAt(start) === to.charCodeAt(start)) {
		start += 1;
	}

	let end = 0;
	while (
		end < shortest - start &&
		from.charCodeAt(from.length - 1 - end) === to.charCodeAt(to.length - 1 - end)
	) {
		end += 1;
	}

	return {
		from: start,
		to: from.length - end,
		insert: to.slice(start, to.length - end),
	};
}

export class CollabEditorBinding {
	private readonly compartment = new Compartment();
	/**
	 * What each editor is currently bound to.
	 *
	 * Every `file-open` and `active-leaf-change` asks to bind again, and handing
	 * CodeMirror a freshly built `yCollab` each time tears the sync plugin down and
	 * builds another one against the same document for nothing. Remembering the
	 * text a view is already following makes the repeat a no-op.
	 */
	private readonly bound = new WeakMap<EditorView, object>();

	constructor(private readonly registry: EditorRegistry) {}

	/** The extension to hand to `registerEditorExtension`. */
	extension(): Extension {
		const registry = this.registry;

		const announce = ViewPlugin.fromClass(
			class {
				private path: string | undefined;

				constructor(private readonly view: EditorView) {
					// The field is absent in editors that are not Markdown notes, and
					// `false` asks CodeMirror for that rather than throwing.
					const info = view.state.field(editorInfoField, false);
					const path = info?.file?.path;
					if (path !== undefined) {
						this.path = path;
						registry.attach(path, view);
					}
				}

				destroy(): void {
					if (this.path !== undefined) {
						registry.detach(this.view);
					}
				}
			}
		);

		return [this.compartment.of([]), announce];
	}

	/** Whether this editor is already following that document. */
	isBoundTo(view: EditorView, identity: object): boolean {
		return this.bound.get(view) === identity;
	}

	/**
	 * Brings the editor's text in line with the document it is about to follow.
	 *
	 * This has to happen, and it has to happen *before* {@link bind}. Obsidian
	 * fills the editor from the file; the shared document starts empty and only
	 * becomes the note once the room has answered. `y-codemirror.next` never
	 * compares the two — it assumes the editor was created from the document and
	 * only watches for later changes — so the difference between them arrives as
	 * an ordinary insert and the note is shown twice.
	 *
	 * Dispatched on its own, while the compartment is still empty, so that the
	 * correction is not fed back into the shared document as somebody's edit.
	 * Usually there is nothing to correct: a room seeded from this very note
	 * already matches, and then nothing is dispatched at all.
	 */
	syncDoc(view: EditorView, text: string): void {
		const change = minimalChange(view.state.doc.toString(), text);
		if (!change) {
			return;
		}

		// The selection is mapped through the change rather than reset, so a cursor
		// that sits outside the corrected stretch does not move.
		view.dispatch({ changes: change, scrollIntoView: false });
	}

	/**
	 * Points one editor at a collaborative document.
	 *
	 * Dispatched rather than configured up front because a session may only exist
	 * after the editor does — the room has to be reachable first.
	 */
	bind(view: EditorView, collab: Extension, identity: object): void {
		view.dispatch({ effects: this.compartment.reconfigure(collab) });
		this.bound.set(view, identity);
	}

	/** Puts an editor back to ordinary, unshared editing. */
	unbind(view: EditorView): void {
		this.bound.delete(view);
		view.dispatch({ effects: this.compartment.reconfigure([]) });
	}
}
