import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Moving in from the folder this plugin used to live in.
 *
 * The project was called Toolbox until it grew a sync service of its own and
 * stopped being a box of tools. Obsidian identifies a plugin by the id in its
 * manifest, and everything a plugin stores lives in a folder named after it —
 * so a new id is, as far as Obsidian is concerned, a different plugin with an
 * empty folder.
 *
 * That would be worse than untidy here. `data.json` holds the ring code, and
 * the ring code is the key to everything: the vault id on the server, the
 * token, the key the notes are encrypted with. Losing it means typing it back
 * in on every device, and `vault-sync-state.json` beside it is what stops the
 * next sync treating every file as new.
 *
 * So both are copied across, once, the first time the renamed plugin starts
 * with nothing of its own. Copied rather than moved: if this turns out to have
 * gone wrong, the old folder is still there to look at.
 */

const LEGACY_ID = 'toolbox';

/** Files worth carrying over, and the only ones this plugin ever wrote. */
const CARRIED = ['data.json', 'vault-sync-state.json'];

export interface RenameReport {
	/** What was brought across. Empty when there was nothing to bring. */
	carried: string[];
	/** Where it came from, for the message that says so. */
	from: string;
}

/**
 * Copies what the old folder holds, if this one is empty and that one is not.
 *
 * Deliberately does nothing when this plugin already has settings of its own:
 * running twice must not overwrite a working install with a stale copy, and
 * "already has data" is the one reliable sign that the move has happened.
 */
export async function adoptLegacyFolder(
	app: App,
	pluginId: string
): Promise<RenameReport | undefined> {
	if (pluginId === LEGACY_ID) {
		return undefined;
	}

	const { adapter, configDir } = { adapter: app.vault.adapter, configDir: app.vault.configDir };
	const here = normalizePath(`${configDir}/plugins/${pluginId}`);
	const there = normalizePath(`${configDir}/plugins/${LEGACY_ID}`);

	try {
		if (await adapter.exists(normalizePath(`${here}/data.json`))) {
			return undefined;
		}
		if (!(await adapter.exists(normalizePath(`${there}/data.json`)))) {
			return undefined;
		}

		const carried: string[] = [];
		for (const name of CARRIED) {
			const source = normalizePath(`${there}/${name}`);
			if (!(await adapter.exists(source))) {
				continue;
			}
			await adapter.write(normalizePath(`${here}/${name}`), await adapter.read(source));
			carried.push(name);
		}

		return carried.length > 0 ? { carried, from: there } : undefined;
	} catch (error) {
		// A failed move must not stop the plugin loading. Starting empty is
		// recoverable — the ring code can be typed in again — and a plugin that
		// refuses to start is not.
		console.error('Signet: could not read the previous plugin folder.', error);
		return undefined;
	}
}
