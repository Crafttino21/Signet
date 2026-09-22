import type { TranslationKey } from '../i18n';

/**
 * What changed, and when this build last told anybody.
 *
 * The notes ship with the plugin rather than being fetched. A changelog is not
 * worth a network call, and one that is fetched is one that is blank exactly when
 * the network is the thing that broke. It is also the only form that can be
 * translated: the entries are i18n keys, so `de.ts` fails to compile until each
 * one has German, which is the same rule every other string here follows.
 *
 * `versions.json` is not this list. It says which Obsidian a version needs, it is
 * read by the community registry, and it has an entry for every build including
 * the ones that changed nothing anybody would notice. This is the short version,
 * for a person, and a release with nothing worth saying belongs nowhere in it.
 */

export interface ReleaseNote {
	/** Must match a released `manifest.json` version exactly. */
	version: string;
	/** One line each, most important first. */
	entries: TranslationKey[];
}

/** Newest first. */
export const CHANGELOG: readonly ReleaseNote[] = [
	{
		version: '0.5.3',
		entries: ['changelog.0-5-3.removedAcrossRings', 'changelog.0-5-3.oldDevices'],
	},
	{
		version: '0.5.2',
		entries: [
			'changelog.0-5-2.newRing',
			'changelog.0-5-2.serverBehind',
			'changelog.0-5-2.portAdvice',
		],
	},
	{
		version: '0.5.1',
		entries: [
			'changelog.0-5-1.proxyPort',
			'changelog.0-5-1.statusPage',
			'changelog.0-5-1.quiet',
			'changelog.0-5-1.blankError',
		],
	},
	{
		version: '0.5.0',
		entries: [
			'changelog.0-5-0.excluded',
			'changelog.0-5-0.deletions',
			'changelog.0-5-0.overwrites',
			'changelog.0-5-0.collabEmpty',
			'changelog.0-5-0.collabStart',
			'changelog.0-5-0.quieter',
			'changelog.0-5-0.server',
		],
	},
	{
		version: '0.4.0',
		entries: [
			'changelog.0-4-0.smoothOpen',
			'changelog.0-4-0.updates',
			'changelog.0-4-0.port',
			'changelog.0-4-0.integrity',
			'changelog.0-4-0.paths',
			'changelog.0-4-0.server',
		],
	},
];

/**
 * Orders two version strings.
 *
 * Numeric part by numeric part, so `0.10.0` is newer than `0.9.0` — which string
 * comparison gets backwards, and which this project will reach. A part that is
 * not a number counts as zero rather than making the whole comparison unusable:
 * the answer this feeds is "is there something newer", and the safe failure is
 * "apparently not".
 */
export function compareVersions(a: string, b: string): number {
	const left = parts(a);
	const right = parts(b);

	for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) {
			return difference < 0 ? -1 : 1;
		}
	}
	return 0;
}

function parts(version: string): number[] {
	return version
		.trim()
		.split('.')
		.map((part) => {
			const number = Number.parseInt(part, 10);
			return Number.isFinite(number) ? number : 0;
		});
}

/** Whether `candidate` is a version worth telling somebody on `installed` about. */
export function isNewer(candidate: string, installed: string): boolean {
	return compareVersions(candidate, installed) > 0;
}

/**
 * The notes for one particular version, if it has any.
 *
 * Separate from {@link notesSince} because it answers the other question. That
 * one is "what is new", and is exclusive of what has already been seen; this is
 * "what does this version say", which stays true however many times it is asked.
 */
export function notesFor(version: string): ReleaseNote[] {
	return CHANGELOG.filter((note) => compareVersions(note.version, version) === 0);
}

/**
 * The notes to show on this start, newest first.
 *
 * Everything released after the version last seen here, up to and including the
 * one now running. Skipping several versions at once shows all of them, because
 * somebody who updates twice a year still wants to know what happened in between.
 *
 * A first run — nothing seen before — shows nothing. There is no "what's new" for
 * somebody who has never had the old one, and opening a changelog at somebody the
 * moment they install a plugin is answering a question they have not asked.
 *
 * Going backwards shows nothing either. Installing an older build on purpose is
 * not an update, and reading the notes for versions you have just left behind
 * would be actively misleading.
 */
export function notesSince(installed: string, lastSeen: string | null): ReleaseNote[] {
	if (lastSeen === null || !isNewer(installed, lastSeen)) {
		return [];
	}

	return CHANGELOG.filter(
		(note) => isNewer(note.version, lastSeen) && compareVersions(note.version, installed) <= 0
	).sort((a, b) => compareVersions(b.version, a.version));
}
