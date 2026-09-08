import { getAllTags } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { findConflictMarkers, matchConflictName } from './patterns';
import type { ConflictSource, MarkerHit } from './patterns';

/** A conflicting copy sitting next to the file it was made from. */
export interface CopyConflict {
	kind: 'copy';
	file: TFile;
	source: ConflictSource;
	detail: string;
	originalPath: string;
	/** Null when the original is gone — worth showing, it means only the copy is left. */
	original: TFile | null;
}

/** A note with both versions written into it. */
export interface MarkerConflict {
	kind: 'markers';
	file: TFile;
	markers: MarkerHit[];
}

export type Conflict = CopyConflict | MarkerConflict;

/** The tag `nextcloud-sync` puts on notes it could not merge. */
const CONFLICT_TAG = '#conflict';

function isExcluded(path: string, excluded: readonly string[]): boolean {
	return excluded.some((folder) => folder !== '' && path.startsWith(`${folder}/`));
}

/**
 * Finds conflicting copies by name. Cheap — it only looks at paths.
 */
export function findCopyConflicts(app: App, excluded: readonly string[]): CopyConflict[] {
	const conflicts: CopyConflict[] = [];

	for (const file of app.vault.getFiles()) {
		if (isExcluded(file.path, excluded)) {
			continue;
		}

		const match = matchConflictName(file.path);
		if (!match) {
			continue;
		}

		const original = app.vault.getFileByPath(match.originalPath);
		conflicts.push({
			kind: 'copy',
			file,
			source: match.source,
			detail: match.detail,
			originalPath: match.originalPath,
			original,
		});
	}

	return conflicts;
}

/**
 * Finds notes carrying conflict markers.
 *
 * Two passes, because reading every note on every start would be wasteful in a
 * large vault. The quick pass only consults the metadata cache for the `#conflict`
 * tag, which costs no disk access; the deep pass actually reads the notes and is
 * only run when the user asks for it, since a tool that does not set the tag would
 * otherwise go unnoticed.
 */
export async function findMarkerConflicts(
	app: App,
	excluded: readonly string[],
	options: { deep: boolean }
): Promise<MarkerConflict[]> {
	const conflicts: MarkerConflict[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		if (isExcluded(file.path, excluded)) {
			continue;
		}

		if (!options.deep) {
			const cache = app.metadataCache.getFileCache(file);
			const tags = cache ? (getAllTags(cache) ?? []) : [];
			if (!tags.includes(CONFLICT_TAG)) {
				continue;
			}
		}

		// cachedRead is the right call for reading a file we are not about to
		// modify — it serves from Obsidian's own cache where possible.
		const markers = findConflictMarkers(await app.vault.cachedRead(file));
		if (markers.length > 0) {
			conflicts.push({ kind: 'markers', file, markers });
		}
	}

	return conflicts;
}

export async function scanConflicts(
	app: App,
	excluded: readonly string[],
	options: { deep: boolean }
): Promise<Conflict[]> {
	return [
		...findCopyConflicts(app, excluded),
		...(await findMarkerConflicts(app, excluded, options)),
	];
}
