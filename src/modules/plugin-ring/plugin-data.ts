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
function dataPath(app: App, pluginId: string): string {
	return normalizePath(`${app.vault.configDir}/plugins/${pluginId}/data.json`);
}

/** The plugin's stored settings, or undefined when there are none or they are unreadable. */
export async function readPluginData(app: App, pluginId: string): Promise<unknown> {
	const path = dataPath(app, pluginId);
	const { adapter } = app.vault;

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
