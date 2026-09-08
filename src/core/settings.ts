import type { ModuleDescriptor } from './module';

/**
 * Bump this whenever the shape of {@link ToolboxSettings} changes in a way that
 * stored data cannot satisfy on its own, and add a step to {@link runMigrations}.
 */
export const SETTINGS_VERSION = 1;

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

/**
 * Applies schema migrations in order. There is only one schema so far, so this
 * is a pass-through — it exists so that the next bump has an obvious home.
 */
function runMigrations(
	source: Record<string, unknown>,
	fromVersion: number
): Record<string, unknown> {
	// When SETTINGS_VERSION is bumped, transform `source` step by step here:
	//   if (fromVersion < 2) source = { ...source, someNewField: [] };
	void fromVersion;
	return source;
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
	const migrated = runMigrations(source, storedVersion);

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
