import { requestUrl } from 'obsidian';

/**
 * Obsidian's curated list of community plugins.
 *
 * This is the security boundary of the whole install feature. A ring snapshot
 * names plugins by id, and a snapshot is only as trustworthy as whoever holds the
 * ring code — so an id is never enough on its own to make this device fetch and
 * run code. It has to appear in the list Obsidian itself curates, which is the
 * same set the "Browse community plugins" screen offers.
 *
 * Without that check, an id in a snapshot would be an instruction to run
 * arbitrary code from an arbitrary repository. That is exactly the shape of the
 * PHANTOMPULSE attack this plugin was built to avoid repeating.
 */

const CATALOG_URL =
	'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';

/** Long enough that a sync does not refetch a two megabyte list every time. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface CatalogEntry {
	id: string;
	name: string;
	author: string;
	description: string;
	/** GitHub `owner/name`, which is what the installer wants. */
	repo: string;
}

export type FetchJson = (url: string) => Promise<unknown>;

/** Obsidian's own HTTP call: no CORS restrictions, and it works on mobile. */
export const requestJson: FetchJson = async (url) => {
	const response = await requestUrl({ url, throw: false });
	if (response.status !== 200) {
		throw new Error(`${url} answered ${String(response.status)}`);
	}
	return response.json as unknown;
};

function isEntry(value: unknown): value is CatalogEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<CatalogEntry>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.repo === 'string' &&
		// `owner/name`, and nothing that could climb out of a URL path.
		/^[\w.-]+\/[\w.-]+$/.test(candidate.repo)
	);
}

export class CommunityCatalog {
	private entries: Map<string, CatalogEntry> | undefined;
	private fetchedAt = 0;

	constructor(private readonly fetchJson: FetchJson = requestJson) {}

	/** Drops the cache, so the next lookup fetches a fresh list. */
	forget(): void {
		this.entries = undefined;
		this.fetchedAt = 0;
	}

	async load(now = Date.now()): Promise<Map<string, CatalogEntry>> {
		if (this.entries && now - this.fetchedAt < MAX_AGE_MS) {
			return this.entries;
		}

		const raw = await this.fetchJson(CATALOG_URL);
		if (!Array.isArray(raw)) {
			throw new Error('The community plugin list is not in the expected format.');
		}

		const entries = new Map<string, CatalogEntry>();
		for (const item of raw) {
			if (isEntry(item)) {
				entries.set(item.id, item);
			}
		}

		if (entries.size === 0) {
			// An empty list would silently turn every install into "not listed",
			// which would look like a policy decision rather than a failed fetch.
			throw new Error('The community plugin list came back empty.');
		}

		this.entries = entries;
		this.fetchedAt = now;
		return entries;
	}

	/** Undefined means the plugin is not in the curated list, and will not be installed. */
	async lookup(id: string): Promise<CatalogEntry | undefined> {
		return (await this.load()).get(id);
	}
}
