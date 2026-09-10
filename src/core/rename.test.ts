import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { FakeVault } from '../test/fake-vault';
import { adoptLegacyFolder } from './rename';

/**
 * The rename must not cost anybody their ring code.
 *
 * Obsidian identifies a plugin by the id in its manifest and stores everything
 * it owns in a folder named after it, so a new id is a different plugin with an
 * empty folder. What is in the old one is not replaceable by shrugging: the
 * ring code is the key to the vault on the server, and the sync state beside it
 * is what stops the next run treating every file as new.
 */

const OLD = '.obsidian/plugins/toolbox';
const NEW = '.obsidian/plugins/signet';

function app(vault: FakeVault): App {
	return vault.app as App;
}

describe('adoptLegacyFolder', () => {
	it('carries the settings and the sync state across', async () => {
		const vault = new FakeVault();
		vault.hidden.set(`${OLD}/data.json`, '{"version":3}');
		vault.hidden.set(`${OLD}/vault-sync-state.json`, '{"baseSeq":7}');

		const report = await adoptLegacyFolder(app(vault), NEW);

		expect(report?.carried).toEqual(['data.json', 'vault-sync-state.json']);
		expect(vault.hidden.get(`${NEW}/data.json`)).toBe('{"version":3}');
		expect(vault.hidden.get(`${NEW}/vault-sync-state.json`)).toBe('{"baseSeq":7}');
	});

	it('copies rather than moves, so a bad move can still be looked at', async () => {
		const vault = new FakeVault();
		vault.hidden.set(`${OLD}/data.json`, '{"version":3}');

		await adoptLegacyFolder(app(vault), NEW);

		expect(vault.hidden.get(`${OLD}/data.json`)).toBe('{"version":3}');
	});

	it('leaves a working install alone', async () => {
		// Running twice must not put a stale copy over settings in use. Having
		// data of its own is the one reliable sign the move already happened.
		const vault = new FakeVault();
		vault.hidden.set(`${OLD}/data.json`, '{"version":3,"stale":true}');
		vault.hidden.set(`${NEW}/data.json`, '{"version":4,"current":true}');

		const report = await adoptLegacyFolder(app(vault), NEW);

		expect(report).toBeUndefined();
		expect(vault.hidden.get(`${NEW}/data.json`)).toBe('{"version":4,"current":true}');
	});

	it('says nothing on a fresh install', async () => {
		await expect(adoptLegacyFolder(app(new FakeVault()), NEW)).resolves.toBeUndefined();
	});

	it('does nothing when the plugin is still running from the old folder', async () => {
		// What an install updated in place looks like: the folder keeps its name
		// while the manifest declares the new id. Obsidian reads the settings from
		// that folder, so there is nothing to move — and writing a copy into the
		// folder named after the id would leave a stale one for a later move to
		// adopt as though it were current.
		const vault = new FakeVault();
		vault.hidden.set(`${OLD}/data.json`, '{"version":3}');

		await expect(adoptLegacyFolder(app(vault), OLD)).resolves.toBeUndefined();
		expect(vault.hidden.has(`${NEW}/data.json`)).toBe(false);
	});

	it('carries what is there when the sync state is missing', async () => {
		// A device that had a ring but never finished setting up the sync.
		const vault = new FakeVault();
		vault.hidden.set(`${OLD}/data.json`, '{"version":3}');

		const report = await adoptLegacyFolder(app(vault), NEW);

		expect(report?.carried).toEqual(['data.json']);
	});
});
