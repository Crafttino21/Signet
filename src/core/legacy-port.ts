import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { pathExists } from './vault-fs';

/**
 * Finishing the move out of the plugin that was called Toolbox.
 *
 * `rename.ts` carries the settings across before anything is loaded, and the ring
 * copies its file to the new name at startup. Neither of them clears anything
 * away afterwards, on purpose — a move that deletes as it goes has no second
 * chance if it turns out to have gone wrong — so the README has been telling
 * people to delete the leftovers themselves. That is a chore, it is easy to get
 * wrong, and every leftover is a live hazard while it is there: a `toolbox`
 * folder under `plugins/` is reported by Obsidian as an installed plugin, an old
 * roster folder keeps being read, a hotkey bound to `toolbox:` does nothing.
 *
 * So this runs once a start, and only when there is something to find. Two steps
 * per leftover, and the rule that holds the whole thing together is that they
 * cannot be reordered:
 *
 * - **carry** makes sure what the thing holds exists at the new place, and says
 *   so or says why not.
 * - **retire** moves the old thing out of the way, and is reached **only** when
 *   carry said yes in this same run.
 *
 * Nothing is deleted. Everything goes to a trash, which is what makes running
 * this without asking defensible: the worst case is a folder the user has to
 * fish back out, not a ring code they have to type in on four devices.
 *
 * Anything that cannot be carried is left exactly where it is and named in the
 * report with the reason. A leftover this run does not understand is a leftover
 * for the next run, or for a person.
 */

/** What kind of thing was found. Display text lives in the panel, not here. */
export type LeftoverKind =
	| 'pluginFolder'
	| 'panelLeaf'
	| 'hotkeys'
	| 'ringFile'
	| 'rosterFolder'
	| 'ringFilePath'
	| 'folder';

/**
 * Why something was left alone. Reason codes rather than sentences, so that the
 * decision and the wording stay apart — same rule as `plugin-ring/diff.ts`.
 */
export type LeftAloneReason =
	/** Nothing at the new place holds what this holds. */
	| 'notCarried'
	/** It belongs to a different ring than the one this device is in. */
	| 'differentRing'
	/** It cannot be read, so what it holds cannot be established. */
	| 'unreadable'
	/** Obsidian still has the old plugin switched on. */
	| 'stillRunning'
	/** The folder still has something in it that nothing here claimed. */
	| 'notEmpty'
	/**
	 * Nothing can carry this; the user has to do it.
	 *
	 * For a hotkey bound to the old plugin's commands. The file it lives in
	 * belongs to Obsidian, which holds it in memory and writes it back over
	 * anything written from outside, so this is named rather than fixed.
	 */
	| 'rebindByHand'
	/** Moving it to the trash did not work. */
	| 'failed';

/**
 * The answer that means "there is nothing of this kind here".
 *
 * Distinct from every reason above, and dropped from the report rather than
 * listed in it. The leftovers are built as a fixed list because most of them
 * cannot be looked for without doing the looking, and a vault whose only
 * leftover is a folder must not be told that its hotkeys were left alone for
 * want of something to carry.
 */
export const NOT_FOUND = 'notFound';

export interface Leftover {
	kind: LeftoverKind;
	/** Which one. A path or an id — data for the report, never a sentence. */
	at: string;
	/**
	 * Makes sure what this holds is at the new place.
	 *
	 * Returns undefined when it is, and a reason when it is not. Must not throw:
	 * a leftover that cannot answer is one to leave alone, not one to stop on.
	 */
	carry: () => Promise<LeftAloneReason | typeof NOT_FOUND | undefined>;
	/** Moves the old thing to a trash. Only ever called after carry said yes. */
	retire: () => Promise<void>;
}

export interface PortReport {
	tidied: { kind: LeftoverKind; at: string }[];
	leftAlone: { kind: LeftoverKind; at: string; reason: LeftAloneReason }[];
}

export function isEmptyReport(report: PortReport): boolean {
	return report.tidied.length === 0 && report.leftAlone.length === 0;
}

/**
 * Carries and retires each leftover, in the order given.
 *
 * Order is the caller's business and it matters: a folder is retired after the
 * things inside it, or it is not empty when its turn comes.
 *
 * One failure never stops the rest. These are independent pieces of furniture,
 * and a ring file that will not open is no reason to leave a dead plugin folder
 * lying under `plugins/`.
 */
export async function runPort(leftovers: readonly Leftover[]): Promise<PortReport> {
	const report: PortReport = { tidied: [], leftAlone: [] };

	for (const leftover of leftovers) {
		const { kind, at } = leftover;

		let reason: LeftAloneReason | typeof NOT_FOUND | undefined;
		try {
			reason = await leftover.carry();
		} catch {
			reason = 'unreadable';
		}

		if (reason === NOT_FOUND) {
			continue;
		}
		if (reason !== undefined) {
			report.leftAlone.push({ kind, at, reason });
			continue;
		}

		try {
			await leftover.retire();
			report.tidied.push({ kind, at });
		} catch {
			// Carried but not cleared away. Said rather than swallowed: the whole
			// point of the report is that the next run, or a person, can see what
			// is still there and why.
			report.leftAlone.push({ kind, at, reason: 'failed' });
		}
	}

	return report;
}

/**
 * Moves something out of the way, whatever kind of thing it is.
 *
 * Two paths, because the leftovers are of two kinds. A visible vault file or
 * folder goes through `FileManager`, which is the documented way and the one that
 * respects the user's own "deleted files" setting — and which the index has to
 * know about, or Obsidian goes on showing something that is not there.
 *
 * The config folder is hidden, and hidden paths are not in the index at all, so
 * those go through the adapter. `trashSystem` is what Obsidian's own delete does
 * where the platform has a system trash and returns false rather than throwing
 * where it does not — a phone, a flatpak — leaving the vault's own `.trash`.
 *
 * Never a hard delete, either way. That is what makes running this without
 * asking defensible.
 */
export async function trashPath(app: App, path: string): Promise<void> {
	const normalised = normalizePath(path);

	const known = app.vault.getFileByPath(normalised) ?? app.vault.getFolderByPath(normalised);
	if (known) {
		await app.fileManager.trashFile(known);
		return;
	}

	if (await app.vault.adapter.trashSystem(normalised)) {
		return;
	}
	await app.vault.adapter.trashLocal(normalised);
}

/** Whether a folder has nothing left in it. Missing counts as empty. */
export async function isFolderEmpty(app: App, folder: string): Promise<boolean> {
	const normalised = normalizePath(folder);
	if (!(await pathExists(app, normalised))) {
		return true;
	}

	try {
		const listed = await app.vault.adapter.list(normalised);
		return listed.files.length === 0 && listed.folders.length === 0;
	} catch {
		// Cannot tell, so treat it as occupied. Retiring a folder whose contents
		// are unknown is exactly what this file exists not to do.
		return false;
	}
}
