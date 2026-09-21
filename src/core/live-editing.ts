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
	/** Path to whoever claimed it, so only that claimant can give it up again. */
	private readonly paths = new Map<string, object>();
	private readonly listeners = new Set<() => void>();

	/**
	 * The session for this path is now the authority on its contents.
	 *
	 * `owner` is the session itself. Ending a session writes its text back to
	 * disk first and only lets go afterwards, which takes long enough for the
	 * note to have been opened again in the meantime — and the old session's
	 * release would then take the claim the new one had just made, handing an
	 * actively collaborated note back to the file sync.
	 */
	claim(path: string, owner: object): void {
		this.paths.set(path, owner);
		this.changed();
	}

	/** Back to being an ordinary file, if this is still the claimant's to say. */
	release(path: string, owner: object): void {
		if (this.paths.get(path) !== owner) {
			return;
		}
		this.paths.delete(path);
		this.changed();
	}

	/**
	 * Tells anything showing this state to redraw.
	 *
	 * The sync indicator in a note's header says whether that note is being edited
	 * together, and a session starts and ends without the workspace changing in any
	 * way the indicator would otherwise hear about.
	 */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private changed(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}

	isLive(path: string): boolean {
		return this.paths.has(path);
	}

	list(): string[] {
		return [...this.paths.keys()].sort();
	}

	get size(): number {
		return this.paths.size;
	}
}
