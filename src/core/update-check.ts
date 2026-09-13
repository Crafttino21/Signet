import { apiVersion, requestUrl } from 'obsidian';
import { compareVersions, isNewer } from './release';
import type { CheckRecord } from './device-state';

/**
 * Finding out that there is a newer Signet than this one.
 *
 * Two sources, because neither alone is enough.
 *
 * The ring already knows. Every device writes its version into its heartbeat, so
 * a vault whose phone has been updated can say so without asking anybody
 * anything — no network call of ours, no third party, and it works on a vault
 * that never touches the internet beyond its own server. What it cannot do is
 * tell the first device: until one of them has been updated by hand, every
 * heartbeat says the same number.
 *
 * So there is also the repository, which is the only place that knows about a
 * release nobody has installed yet. That one is a request to a host the user did
 * not choose, which this plugin otherwise never makes for its own sake, so it is
 * a setting — on by default, because being quietly out of date on a plugin that
 * moves people's notes around is worse than a daily HEAD of a small JSON file,
 * and off in one click for anyone who disagrees.
 *
 * Neither source ever installs anything. What they produce is a line in the panel
 * and a link; updating stays Obsidian's job and the user's decision.
 */

/** The one place the repository is named. */
export const SIGNET_REPO = 'Crafttino21/Signet';

/**
 * `manifest.json` on the default branch, not the releases API.
 *
 * It is the file the community registry and BRAT read, it is a few hundred bytes,
 * it needs no token and it is not rate-limited the way `api.github.com` is. Same
 * host and same shape as the community plugin list the ring already reads.
 */
const MANIFEST_URL = `https://raw.githubusercontent.com/${SIGNET_REPO}/main/manifest.json`;

/** Where to send somebody who wants the new one. */
export const RELEASES_URL = `https://github.com/${SIGNET_REPO}/releases`;

/** At most one request a day. A plugin release is not news that travels by the hour. */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

export type UpdateSource = 'ring' | 'github';

export interface UpdateFound {
	version: string;
	from: UpdateSource;
}

/**
 * What is known about a newer version, and who wants to be told.
 *
 * Shared mutable state on the plugin for the same reason as the live-editing
 * registry and the ring link: the panel and the settings tab both draw from it,
 * the ring writes to it whenever it reads a roster, and a copy that lags is a
 * copy that goes on offering an update somebody already installed.
 */
export class UpdateWatch {
	private found: UpdateFound | undefined;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly installed: string) {}

	/**
	 * A version seen on another device in the ring.
	 *
	 * Called with every device's version rather than the highest, so the caller
	 * does not have to know what counts as newer.
	 */
	sawInRing(version: string | undefined): void {
		if (version === undefined || !isNewer(version, this.installed)) {
			return;
		}
		this.offer({ version, from: 'ring' });
	}

	/** What the repository said. */
	sawRelease(version: string): void {
		if (!isNewer(version, this.installed)) {
			return;
		}
		this.offer({ version, from: 'github' });
	}

	/**
	 * The newest version found, if it is newer than this one.
	 *
	 * Re-checked against the installed version on the way out as well as on the
	 * way in: nothing clears this when the plugin is updated, and the natural
	 * moment to find out is the moment somebody looks.
	 */
	latest(): UpdateFound | undefined {
		if (this.found && !isNewer(this.found.version, this.installed)) {
			this.found = undefined;
		}
		return this.found;
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private offer(update: UpdateFound): void {
		// A version already known about is not news, whichever source repeats it.
		if (this.found && compareVersions(update.version, this.found.version) <= 0) {
			return;
		}
		this.found = update;
		for (const listener of this.listeners) {
			listener();
		}
	}
}

/** Whether enough time has passed to ask again. */
export function isCheckDue(record: CheckRecord | undefined, now: number): boolean {
	// A record from the future — a clock that was wrong and has been corrected —
	// would otherwise hold the check off for a day from whenever that was.
	return record === undefined || record.at > now || now - record.at >= CHECK_EVERY_MS;
}

/**
 * Whether this Obsidian could actually run that version.
 *
 * Offering an update the app will refuse to load is worse than saying nothing:
 * the user goes and installs it, Obsidian disables it, and their notes stop
 * syncing. An unreadable `apiVersion` means no opinion, and no opinion allows it.
 */
export function isRunnableHere(minAppVersion: unknown, appVersion: string): boolean {
	if (typeof minAppVersion !== 'string' || minAppVersion === '') {
		return true;
	}
	return compareVersions(appVersion, minAppVersion) >= 0;
}

/**
 * Asks the repository what the newest version is.
 *
 * Never throws and never reports a failure anywhere: not being able to reach
 * GitHub is not a thing that went wrong with this vault, and a notice about it
 * would be a notice on every start of a laptop that is often offline. It returns
 * nothing and the next check happens tomorrow.
 */
export async function fetchLatestVersion(
	appVersion: string = apiVersion
): Promise<string | undefined> {
	try {
		const response = await requestUrl({ url: MANIFEST_URL, throw: false });
		if (response.status !== 200) {
			return undefined;
		}

		const manifest: unknown = response.json;
		if (typeof manifest !== 'object' || manifest === null) {
			return undefined;
		}

		const { version, minAppVersion } = manifest as Record<string, unknown>;
		if (typeof version !== 'string' || version === '') {
			return undefined;
		}
		return isRunnableHere(minAppVersion, appVersion) ? version : undefined;
	} catch {
		return undefined;
	}
}
