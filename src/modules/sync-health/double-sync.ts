import { FileSystemAdapter, Platform } from 'obsidian';
import type { App } from 'obsidian';
import { PluginApi } from '../../core/obsidian-internals';

/**
 * Detects the single most damaging misconfiguration: two sync engines managing
 * the same files.
 *
 * Obsidian's own documentation is blunt about it — *"Avoid syncing the same vault
 * across multiple services … to prevent data conflicts or corruption."* — and it
 * is invisible from inside the vault, because each engine looks perfectly healthy
 * on its own. It shows up only as conflicting copies that nobody caused.
 *
 * Finding it means looking at the folders *above* the vault for the marker files
 * desktop sync clients leave behind. That is access outside the vault, so it is
 * desktop-only, reads nothing but directory listings, and is disclosed in the
 * README as the developer policy requires.
 */

interface ToolMarker {
	tool: string;
	matches: (entry: string) => boolean;
}

const MARKERS: readonly ToolMarker[] = [
	{
		tool: 'Nextcloud',
		matches: (entry) => entry === '.nextcloudsync.log' || /^\.sync_.*\.db$/.test(entry),
	},
	{ tool: 'ownCloud', matches: (entry) => entry === '.owncloudsync.log' },
	{ tool: 'Dropbox', matches: (entry) => entry === '.dropbox' || entry === '.dropbox.cache' },
	{ tool: 'Syncthing', matches: (entry) => entry === '.stfolder' || entry === '.stversions' },
	{ tool: 'Seafile', matches: (entry) => entry === '.seafile-data' },
];

/** Sync plugins that would be the second engine if a desktop client is present. */
const SYNC_PLUGIN_IDS = new Set([
	'nextcloud-sync',
	'remotely-save',
	'obsidian-livesync',
	'webdav-sync',
	'obsidian-git',
]);

export interface DoubleSyncFinding {
	/** The desktop sync client whose folder the vault sits in. */
	tool: string;
	/** How far above the vault it was found, for the explanation. */
	folder: string;
	/** Names of enabled sync plugins — the other half of the problem. */
	plugins: string[];
}

/**
 * Only the sliver of Node this needs. Declaring it here rather than importing
 * Node's types keeps the module free of any reference that could reach a mobile
 * build, where these APIs do not exist.
 */
interface NodeFileSystem {
	readdirSync(path: string): string[];
}

interface NodePath {
	dirname(path: string): string;
}

/** How far up to look. A sync root is never far above a vault in practice. */
const MAX_DEPTH = 6;

export function detectDoubleSync(app: App): DoubleSyncFinding | undefined {
	// Node APIs do not exist on mobile, and the adapter is only a real filesystem
	// on desktop.
	if (!Platform.isDesktopApp || !(app.vault.adapter instanceof FileSystemAdapter)) {
		return undefined;
	}

	const enabledSyncPlugins = (PluginApi.detect(app)?.listInstalled() ?? [])
		.filter((plugin) => plugin.enabled && SYNC_PLUGIN_IDS.has(plugin.id))
		.map((plugin) => plugin.name);

	// Without a second engine inside Obsidian there is nothing to warn about.
	if (enabledSyncPlugins.length === 0) {
		return undefined;
	}

	const fs = require('node:fs') as NodeFileSystem;
	const nodePath = require('node:path') as NodePath;

	let folder = app.vault.adapter.getBasePath();

	for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
		const parent = nodePath.dirname(folder);
		if (parent === folder) {
			break;
		}
		folder = parent;

		let entries: string[];
		try {
			entries = fs.readdirSync(folder);
		} catch {
			// Permissions or a vanished folder — nothing to report either way.
			break;
		}

		for (const marker of MARKERS) {
			if (entries.some((entry) => marker.matches(entry))) {
				return { tool: marker.tool, folder, plugins: enabledSyncPlugins };
			}
		}
	}

	return undefined;
}
