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
				version: 1,
				enabledModules: { alpha: false },
				moduleSettings: { alpha: { greeting: 'moin' } },
			},
			descriptors
		);

		expect(settings.enabledModules.alpha).toBe(false);
		// `greeting` survives, `count` is added from the defaults.
		expect(settings.moduleSettings.alpha).toEqual({ greeting: 'moin', count: 1 });
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
