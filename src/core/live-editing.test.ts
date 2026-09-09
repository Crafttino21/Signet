import { describe, expect, it } from 'vitest';
import { LiveEditingRegistry } from './live-editing';

/**
 * The handover between the two things that can write a note.
 *
 * Small as it is, this is the rule that keeps the file sync and the collaborative
 * editor from writing over each other, so it is worth pinning down: a note is
 * claimed while it is being edited together and released the moment it is not.
 */

describe('who owns a note', () => {
	it('hands a note to its session and takes it back', () => {
		const registry = new LiveEditingRegistry();
		expect(registry.isLive('Notes/One.md')).toBe(false);

		registry.claim('Notes/One.md');
		expect(registry.isLive('Notes/One.md')).toBe(true);

		registry.release('Notes/One.md');
		expect(registry.isLive('Notes/One.md')).toBe(false);
	});

	it('leaves every other note alone', () => {
		const registry = new LiveEditingRegistry();
		registry.claim('Notes/One.md');

		expect(registry.isLive('Notes/Two.md')).toBe(false);
		// A prefix is not a path: claiming a note must not claim its folder.
		expect(registry.isLive('Notes')).toBe(false);
		expect(registry.isLive('Notes/One.md.bak')).toBe(false);
	});

	it('claiming the same note twice still releases in one go', () => {
		// Two editors can show one note. The second must not leave the note claimed
		// after the first closes, or the sync would never touch it again.
		const registry = new LiveEditingRegistry();
		registry.claim('Notes/One.md');
		registry.claim('Notes/One.md');

		registry.release('Notes/One.md');
		expect(registry.isLive('Notes/One.md')).toBe(false);
		expect(registry.size).toBe(0);
	});

	it('releasing a note nobody claimed is not an error', () => {
		const registry = new LiveEditingRegistry();
		expect(() => {
			registry.release('Notes/Never.md');
		}).not.toThrow();
	});

	it('lists what the sync has to skip', () => {
		const registry = new LiveEditingRegistry();
		registry.claim('Notes/Two.md');
		registry.claim('Notes/One.md');

		expect(registry.list()).toEqual(['Notes/One.md', 'Notes/Two.md']);
	});
});
