import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { LEGACY_ID } from './rename';
import { isFolderEmpty, NOT_FOUND, trashPath } from './legacy-port';
import type { Leftover } from './legacy-port';
import { LEGACY_PANEL_TYPE, SIGNET_PANEL_TYPE } from './panel-view';
import { pathExists } from './vault-fs';
import type { PluginApi } from './obsidian-internals';

/**
 * The leftovers that belong to the plugin itself rather than to any feature.
 *
 * Three things, plus the vault folder the ring will have emptied by the time its
 * turn comes. Everything a module owns — the ring file, the roster, a path
 * stored in its own settings — is contributed by that module through
 * `SignetModule.legacyLeftovers()`, so the ring's knowledge stays in the ring.
 */

/** Where the old plugin's folder is. It was never anywhere else. */
export function legacyPluginFolder(app: App): string {
	return normalizePath(`${app.vault.configDir}/plugins/${LEGACY_ID}`);
}

/** The vault folder the old name kept its things in. */
export const LEGACY_VAULT_FOLDER = 'Toolbox';

export interface CoreLeftoverOptions {
	app: App;
	/** Where this plugin actually is, which is not always named after its id. */
	pluginFolder: string;
	/** Obsidian's plugin manager, when this version exposes one. */
	plugins: PluginApi | undefined;
	/**
	 * Whether what the old folder stored is already here.
	 *
	 * Asked of the modules rather than answered here. Whether two `data.json`
	 * files describe the same ring is the ring's question, and core reading into
	 * another module's settings to guess at it is how the seam gets lost.
	 */
	settingsAreHere: (theirs: unknown) => boolean;
}

export function coreLeftovers(options: CoreLeftoverOptions): Leftover[] {
	return [
		pluginFolderLeftover(options),
		...panelLeafLeftovers(options.app),
		hotkeyLeftover(options.app),
		vaultFolderLeftover(options.app),
	];
}

/**
 * The old plugin's folder under `plugins/`.
 *
 * Worth clearing away rather than merely untidy. Obsidian reads every folder
 * under `plugins/` that has a manifest and reports it as an installed plugin, so
 * while this is there the ring sees `toolbox` in its own device's plugin list —
 * which is why `self.ts` exists at all, and why the host once published it and
 * sent every other device looking for it in a community list that has never
 * contained it.
 */
function pluginFolderLeftover(options: CoreLeftoverOptions): Leftover {
	const { app, plugins } = options;
	const there = legacyPluginFolder(app);

	return {
		kind: 'pluginFolder',
		at: there,
		carry: async () => {
			// An install updated in place keeps the old folder name while declaring
			// the new id. Then this *is* us, and there is nothing to move anywhere.
			if (normalizePath(options.pluginFolder) === there) {
				return NOT_FOUND;
			}
			if (!(await pathExists(app, there))) {
				return NOT_FOUND;
			}
			if (!(await pathExists(app, normalizePath(`${options.pluginFolder}/data.json`)))) {
				// Nothing was ever carried across, so there is nothing proving this
				// folder redundant. `rename.ts` does the carrying on a start where it
				// can; this run says so and leaves it where it is.
				return 'notCarried';
			}

			const theirs = await readJson(app, normalizePath(`${there}/data.json`));
			if (theirs === undefined) {
				return 'unreadable';
			}
			if (!options.settingsAreHere(theirs)) {
				// Set up fresh here, and only afterwards was the old folder noticed,
				// with a different ring in it. Writing over that would be worse than
				// leaving it, so it is named and left.
				return 'differentRing';
			}

			// Trashing the folder of a plugin Obsidian has loaded would leave it
			// running out of nothing. Switched off first, and if that cannot be done
			// then this is not the run to do it in.
			if (plugins?.isEnabled(LEGACY_ID) === true) {
				try {
					await plugins.disable(LEGACY_ID);
				} catch {
					return 'stillRunning';
				}
			}

			return undefined;
		},
		retire: () => trashPath(app, there),
	};
}

/**
 * Leaves still open under the name the panel had before the rename.
 *
 * A workspace remembers the view type of every leaf it had open, and
 * `panel-view.ts` registers the old name as a second name for the same view so
 * that such a leaf is not an empty pane. This is the other half of that: the leaf
 * is asked to become an ordinary Signet panel, so that the second name can
 * eventually stop being registered at all.
 */
function panelLeafLeftovers(app: App): Leftover[] {
	return app.workspace.getLeavesOfType(LEGACY_PANEL_TYPE).map((leaf) => ({
		kind: 'panelLeaf' as const,
		at: LEGACY_PANEL_TYPE,
		carry: async () => {
			await leaf.setViewState({ type: SIGNET_PANEL_TYPE, active: false });
			return leaf.view.getViewType() === SIGNET_PANEL_TYPE ? undefined : 'failed';
		},
		// Carrying it is retiring it: the leaf did not move, it changed its name.
		retire: () => Promise.resolve(),
	}));
}

/**
 * Hotkeys still bound to the old plugin's commands.
 *
 * Reported, not rebound. The command ids never changed — only the prefix — so
 * rewriting `.obsidian/hotkeys.json` looks like a two-line job, and for a moment
 * it was one.
 *
 * It does not work. Obsidian reads that file at startup and writes it back out of
 * memory the next time anybody changes a hotkey, so a rewrite from here survives
 * until the user opens the hotkeys pane and then silently undoes itself — with the
 * old `toolbox:` bindings back and the new ones gone. There is no public API for
 * it either: `obsidian.d.ts` has the `Hotkey` type and no manager, so doing this
 * properly would mean another bet on an internal, in a file that is not allowed to
 * make one, for a convenience worth much less than the bet.
 *
 * A migration that appears to have worked and has not is worse than none. So this
 * finds the bindings that are dead and says so, and the panel tells the user to
 * set them again — which is what the README asked for before, except that now
 * there is a list.
 */
function hotkeyLeftover(app: App): Leftover {
	const path = normalizePath(`${app.vault.configDir}/hotkeys.json`);

	return {
		kind: 'hotkeys',
		at: path,
		carry: async () => {
			const stored = await readJson(app, path);
			return staleHotkeys(stored, LEGACY_ID, 'signet').length > 0
				? 'rebindByHand'
				: NOT_FOUND;
		},
		// Never reached: nothing here is carried, so nothing here is retired.
		retire: () => Promise.resolve(),
	};
}

/**
 * The vault folder the old name used, once nothing is left inside it.
 *
 * Last, and only when empty. What was in it — the ring file, the roster — is the
 * ring's to carry, and this cannot know whether it managed to. An empty folder is
 * the proof.
 */
function vaultFolderLeftover(app: App): Leftover {
	return {
		kind: 'folder',
		at: LEGACY_VAULT_FOLDER,
		carry: async () => {
			if (!(await pathExists(app, LEGACY_VAULT_FOLDER))) {
				return NOT_FOUND;
			}
			// Still holding something. What that is belongs to whoever put it there
			// — the ring, or the user — and this is not the place to decide.
			return (await isFolderEmpty(app, LEGACY_VAULT_FOLDER)) ? undefined : 'notEmpty';
		},
		retire: () => trashPath(app, LEGACY_VAULT_FOLDER),
	};
}

/**
 * The old plugin's hotkey bindings that nothing answers to any more.
 *
 * Returns the command names, not the whole file: this used to build a rewritten
 * object and write it back, and it does not do that any more — see
 * {@link hotkeyLeftover}. Reporting needs the names and nothing else, and not
 * building an object is also how a key called `__proto__` stopped being able to
 * vanish on the way through. Pure, and exported for its own tests, because this
 * reads a file the user cannot easily rebuild.
 *
 * A binding that already exists under the new name is left out. The old one is
 * stale by definition, and telling somebody to set a hotkey they have already set
 * is telling them something untrue.
 */
export function staleHotkeys(stored: unknown, from: string, to: string): string[] {
	if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
		return [];
	}

	const source = stored as Record<string, unknown>;
	const prefix = `${from}:`;

	return Object.keys(source)
		.filter((key) => key.startsWith(prefix))
		.filter((key) => !(`${to}:${key.slice(prefix.length)}` in source));
}

/** Reads and parses a file under the config folder. Undefined for anything unusable. */
async function readJson(app: App, path: string): Promise<unknown> {
	try {
		if (!(await app.vault.adapter.exists(path))) {
			return undefined;
		}
		return JSON.parse(await app.vault.adapter.read(path)) as unknown;
	} catch {
		return undefined;
	}
}
