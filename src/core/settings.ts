import type { ModuleDescriptor } from './module';

/**
 * Bump this whenever the shape of {@link SignetSettings} changes in a way that
 * stored data cannot satisfy on its own, and add a step to {@link runMigrations}.
 */
export const SETTINGS_VERSION = 3;

export interface SignetSettings {
	version: number;
	/** Module id -> whether the user switched it on. */
	enabledModules: Record<string, boolean>;
	/** Module id -> that module's own settings object. */
	moduleSettings: Record<string, unknown>;
	/**
	 * Modules already switched on by themselves once. Never switched on again, so
	 * that a later "off" is a decision and stays one.
	 */
	autoEnabled: string[];
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
	if (fromVersion < 3) {
		source = switchOffWhatIsNotInUse(source);
	}
	return source;
}

/** Modules that version 2 switched on for everybody, and what proves one is wanted. */
const NOT_ON_BY_DEFAULT_ANY_MORE = ['vault-sync', 'live-collab'];

/**
 * Undoes version 2 for the two modules it should not have covered.
 *
 * Version 2 switched the sync on everywhere on the grounds that it does nothing
 * until there is a ring. It does nothing visible, but it is not nothing: it puts a
 * screenful of settings in front of someone who has no server, no ring and no way
 * to tell from the page why none of it works. They are now offered when they have
 * something to do, which means they have to start off.
 *
 * A device that had actually finished setting the sync up keeps it. That is the
 * one case where switching it off would take away something that was working.
 */
function switchOffWhatIsNotInUse(source: Record<string, unknown>): Record<string, unknown> {
	const stored = isRecord(source.enabledModules) ? source.enabledModules : {};
	const modules = isRecord(source.moduleSettings) ? source.moduleSettings : {};
	const sync = isRecord(modules['vault-sync']) ? modules['vault-sync'] : {};
	if (sync.registered === true) {
		return source;
	}

	const enabledModules = { ...stored };
	for (const id of NOT_ON_BY_DEFAULT_ANY_MORE) {
		// Only where there is a stored answer to correct. Writing the key otherwise
		// would invent a flag for a module this build may not even have.
		if (id in enabledModules) {
			enabledModules[id] = false;
		}
	}
	return { ...source, enabledModules };
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
): SignetSettings {
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

	const autoEnabled = Array.isArray(migrated.autoEnabled)
		? migrated.autoEnabled.filter((id): id is string => typeof id === 'string')
		: [];

	return { version: SETTINGS_VERSION, enabledModules, moduleSettings, autoEnabled };
}
