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

export class CollabEditorBinding {
	private readonly compartment = new Compartment();

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

	/**
	 * Points one editor at a collaborative document.
	 *
	 * Dispatched rather than configured up front because a session may only exist
	 * after the editor does — the room has to be reachable first.
	 */
	bind(view: EditorView, collab: Extension): void {
		view.dispatch({ effects: this.compartment.reconfigure(collab) });
	}

	/** Puts an editor back to ordinary, unshared editing. */
	unbind(view: EditorView): void {
		view.dispatch({ effects: this.compartment.reconfigure([]) });
	}
}
