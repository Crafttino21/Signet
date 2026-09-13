import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Reading and writing another plugin's `data.json`.
 *
 * The plugin folder lives under the config directory, which Obsidian treats as a
 * hidden folder — the documentation is explicit that hidden folders are reachable
 * only through the adapter API, never the vault API. `configDir` is read from the
 * app rather than hardcoded as `.obsidian`, because it is configurable.
 */

/**
 * Whether a string is a plugin id and not a way out of the plugins folder.
 *
 * `dataPath` interpolates this into a path and writes it through the adapter —
 * the raw filesystem, because the config folder is hidden from the vault index.
 * `normalizePath` tidies separators and does not resolve `..`, so an id of
 * `../../x` was a write anywhere the vault can reach.
 *
 * It was not reachable: both callers supply ids that came from a local manifest
 * or from Obsidian's curated catalogue. But that is a property of today's two
 * callers, written down nowhere, and this file writes other plugins' settings —
 * including, if an id ever said so, Signet's own, which holds the ring code.
 */
function isPluginId(id: string): boolean {
	return /^[\w.-]+$/.test(id) && id !== '.' && id !== '..';
}

export class UnsafePluginIdError extends Error {
	constructor(id: string) {
		super(`Not a plugin id: ${id}`);
		this.name = 'UnsafePluginIdError';
	}
}

function dataPath(app: App, pluginId: string): string {
	if (!isPluginId(pluginId)) {
		throw new UnsafePluginIdError(pluginId);
	}
	return normalizePath(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
}

/** The plugin's stored settings, or undefined when there are none or they are unreadable. */
export async function readPluginData(app: App, pluginId: string): Promise<unknown> {
	const { adapter } = app.vault;

	let path: string;
	try {
		path = dataPath(app, pluginId);
	} catch {
		// Reading promises "undefined when there is nothing usable", and an id that
		// is not an id is exactly that. Writing is the side that refuses loudly.
		return undefined;
	}

	if (!(await adapter.exists(path))) {
		return undefined;
	}

	try {
		return JSON.parse(await adapter.read(path));
	} catch {
		// A plugin with a corrupt data.json is not our problem to report; treating
		// it as "nothing to share" keeps the snapshot usable.
		return undefined;
	}
}

export async function writePluginData(app: App, pluginId: string, data: unknown): Promise<void> {
	await app.vault.adapter.write(dataPath(app, pluginId), JSON.stringify(data, null, 2));
}
