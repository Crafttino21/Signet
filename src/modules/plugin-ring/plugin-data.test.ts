import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeVault } from '../../test/fake-vault';
import { readPluginData, UnsafePluginIdError, writePluginData } from './plugin-data';

/**
 * This file writes other plugins' settings, through the adapter, because the
 * config folder is hidden from the vault index. The id goes into the path.
 *
 * It was never reachable with a hostile id — both callers supply ids that came
 * from a local manifest or from Obsidian's curated catalogue — but that was a
 * property of today's two callers and was written down nowhere. One of the files
 * this could reach is Signet's own `data.json`, which holds the ring code.
 */

function app(vault: FakeVault): App {
	return vault.app as App;
}

describe('writePluginData', () => {
	it('writes where a plugin keeps its settings', async () => {
		const vault = new FakeVault();
		await writePluginData(app(vault), 'dataview', { setting: true });

		// Written through the adapter, which is where the fake keeps files the index
		// never carries — the same distinction the real config folder has.
		expect(vault.hidden.get('.obsidian/plugins/dataview/data.json')).toContain(
			'"setting": true'
		);
	});

	it('accepts the ids plugins really have', async () => {
		const vault = new FakeVault();
		for (const id of ['dataview', 'obsidian-git', 'templater-obsidian', 'my.plugin', 'a_b']) {
			await expect(writePluginData(app(vault), id, {})).resolves.toBeUndefined();
		}
	});

	it('refuses an id that is a way out of the plugins folder', async () => {
		const vault = new FakeVault();
		for (const id of ['../../evil', 'a/b', '..', '.', 'a/../../b', '']) {
			await expect(writePluginData(app(vault), id, {})).rejects.toThrow(UnsafePluginIdError);
		}
	});

	it('writes nothing at all when it refuses', async () => {
		const vault = new FakeVault();
		await expect(writePluginData(app(vault), '../escaped', {})).rejects.toThrow();

		expect(vault.files.size).toBe(0);
		expect(vault.hidden.size).toBe(0);
	});
});

describe('readPluginData', () => {
	it('reads back what was written', async () => {
		const vault = new FakeVault();
		await writePluginData(app(vault), 'dataview', { setting: 1 });

		await expect(readPluginData(app(vault), 'dataview')).resolves.toEqual({ setting: 1 });
	});

	it('treats an impossible id as nothing to read, rather than throwing', async () => {
		// Reading promises "undefined when there is nothing usable", and it is
		// called while building a snapshot — a throw there would take the whole
		// snapshot with it. Writing is the side that refuses loudly.
		const vault = new FakeVault();

		await expect(readPluginData(app(vault), '../../evil')).resolves.toBeUndefined();
	});
});
