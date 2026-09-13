import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeVault } from '../test/fake-vault';
import { assertVaultPath, UnsafePathError } from './vault-fs';

/**
 * The bug this file exists for: a path out of a remote manifest went through
 * `normalizePath` and straight into `vault.createBinary`.
 *
 * `normalizePath` tidies separators and normalises unicode. It does not resolve
 * `..` and has no opinion about where a path leads, so the sync had no containment
 * at all — and the config folder, where Obsidian keeps plugin code, is a perfectly
 * legal path inside the vault.
 */

function app(vault: FakeVault): App {
	return vault.app as App;
}

describe('assertVaultPath', () => {
	const vault = new FakeVault();

	it('accepts an ordinary note', () => {
		expect(assertVaultPath(app(vault), 'Notes/Meeting.md')).toBe('Notes/Meeting.md');
	});

	it('accepts the names people actually use', () => {
		// The danger with a check like this is refusing legitimate paths. A vault
		// full of umlauts, spaces, dots and brackets has to keep syncing.
		for (const path of [
			'Notes/Besprechung vom 3. Mai.md',
			'Zettel/Über Bäume.md',
			'a/b/c/d/e.md',
			'archive/2024-01-01 (draft).md',
			'..hidden-but-legal.md',
			'my..notes/x.md',
			'attachments/image.png',
			'no-extension',
		]) {
			expect(assertVaultPath(app(vault), path)).toBe(path);
		}
	});

	it('normalises on the way out', () => {
		// Separators only. Backslash handling belongs to `normalizePath` and is
		// tested there; what matters here is that callers get the normalised form
		// back rather than the string they passed in.
		expect(assertVaultPath(app(vault), 'Notes//Meeting.md')).toBe('Notes/Meeting.md');
	});

	it('refuses a path that climbs out', () => {
		for (const path of ['../evil.md', 'a/../../evil.md', '..', 'a/..', '../..']) {
			expect(() => assertVaultPath(app(vault), path)).toThrow(UnsafePathError);
		}
	});

	it('refuses a climb that happens to come back', () => {
		// Normalises to somewhere harmless, and is still refused. The rule is the
		// shape of the path, not the net result — a rule that has to do arithmetic
		// to answer is one that will get the arithmetic wrong eventually, and a
		// backslash, a unicode trick or an Obsidian release is all it would take.
		expect(() => assertVaultPath(app(vault), 'Notes/../Notes/a.md')).toThrow(UnsafePathError);
	});

	it('refuses an absolute path', () => {
		for (const path of ['/etc/passwd', 'C:/Windows/x', 'c:/Windows/x', '/']) {
			expect(() => assertVaultPath(app(vault), path)).toThrow(UnsafePathError);
		}
	});

	it('refuses the config folder, which is where plugin code lives', () => {
		// Inside the vault and entirely legal as a path, which is the point: a file
		// written to `.obsidian/plugins/x/main.js` is code that runs on next start.
		for (const path of [
			'.obsidian',
			'.obsidian/plugins/evil/main.js',
			'.obsidian/app.json',
			'.obsidian//plugins/evil/main.js',
		]) {
			expect(() => assertVaultPath(app(vault), path)).toThrow(UnsafePathError);
		}
	});

	it('does not refuse a folder that merely starts the same way', () => {
		expect(assertVaultPath(app(vault), '.obsidian-notes/x.md')).toBe('.obsidian-notes/x.md');
	});

	it('refuses anything that is not a usable string', () => {
		for (const path of ['', null, undefined, 42, {}, []]) {
			expect(() => assertVaultPath(app(vault), path)).toThrow(UnsafePathError);
		}
	});
});
