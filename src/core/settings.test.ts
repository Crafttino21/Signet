import { describe, expect, it } from 'vitest';
import { SETTINGS_VERSION, migrateSettings } from './settings';
import type { ModuleDescriptor } from './module';

const descriptors = [
	{
		id: 'alpha',
		name: 'Alpha',
		description: 'First',
		defaultSettings: { greeting: 'hi', count: 1 },
		enabledByDefault: true,
		create: () => {
			throw new Error('not needed for these tests');
		},
	},
	{
		id: 'beta',
		name: 'Beta',
		description: 'Second',
		defaultSettings: {},
		create: () => {
			throw new Error('not needed for these tests');
		},
	},
] as unknown as readonly ModuleDescriptor[];

describe('migrateSettings', () => {
	it('falls back to defaults when there is no stored data', () => {
		const settings = migrateSettings(null, descriptors);

		expect(settings.version).toBe(SETTINGS_VERSION);
		expect(settings.enabledModules).toEqual({ alpha: true, beta: false });
		expect(settings.moduleSettings.alpha).toEqual({ greeting: 'hi', count: 1 });
	});

	it('ignores data that is not an object', () => {
		expect(migrateSettings('nonsense', descriptors).enabledModules.alpha).toBe(true);
		expect(migrateSettings([1, 2, 3], descriptors).enabledModules.beta).toBe(false);
	});

	it('keeps the stored value for a setting and fills in newly added ones', () => {
		const settings = migrateSettings(
			{
				version: 2,
				enabledModules: { alpha: false },
				moduleSettings: { alpha: { greeting: 'moin' } },
			},
			descriptors
		);

		expect(settings.enabledModules.alpha).toBe(false);
		// `greeting` survives, `count` is added from the defaults.
		expect(settings.moduleSettings.alpha).toEqual({ greeting: 'moin', count: 1 });
	});

	it('switches on a module that used to default to off, once', () => {
		// The `false` in a version 1 file is the old default rather than anybody's
		// decision — every module used to start off, and the first load wrote that
		// down. Left alone it would keep the main features off forever.
		const settings = migrateSettings(
			{ version: 1, enabledModules: { alpha: false, beta: false }, moduleSettings: {} },
			descriptors
		);

		expect(settings.enabledModules.alpha).toBe(true);
		// Only for modules that default to on now; the rest are untouched.
		expect(settings.enabledModules.beta).toBe(false);
	});

	it('leaves a module switched off after that migration alone', () => {
		const once = migrateSettings(
			{ version: 1, enabledModules: { alpha: false }, moduleSettings: {} },
			descriptors
		);
		expect(once.enabledModules.alpha).toBe(true);

		// The user switches it off again, and it is written back at the new version.
		const off = { ...once, enabledModules: { ...once.enabledModules, alpha: false } };

		expect(migrateSettings(off, descriptors).enabledModules.alpha).toBe(false);
	});

	it('does not discard settings of modules it no longer knows', () => {
		const settings = migrateSettings(
			{
				version: 1,
				enabledModules: { removed: true },
				moduleSettings: { removed: { keep: 'me' } },
			},
			descriptors
		);

		expect(settings.enabledModules.removed).toBe(true);
		expect(settings.moduleSettings.removed).toEqual({ keep: 'me' });
	});
});

/**
 * Version 3 undoes version 2 for the two sync modules.
 *
 * Version 2 switched them on everywhere, on the grounds that they do nothing
 * until there is a ring. They do nothing visible — but they put a page of
 * settings in front of someone with no ring and no server, and no way to tell
 * from the page why none of it works.
 */
describe('switching off what is not in use', () => {
	const sync = [
		{
			id: 'vault-sync',
			name: 'Vault sync',
			description: '',
			defaultSettings: {},
			create: () => {
				throw new Error('not needed for these tests');
			},
		},
		{
			id: 'live-collab',
			name: 'Live editing',
			description: '',
			defaultSettings: {},
			create: () => {
				throw new Error('not needed for these tests');
			},
		},
	] as unknown as readonly ModuleDescriptor[];

	it('switches them off on a device that never finished setting up', () => {
		const settings = migrateSettings(
			{
				version: 2,
				enabledModules: { 'vault-sync': true, 'live-collab': true },
				moduleSettings: { 'vault-sync': { registered: false } },
			},
			sync
		);

		expect(settings.enabledModules).toEqual({ 'vault-sync': false, 'live-collab': false });
	});

	it('leaves a working sync alone', () => {
		// The one case where switching it off would take away something that works.
		const settings = migrateSettings(
			{
				version: 2,
				enabledModules: { 'vault-sync': true, 'live-collab': true },
				moduleSettings: { 'vault-sync': { registered: true } },
			},
			sync
		);

		expect(settings.enabledModules).toEqual({ 'vault-sync': true, 'live-collab': true });
	});

	it('runs once and then leaves the choice alone', () => {
		const settings = migrateSettings(
			{
				version: SETTINGS_VERSION,
				enabledModules: { 'vault-sync': true },
				moduleSettings: { 'vault-sync': { registered: false } },
			},
			sync
		);

		expect(settings.enabledModules['vault-sync']).toBe(true);
	});
});
