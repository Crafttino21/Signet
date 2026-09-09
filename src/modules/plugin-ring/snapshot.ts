import type { App } from 'obsidian';
import type { PluginApi } from '../../core/obsidian-internals';
import { readPluginData } from './plugin-data';
import { SNAPSHOT_VERSION } from './types';
import type { LocalPlugin, RingSnapshot } from './types';

export interface SnapshotOptions {
	/** Toolbox's own plugin id — always left out, see below. */
	selfId: string;
	/** Plugins whose settings the host does not want to share. */
	excludedIds: readonly string[];
	host: { id: string; name: string };
	seq: number;
	/** What else the ring should carry, such as where the sync server is. */
	sync?: { serverUrl?: string };
}

/**
 * Reads what this device currently has installed, including each plugin's settings.
 *
 * Toolbox is skipped outright. Its own `data.json` holds the ring secret, so
 * including it would both publish the secret into the snapshot and give a client
 * the means to overwrite its own ring state with the host's.
 */
export async function collectLocalPlugins(
	app: App,
	api: PluginApi,
	selfId: string
): Promise<LocalPlugin[]> {
	const installed = api.listInstalled().filter((plugin) => plugin.id !== selfId);

	return Promise.all(
		installed.map(async (plugin) => ({
			...plugin,
			settings: await readPluginData(app, plugin.id),
		}))
	);
}

/**
 * Builds the snapshot the host publishes.
 *
 * Settings of excluded plugins are dropped rather than the plugins themselves —
 * the ring still says "you should have this one, switched on", it just does not
 * carry its configuration.
 */
export async function buildSnapshot(
	app: App,
	api: PluginApi,
	options: SnapshotOptions
): Promise<RingSnapshot> {
	const excluded = new Set(options.excludedIds);
	const local = await collectLocalPlugins(app, api, options.selfId);

	return {
		version: SNAPSHOT_VERSION,
		seq: options.seq,
		host: options.host,
		updatedAt: new Date().toISOString(),
		// Left out entirely rather than written as empty, so a ring without a server
		// carries no field at all.
		...(options.sync?.serverUrl ? { sync: { serverUrl: options.sync.serverUrl } } : {}),
		plugins: local.map((plugin) => ({
			id: plugin.id,
			name: plugin.name,
			version: plugin.version,
			enabled: plugin.enabled,
			isDesktopOnly: plugin.isDesktopOnly,
			settings: excluded.has(plugin.id) ? undefined : plugin.settings,
		})),
	};
}
