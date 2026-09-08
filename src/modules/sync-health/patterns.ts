/**
 * Recognising the two very different shapes a sync conflict takes.
 *
 * **Separate copies.** A sync client that cannot merge renames the local version
 * and puts the remote one in its place. Nextcloud's desktop client documents its
 * form exactly: `mydata (conflicted copy 2018-04-10 093612).txt`.
 *
 * **Markers inside the note.** Some tools instead write the two versions into the
 * file with `<<<<<<<` / `=======` / `>>>>>>>` around them. The `nextcloud-sync`
 * plugin does this — its author states it never creates a separate copy file. This
 * is the nastier kind: the file count does not change and the note looks perfectly
 * normal in the file tree until you open it.
 *
 * Both detectors are deliberately conservative. A false positive here points the
 * user at a file that is fine, and eroding trust in the warning is worse than
 * missing an exotic naming scheme.
 */

export type ConflictSource = 'nextcloud-client' | 'copy-suffix' | 'syncthing';

export interface ConflictName {
	source: ConflictSource;
	/** The file this copy was made from. */
	originalPath: string;
	/** Timestamp or discriminator carried in the name, for display. */
	detail: string;
}

interface NamePattern {
	source: ConflictSource;
	/** Capture groups: 1 = stem, 2 = detail, 3 = extension (optional). */
	regex: RegExp;
}

const NAME_PATTERNS: readonly NamePattern[] = [
	// Nextcloud desktop client, exactly as its documentation spells it out.
	{
		source: 'nextcloud-client',
		regex: /^(.*) \(conflicted copy (\d{4}-\d{2}-\d{2} \d{6})\)(\.[^.]*)?$/,
	},
	// Dropbox and others use the same words with a different tail, sometimes with
	// a user name in front. Requiring the literal "conflicted copy" keeps this from
	// matching ordinary parentheses in a filename.
	{
		source: 'copy-suffix',
		regex: /^(.*) \((?:[^()]*? )?conflicted copy ([^()]*)\)(\.[^.]*)?$/,
	},
	// Syncthing: note.sync-conflict-20260908-120000-ABCD123.md
	{
		source: 'syncthing',
		regex: /^(.*)\.sync-conflict-([\w-]+?)(\.[^.]*)?$/,
	},
];

/**
 * Reads a vault path and, if it looks like a conflicting copy, works out which
 * file it was copied from. Returns undefined for ordinary files.
 */
export function matchConflictName(path: string): ConflictName | undefined {
	const slash = path.lastIndexOf('/');
	const folder = slash < 0 ? '' : path.slice(0, slash + 1);
	const name = path.slice(slash + 1);

	for (const pattern of NAME_PATTERNS) {
		const match = pattern.regex.exec(name);
		const stem = match?.[1];
		if (!match || !stem) {
			// An empty stem would mean the whole name is just the suffix, which is
			// not a copy of anything.
			continue;
		}

		return {
			source: pattern.source,
			originalPath: `${folder}${stem}${match[3] ?? ''}`,
			detail: match[2] ?? '',
		};
	}

	return undefined;
}

export interface MarkerHit {
	/** 1-based line of the opening `<<<<<<<`. */
	line: number;
	/** 1-based line of the closing `>>>>>>>`. */
	endLine: number;
}

const OPEN = /^<{7}(\s|$)/;
const SEPARATOR = /^={7}(\s|$)/;
const CLOSE = /^>{7}(\s|$)/;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * Finds conflict marker blocks in a note's text.
 *
 * Only complete `<<<<<<< … ======= … >>>>>>>` runs count, and anything inside a
 * fenced code block is ignored — a note explaining git conflicts would otherwise
 * report itself as conflicted forever.
 */
export function findConflictMarkers(content: string): MarkerHit[] {
	const lines = content.split(/\r?\n/);
	const hits: MarkerHit[] = [];

	let inFence = false;
	let openLine: number | undefined;
	let sawSeparator = false;

	for (const [index, line] of lines.entries()) {
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			continue;
		}

		if (OPEN.test(line)) {
			// A second opener before a close means the first was never a real
			// conflict block; start over from here.
			openLine = index + 1;
			sawSeparator = false;
		} else if (openLine !== undefined && SEPARATOR.test(line)) {
			sawSeparator = true;
		} else if (openLine !== undefined && sawSeparator && CLOSE.test(line)) {
			hits.push({ line: openLine, endLine: index + 1 });
			openLine = undefined;
			sawSeparator = false;
		}
	}

	return hits;
}
