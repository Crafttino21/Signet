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
 *
 * The old plugin is switched off in the same breath, because leaving it running
 * is worse than leaving it lying there. Two copies in one vault write two
 * heartbeats under two device ids, both answer a publish, and both sync the same
 * notes to the same server — a vault arguing with itself. Switched off rather
 * than deleted: the files stay for anyone who wants to check what was carried.
 *
 * Which folder this plugin is in has to be asked rather than assumed. The id
 * and the folder name match by convention and stopped matching here: an install
 * updated in place keeps the folder it had while the new manifest declares the
 * new id. Reading `manifest.dir` means such an install is correctly recognised
 * as needing nothing, instead of having a copy of its own settings written into
 * a folder Obsidian is not loading from — which the next real move would then
 * adopt as though it were current.
 */

const LEGACY_ID = 'toolbox';

/** Files worth carrying over, and the only ones this plugin ever wrote. */
const CARRIED = ['data.json', 'vault-sync-state.json'];

export interface RenameReport {
	/** What was brought across. Empty when there was nothing to bring. */
	carried: string[];
	/** Where it came from, for the message that says so. */
	from: string;
	/** Whether the old plugin was running and has now been switched off. */
	switchedOff: boolean;
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
	pluginFolder: string,
	/**
	 * Switches the old plugin off, if this Obsidian lets us. Passed in rather
	 * than reached for: `app.plugins` is undocumented and belongs to
	 * `core/obsidian-internals.ts` alone.
	 */
	legacy?: { isEnabled: (id: string) => boolean; disable: (id: string) => Promise<void> }
): Promise<RenameReport | undefined> {
	const adapter = app.vault.adapter;
	const here = normalizePath(pluginFolder);
	const there = normalizePath(`${app.vault.configDir}/plugins/${LEGACY_ID}`);

	// Already running out of the old folder, which is what an in-place update
	// looks like. There is nothing to move and nowhere to move it.
	if (here === there) {
		return undefined;
	}

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

		if (carried.length === 0) {
			return undefined;
		}

		// Only if it is actually running. Asking Obsidian to disable a plugin that
		// is already off writes the config file for nothing.
		let switchedOff = false;
		if (legacy?.isEnabled(LEGACY_ID) === true) {
			try {
				await legacy.disable(LEGACY_ID);
				switchedOff = true;
			} catch (error) {
				// Not fatal: the settings are already across, and a vault with two
				// copies running is a mess the user can undo by hand.
				console.error('Signet: could not switch the previous plugin off.', error);
			}
		}

		return { carried, from: there, switchedOff };
	} catch (error) {
		// A failed move must not stop the plugin loading. Starting empty is
		// recoverable — the ring code can be typed in again — and a plugin that
		// refuses to start is not.
		console.error('Signet: could not read the previous plugin folder.', error);
		return undefined;
	}
}
