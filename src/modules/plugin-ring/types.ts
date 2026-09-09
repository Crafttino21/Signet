/** Shapes shared between the pure logic and the parts that talk to Obsidian. */

export const SNAPSHOT_VERSION = 1;

export interface RingPluginEntry {
	id: string;
	name: string;
	version: string;
	enabled: boolean;
	isDesktopOnly: boolean;
	/** The plugin's data.json, or undefined when the host chose not to share it. */
	settings?: unknown;
}

export interface RingSnapshot {
	version: number;
	/**
	 * Incremented on every publish. A host only overwrites the ring file when the
	 * sequence it last saw is still the current one, which is what stops two
	 * devices that both think they are host from silently clobbering each other.
	 */
	seq: number;
	host: { id: string; name: string };
	updatedAt: string;
	plugins: RingPluginEntry[];
}

export interface LocalPlugin {
	id: string;
	name: string;
	version: string;
	enabled: boolean;
	isDesktopOnly: boolean;
	settings?: unknown;
}

export type DiffKind =
	| 'missing' // Host has it, this device does not.
	| 'enable'
	| 'disable'
	| 'version' // Installed, but a different version than the host.
	| 'settings'
	| 'extra'; // This device has it, the host does not.

/**
 * Why an item is not actionable. A code rather than a sentence, so that the diff
 * logic stays free of display text and the wording lives with the translations.
 */
export type DiffReason =
	'desktopOnly' | 'notInstalled' | 'cannotInstall' | 'noUpdate' | 'hostLacks';

export interface DiffItem {
	kind: DiffKind;
	id: string;
	name: string;
	hostVersion?: string;
	localVersion?: string;
	/** False when this device cannot carry the change out — see {@link reason}. */
	actionable: boolean;
	reason?: DiffReason;
}

/** What the client will actually do to one plugin, applied as a single unit. */
export interface PluginPlan {
	id: string;
	name: string;
	/** Version to fetch first, when this device does not have the plugin at all. */
	install?: string;
	/** data.json to write, or undefined to leave it alone. */
	settings?: unknown;
	/** Desired enabled state, or undefined to leave it alone. */
	enabled?: boolean;
}

export function isRingSnapshot(value: unknown): value is RingSnapshot {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<RingSnapshot>;
	return (
		typeof candidate.version === 'number' &&
		typeof candidate.seq === 'number' &&
		typeof candidate.updatedAt === 'string' &&
		typeof candidate.host === 'object' &&
		candidate.host !== null &&
		typeof candidate.host.id === 'string' &&
		Array.isArray(candidate.plugins)
	);
}
