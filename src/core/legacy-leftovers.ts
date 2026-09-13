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
 * Obsidian keys them `<plugin id>:<command>` in a file outside any plugin's
 * folder, which is why the README has had to say these do not migrate. They can:
 * the command ids never changed, only the prefix.
 *
 * A binding that already exists under the new name is left exactly as it is. The
 * old one is stale by definition — nothing has answered to `toolbox:` since the
 * rename — and quietly replacing a key somebody has chosen since then would be
 * taking something away rather than carrying something over.
 */
function hotkeyLeftover(app: App): Leftover {
	const path = normalizePath(`${app.vault.configDir}/hotkeys.json`);

	return {
		kind: 'hotkeys',
		at: path,
		carry: async () => {
			const stored = await readJson(app, path);
			if (stored === undefined) {
				return NOT_FOUND;
			}

			const moved = rewritePrefixes(stored, LEGACY_ID, 'signet');
			if (moved === undefined) {
				return NOT_FOUND;
			}

			// Written as a whole object through `JSON.stringify`, never patched as
			// text: this file belongs to Obsidian, and half-rewriting it would cost
			// somebody every hotkey they have.
			await app.vault.adapter.write(path, JSON.stringify(moved, null, 2));

			const readBack = await readJson(app, path);
			return readBack !== undefined && !hasPrefix(readBack, LEGACY_ID) ? undefined : 'failed';
		},
		// The write above already removed the old keys. There is no old file left
		// to move anywhere.
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
 * Rewrites every `<from>:` key to `<to>:`, or nothing when there is nothing to do.
 *
 * Pure, and exported for its own tests: this rewrites a file the user cannot
 * easily rebuild, so the rule about what it leaves alone is worth being able to
 * check without a vault.
 */
export function rewritePrefixes(
	stored: unknown,
	from: string,
	to: string
): Record<string, unknown> | undefined {
	if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
		return undefined;
	}

	const source = stored as Record<string, unknown>;
	const result: Record<string, unknown> = {};
	let moved = 0;

	for (const [key, value] of Object.entries(source)) {
		if (!key.startsWith(`${from}:`)) {
			result[key] = value;
			continue;
		}

		moved += 1;
		const renamed = `${to}:${key.slice(from.length + 1)}`;
		// Already bound under the new name. The old key is dropped rather than
		// carried: it is the stale one, and the new one is what somebody chose.
		if (!(renamed in source)) {
			result[renamed] = value;
		}
	}

	return moved === 0 ? undefined : result;
}

function hasPrefix(stored: unknown, prefix: string): boolean {
	if (typeof stored !== 'object' || stored === null) {
		return false;
	}
	return Object.keys(stored).some((key) => key.startsWith(`${prefix}:`));
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
