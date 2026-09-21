import { describe, expect, it } from 'vitest';
import { LiveEditingRegistry } from './live-editing';

/**
 * The handover between the two things that can write a note.
 *
 * Small as it is, this is the rule that keeps the file sync and the collaborative
 * editor from writing over each other, so it is worth pinning down: a note is
 * claimed while it is being edited together and released the moment it is not.
 */

/** Stands in for a session. Only its identity matters here. */
function session(): object {
	return {};
}

describe('who owns a note', () => {
	it('hands a note to its session and takes it back', () => {
		const registry = new LiveEditingRegistry();
		const one = session();
		expect(registry.isLive('Notes/One.md')).toBe(false);

		registry.claim('Notes/One.md', one);
		expect(registry.isLive('Notes/One.md')).toBe(true);

		registry.release('Notes/One.md', one);
		expect(registry.isLive('Notes/One.md')).toBe(false);
	});

	it('leaves every other note alone', () => {
		const registry = new LiveEditingRegistry();
		registry.claim('Notes/One.md', session());

		expect(registry.isLive('Notes/Two.md')).toBe(false);
		// A prefix is not a path: claiming a note must not claim its folder.
		expect(registry.isLive('Notes')).toBe(false);
		expect(registry.isLive('Notes/One.md.bak')).toBe(false);
	});

	it('claiming the same note twice still releases in one go', () => {
		// Two editors can show one note, and they share a session. The second claim
		// must not leave the note claimed after the first closes, or the sync would
		// never touch it again.
		const registry = new LiveEditingRegistry();
		const one = session();
		registry.claim('Notes/One.md', one);
		registry.claim('Notes/One.md', one);

		registry.release('Notes/One.md', one);
		expect(registry.isLive('Notes/One.md')).toBe(false);
		expect(registry.size).toBe(0);
	});

	it('releasing a note nobody claimed is not an error', () => {
		const registry = new LiveEditingRegistry();
		expect(() => {
			registry.release('Notes/Never.md', session());
		}).not.toThrow();
	});

	it('lists what the sync has to skip', () => {
		const registry = new LiveEditingRegistry();
		registry.claim('Notes/Two.md', session());
		registry.claim('Notes/One.md', session());

		expect(registry.list()).toEqual(['Notes/One.md', 'Notes/Two.md']);
	});
});

describe('a session that ends while the note is opened again', () => {
	// Ending a session writes its text back to disk before letting go, and that
	// write is long enough for the note to be reopened in the meantime — a layout
	// change is enough. The old session must not then take the claim the new one
	// has just made, or the file sync would start moving a note that is being
	// edited together. Which, because the sync excludes what it is told to
	// exclude, is also how the note stops appearing in the manifest at all.

	it('does not let the old session take the claim the new one made', () => {
		const registry = new LiveEditingRegistry();
		const old = session();
		const fresh = session();

		registry.claim('Notes/One.md', old);
		registry.claim('Notes/One.md', fresh);

		// The old session's write-back finishes here, long after it was replaced.
		registry.release('Notes/One.md', old);

		expect(registry.isLive('Notes/One.md')).toBe(true);
		expect(registry.list()).toEqual(['Notes/One.md']);
	});

	it('still lets the session that holds it let go', () => {
		const registry = new LiveEditingRegistry();
		const old = session();
		const fresh = session();

		registry.claim('Notes/One.md', old);
		registry.claim('Notes/One.md', fresh);
		registry.release('Notes/One.md', old);
		registry.release('Notes/One.md', fresh);

		expect(registry.isLive('Notes/One.md')).toBe(false);
	});
});
