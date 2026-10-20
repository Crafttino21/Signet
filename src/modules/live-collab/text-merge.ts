/**
 * Putting a note's local changes into a room that moved on without them.
 *
 * A device that was cut off keeps writing — offline, with the server slow to
 * answer, or with live editing not running at all — and its file then holds work
 * the room has never seen. The room is not wrong either: the others kept typing.
 * Picking one of the two is how a member's afternoon used to disappear the moment
 * their connection came back.
 *
 * So this is a three-way merge, the same reasoning `reconcile.ts` applies to whole
 * files, at the level of characters. With the text this device last shared with
 * the room as the base, what changed here and what changed there can be told
 * apart. Changes in different places both apply. The same change made on both
 * sides — which is what happens when the file sync has already carried the room's
 * text to this device — applies once. Only changes to the same stretch that
 * disagree are a conflict, and a conflict is never decided by discarding a side:
 * the caller keeps the room's text in the note and this device's beside it.
 *
 * Nothing here knows about Yjs or files. It turns three strings into a list of
 * replacements, which is what makes every awkward case something a test can pin
 * down.
 */

/** Replace `from`..`to` of the source text with `insert`. */
export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

export interface MergeResult {
	/** The merged text. */
	text: string;
	/**
	 * What turns the room's text into {@link text}, in the room's coordinates and
	 * in ascending order. Applied back to front, each leaves the next one's offsets
	 * alone.
	 */
	changes: TextChange[];
	/**
	 * Some stretch was changed differently on both sides. The room's version of it
	 * is in {@link text}; this device's version exists only in the caller's copy.
	 */
	conflicted: boolean;
}

/**
 * How far the diff searches before calling a stretch replaced wholesale.
 *
 * Myers' algorithm costs the square of the number of differences in memory. Two
 * versions of one note differ in a handful of places; two unrelated texts differ
 * everywhere, and for those "everything changed" is both the honest answer and
 * the affordable one.
 */
const MAX_LINE_EDITS = 2_000;
const MAX_CHAR_EDITS = 1_000;

/** One run of tokens that differs: `a[aFrom..aTo)` became `b[bFrom..bTo)`. */
interface Hunk {
	aFrom: number;
	aTo: number;
	bFrom: number;
	bTo: number;
}

/**
 * The shortest edit script between two token lists, or undefined past `maxEdits`.
 *
 * Myers' O(ND) algorithm, keeping each round's frontier so the path can be walked
 * back. Each round only reads the round before it, so a round stores just the
 * diagonals it can reach.
 */
function myers(a: readonly string[], b: readonly string[], maxEdits: number): Hunk[] | undefined {
	const n = a.length;
	const m = b.length;
	const trace: Int32Array[] = [];

	// Frontier of round `d`, for diagonal `k` in [-d, d], lives at `k + d`.
	let done = -1;
	for (let d = 0; d <= Math.min(maxEdits, n + m) && done < 0; d += 1) {
		const previous = trace[d - 1];
		const frontier = new Int32Array(2 * d + 1);

		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (!previous) {
				x = 0;
			} else if (
				k === -d ||
				(k !== d && (previous[k - 1 + d - 1] ?? 0) < (previous[k + 1 + d - 1] ?? 0))
			) {
				x = previous[k + 1 + d - 1] ?? 0;
			} else {
				x = (previous[k - 1 + d - 1] ?? 0) + 1;
			}
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x += 1;
				y += 1;
			}
			frontier[k + d] = x;
			if (x >= n && y >= m) {
				done = d;
				break;
			}
		}
		trace.push(frontier);
	}

	if (done < 0) {
		return undefined;
	}

	// Walked back from the end, one edit per round, then put in reading order.
	const edits: Hunk[] = [];
	let x = n;
	let y = m;
	for (let d = done; d > 0; d -= 1) {
		const previous = trace[d - 1];
		if (!previous) {
			break;
		}
		const k = x - y;
		const down =
			k === -d ||
			(k !== d && (previous[k - 1 + d - 1] ?? 0) < (previous[k + 1 + d - 1] ?? 0));
		const fromK = down ? k + 1 : k - 1;
		const fromX = previous[fromK + d - 1] ?? 0;
		const fromY = fromX - fromK;

		edits.push(
			down
				? { aFrom: fromX, aTo: fromX, bFrom: fromY, bTo: fromY + 1 }
				: { aFrom: fromX, aTo: fromX + 1, bFrom: fromY, bTo: fromY }
		);
		x = fromX;
		y = fromY;
	}
	edits.reverse();

	// Neighbouring single-token edits become one hunk.
	const hunks: Hunk[] = [];
	for (const edit of edits) {
		const last = hunks[hunks.length - 1];
		if (last && last.aTo === edit.aFrom && last.bTo === edit.bFrom) {
			last.aTo = edit.aTo;
			last.bTo = edit.bTo;
		} else {
			hunks.push({ ...edit });
		}
	}
	return hunks;
}

/** Lines with their line breaks, so joining them gives the text back. */
function lines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function offsets(tokens: readonly string[]): number[] {
	const result = [0];
	for (const token of tokens) {
		result.push((result[result.length - 1] ?? 0) + token.length);
	}
	return result;
}

/**
 * The changes that turn `from` into `to`, character by character.
 *
 * Lines first and characters within the lines that changed. A character diff of
 * a whole note is quadratic in the worst case; the lines narrow it down to the
 * paragraphs that actually differ, and inside those it finds the words. That
 * granularity is the point — two people editing the same line in different
 * places must merge, not conflict.
 */
export function diffText(from: string, to: string): TextChange[] {
	if (from === to) {
		return [];
	}

	const a = lines(from);
	const b = lines(to);
	const aAt = offsets(a);
	const bAt = offsets(b);
	const hunks = myers(a, b, MAX_LINE_EDITS) ?? [
		{ aFrom: 0, aTo: a.length, bFrom: 0, bTo: b.length },
	];

	const changes: TextChange[] = [];
	for (const hunk of hunks) {
		const start = aAt[hunk.aFrom] ?? 0;
		const before = from.slice(start, aAt[hunk.aTo] ?? from.length);
		const after = to.slice(bAt[hunk.bFrom] ?? 0, bAt[hunk.bTo] ?? to.length);

		const inner = myers([...before], [...after], MAX_CHAR_EDITS);
		if (!inner) {
			changes.push({ from: start, to: start + before.length, insert: after });
			continue;
		}
		// Spread into code points above, so a surrogate pair is never split; the
		// offsets have to be counted back in UTF-16 units, which is what both the
		// strings and the editor use.
		const beforePoints = [...before];
		const afterPoints = [...after];
		const beforeAt = offsets(beforePoints);
		const afterAt = offsets(afterPoints);
		for (const edit of inner) {
			changes.push({
				from: start + (beforeAt[edit.aFrom] ?? 0),
				to: start + (beforeAt[edit.aTo] ?? 0),
				insert: after.slice(afterAt[edit.bFrom] ?? 0, afterAt[edit.bTo] ?? 0),
			});
		}
	}
	return changes;
}

/** Applies changes in ascending order to a stretch of text starting at `offset`. */
function applyWithin(text: string, offset: number, changes: readonly TextChange[]): string {
	let result = '';
	let at = 0;
	for (const change of changes) {
		result += text.slice(at, change.from - offset) + change.insert;
		at = change.to - offset;
	}
	return result + text.slice(at);
}

/**
 * Whether two changes to the base touch the same characters.
 *
 * Changes that merely meet — one ending where the other begins, or an insertion
 * at the edge of a replacement — are not: their order is unambiguous. Two
 * insertions at the same point are, because nothing says whose comes first.
 */
function collide(a: TextChange, b: TextChange): boolean {
	if (a.from < b.to && b.from < a.to) {
		return true;
	}
	const aInserts = a.from === a.to;
	const bInserts = b.from === b.to;
	if (aInserts && bInserts) {
		return a.from === b.from;
	}
	// An insertion strictly inside the other's range.
	if (aInserts) {
		return b.from < a.from && a.from < b.to;
	}
	if (bInserts) {
		return a.from < b.from && b.from < a.to;
	}
	return false;
}

interface Region {
	from: number;
	to: number;
	ours: TextChange[];
	theirs: TextChange[];
}

/** Groups both sides' changes into stretches that have to be decided together. */
function regions(ours: readonly TextChange[], theirs: readonly TextChange[]): Region[] {
	const all = [
		...ours.map((change) => ({ change, side: 'ours' as const })),
		...theirs.map((change) => ({ change, side: 'theirs' as const })),
	].sort((x, y) => x.change.from - y.change.from || x.change.to - y.change.to);

	const result: Region[] = [];
	for (const { change, side } of all) {
		const last = result[result.length - 1];
		const joins =
			last !== undefined &&
			[...last.ours, ...last.theirs].some((member) => collide(member, change));
		if (last && joins) {
			last.from = Math.min(last.from, change.from);
			last.to = Math.max(last.to, change.to);
			last[side].push(change);
		} else {
			result.push({
				from: change.from,
				to: change.to,
				ours: side === 'ours' ? [change] : [],
				theirs: side === 'theirs' ? [change] : [],
			});
		}
	}
	return result;
}

/**
 * What a stretch changed on both sides becomes, or undefined when it cannot be
 * decided without a person.
 *
 * The same text on both sides is one change made twice — the file sync carried
 * the room's own edit here before this device rejoined it. One insertion that
 * continues the other is the same thing caught at two moments: somebody kept
 * typing after the copy this device has was written. Anything else disagrees.
 */
function settle(oursText: string, theirsText: string, inserted: boolean): string | undefined {
	if (oursText === theirsText) {
		return theirsText;
	}
	if (inserted && theirsText.startsWith(oursText)) {
		return theirsText;
	}
	if (inserted && oursText.startsWith(theirsText)) {
		return oursText;
	}
	return undefined;
}

/**
 * Merges this device's changes since `base` into the room's current text.
 *
 * `ours` is the note as it stands on this device, `theirs` the room. The result
 * says how to change the room — nothing about this device's text is needed after
 * this, because the editor follows the room once it is bound.
 */
export function mergeText(base: string, ours: string, theirs: string): MergeResult {
	if (ours === base || ours === theirs) {
		return { text: theirs, changes: [], conflicted: false };
	}
	if (theirs === base) {
		return { text: ours, changes: diffText(theirs, ours), conflicted: false };
	}

	const changes: TextChange[] = [];
	let conflicted = false;
	let shift = 0;
	let text = '';
	let at = 0;

	for (const region of regions(diffText(base, ours), diffText(base, theirs))) {
		const original = base.slice(region.from, region.to);
		const theirsText = applyWithin(original, region.from, region.theirs);
		const oursText = applyWithin(original, region.from, region.ours);
		const inRoom = region.from + shift;

		let result = theirsText;
		if (region.theirs.length === 0) {
			result = oursText;
		} else if (region.ours.length > 0) {
			const settled = settle(oursText, theirsText, region.from === region.to);
			if (settled === undefined) {
				conflicted = true;
			} else {
				result = settled;
			}
		}

		if (result !== theirsText) {
			for (const change of diffText(theirsText, result)) {
				changes.push({
					from: inRoom + change.from,
					to: inRoom + change.to,
					insert: change.insert,
				});
			}
		}

		text += base.slice(at, region.from) + result;
		at = region.to;
		shift += theirsText.length - original.length;
	}

	return { text: text + base.slice(at), changes, conflicted };
}
