/**
 * Which plugin ids mean "this plugin", as opposed to one the ring carries.
 *
 * There is one rule the ring does not bend: Signet never appears in a diff or an
 * operation. Disabling the plugin running the apply loop would cut the loop off
 * mid-way, and its `data.json` holds the ring secret — the key to the ring, the
 * vault id, the token, the key the notes are encrypted with — so publishing it
 * would put all of that inside the snapshot.
 *
 * The rename gave that rule a second name to know about. Obsidian identifies a
 * plugin by the id in its manifest and reads every folder under `plugins/` that
 * has one, and the move out of the old folder deliberately copies rather than
 * moves — so on any device that has been through it, `toolbox` is sitting there
 * being reported as an ordinary installed plugin. Every guard that knew only
 * `signet` let it straight through: the host published it, settings and all, and
 * the other devices went looking for a plugin by that name in a community list
 * that has never contained it.
 *
 * So "ourselves" is two names, in one place, until no device runs the old build.
 */

/**
 * What this plugin's id used to be, before it stopped being a box of tools.
 *
 * Kept for as long as a device somewhere might still be running that build: its
 * snapshots name it, and its settings folder is where an updating device finds
 * everything it owns.
 */
export const LEGACY_PLUGIN_ID = 'toolbox';

/** Whether an id names this plugin under either of the names it has had. */
export function isOwnId(id: string, selfId: string): boolean {
	return id === selfId || id === LEGACY_PLUGIN_ID;
}

/** Both names, for the places that already work with a set of ids to skip. */
export function ownIds(selfId: string): string[] {
	return [selfId, LEGACY_PLUGIN_ID];
}
