import type { ModuleDescriptor } from './module';

/**
 * Bump this whenever the shape of {@link ToolboxSettings} changes in a way that
 * stored data cannot satisfy on its own, and add a step to {@link runMigrations}.
 */
export const SETTINGS_VERSION = 2;

export interface ToolboxSettings {
	version: number;
	/** Module id -> whether the user switched it on. */
	enabledModules: Record<string, boolean>;
	/** Module id -> that module's own settings object. */
	moduleSettings: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Merges stored values over a module's defaults so that a module gaining a new
 * setting does not leave existing users with an undefined field.
 */
function withDefaults(defaults: unknown, stored: unknown): unknown {
	if (isRecord(defaults) && isRecord(stored)) {
		return { ...defaults, ...stored };
	}
	return stored === undefined ? defaults : stored;
}

/** Applies schema migrations in order. */
function runMigrations(
	source: Record<string, unknown>,
	fromVersion: number,
	descriptors: readonly ModuleDescriptor[]
): Record<string, unknown> {
	if (fromVersion < 2) {
		source = switchOnTheDefaults(source, descriptors);
	}
	return source;
}

/**
 * Switches on the modules this plugin exists for.
 *
 * Every module used to default to off, and the first load wrote that off into
 * the stored settings — so the `false` sitting in an existing file is not a
 * decision anybody made, it is the old default. Now that the ring, the sync and
 * live editing start on, that stale `false` would keep them off forever on
 * exactly the installs that have been waiting for them.
 *
 * This runs once. A module switched off afterwards stays off, because from
 * version 2 on the stored value is only ever one the user chose.
 */
function switchOnTheDefaults(
	source: Record<string, unknown>,
	descriptors: readonly ModuleDescriptor[]
): Record<string, unknown> {
	const stored = isRecord(source.enabledModules) ? source.enabledModules : {};
	const enabledModules = { ...stored };

	for (const descriptor of descriptors) {
		if (descriptor.enabledByDefault === true && stored[descriptor.id] === false) {
			enabledModules[descriptor.id] = true;
		}
	}

	return { ...source, enabledModules };
}

/**
 * Turns whatever `loadData()` returned into a valid settings object.
 *
 * `loadData()` is untyped and may return anything — `null` on first run, or data
 * written by an older version of the plugin. Nothing is dropped silently: settings
 * belonging to modules that no longer exist are carried through untouched, so
 * removing a module temporarily does not destroy its configuration.
 */
export function migrateSettings(
	raw: unknown,
	descriptors: readonly ModuleDescriptor[]
): ToolboxSettings {
	const source = isRecord(raw) ? raw : {};
	const storedVersion = typeof source.version === 'number' ? source.version : 0;
	const migrated = runMigrations(source, storedVersion, descriptors);

	const storedEnabled = isRecord(migrated.enabledModules) ? migrated.enabledModules : {};
	const storedModules = isRecord(migrated.moduleSettings) ? migrated.moduleSettings : {};

	const enabledModules: Record<string, boolean> = {};
	const moduleSettings: Record<string, unknown> = { ...storedModules };

	for (const descriptor of descriptors) {
		const enabled = storedEnabled[descriptor.id];
		enabledModules[descriptor.id] =
			typeof enabled === 'boolean' ? enabled : (descriptor.enabledByDefault ?? false);
		moduleSettings[descriptor.id] = withDefaults(
			descriptor.defaultSettings,
			storedModules[descriptor.id]
		);
	}

	// Keep flags for modules we no longer know about.
	for (const [id, enabled] of Object.entries(storedEnabled)) {
		if (!(id in enabledModules) && typeof enabled === 'boolean') {
			enabledModules[id] = enabled;
		}
	}

	return { version: SETTINGS_VERSION, enabledModules, moduleSettings };
}
