/**
 * Which notes are currently being edited together.
 *
 * Two things in this plugin can write a note: the file sync, which moves whole
 * files, and the collaborative editor, which moves keystrokes. If both did so at
 * once they would undo each other, and the note would flicker between two
 * versions — the exact failure this project set out to stop happening.
 *
 * The rule is simple and lives here so both sides can see it: while a note has a
 * live session, the session owns it and the file sync leaves it alone. When the
 * session ends the note goes back to being an ordinary file, and the next sync
 * picks it up.
 *
 * This is deliberately shared mutable state on the plugin rather than a message
 * between modules. It is read on every reconcile and has to be exactly current;
 * a stale copy would mean writing over someone's typing.
 */
export class LiveEditingRegistry {
	private readonly paths = new Set<string>();

	/** The session for this path is now the authority on its contents. */
	claim(path: string): void {
		this.paths.add(path);
	}

	/** Back to being an ordinary file. */
	release(path: string): void {
		this.paths.delete(path);
	}

	isLive(path: string): boolean {
		return this.paths.has(path);
	}

	list(): string[] {
		return [...this.paths].sort();
	}

	get size(): number {
		return this.paths.size;
	}
}
