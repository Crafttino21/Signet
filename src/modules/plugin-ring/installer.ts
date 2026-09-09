import type { PluginManifest } from 'obsidian';
import type { PluginApi } from '../../core/obsidian-internals';
import type { CommunityCatalog, FetchJson } from './catalog';
import { requestJson } from './catalog';

/**
 * Installing a plugin the host has and this device does not.
 *
 * Obsidian's own installer does the work — the same one behind "Browse community
 * plugins" — so the downloading and the writing into the plugins folder are its
 * problem rather than ours. What this file owns is the decision of *whether* to
 * call it, and that decision is deliberately narrow: the id must appear in the
 * curated list, and the release must actually exist.
 */

export type InstallRefusal =
	/** Not in Obsidian's curated list. The one refusal that is a policy, not a fault. */
	| 'notListed'
	/** Listed, but the version the host names has no release with a manifest. */
	| 'noRelease'
	/** This Obsidian build does not expose an installer. */
	| 'unsupported';

export type InstallOutcome =
	| { ok: true; repo: string; version: string }
	| { ok: false; refusal: InstallRefusal; detail?: string };

export interface InstallDeps {
	api: PluginApi;
	catalog: CommunityCatalog;
	fetchJson?: FetchJson;
}

function releaseManifestUrls(repo: string, version: string): string[] {
	// Release tags are usually the bare version, but plenty of authors prefix a v.
	return [
		`https://github.com/${repo}/releases/download/${version}/manifest.json`,
		`https://github.com/${repo}/releases/download/v${version}/manifest.json`,
	];
}

function isManifest(value: unknown): value is PluginManifest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<PluginManifest>;
	return typeof candidate.id === 'string' && typeof candidate.version === 'string';
}

/**
 * Fetches the manifest belonging to one release.
 *
 * The installer needs it, and fetching it also proves the release exists before
 * anything is written — a version the host names but nobody published should fail
 * here rather than halfway through an install.
 */
async function fetchReleaseManifest(
	repo: string,
	version: string,
	fetchJson: FetchJson
): Promise<PluginManifest | undefined> {
	for (const url of releaseManifestUrls(repo, version)) {
		try {
			const manifest = await fetchJson(url);
			if (isManifest(manifest)) {
				return manifest;
			}
		} catch {
			// A missing tag is expected for one of the two spellings.
			continue;
		}
	}
	return undefined;
}

export async function installPlugin(
	deps: InstallDeps,
	request: { id: string; version: string }
): Promise<InstallOutcome> {
	if (!deps.api.canInstall()) {
		return { ok: false, refusal: 'unsupported' };
	}

	const listed = await deps.catalog.lookup(request.id);
	if (!listed) {
		// Refused on purpose. An id in a snapshot must never be enough to make this
		// device fetch and run code from somewhere Obsidian has not vouched for.
		return { ok: false, refusal: 'notListed' };
	}

	const fetchJson = deps.fetchJson ?? requestJson;
	const manifest = await fetchReleaseManifest(listed.repo, request.version, fetchJson);
	if (!manifest) {
		return {
			ok: false,
			refusal: 'noRelease',
			detail: `${listed.repo} has no release ${request.version}`,
		};
	}

	// A manifest whose id disagrees with what we asked for means the release does
	// not belong to this plugin, and installing it would put the wrong code in the
	// wrong folder.
	if (manifest.id !== request.id) {
		return {
			ok: false,
			refusal: 'noRelease',
			detail: `${listed.repo} release ${request.version} declares id "${manifest.id}"`,
		};
	}

	await deps.api.install(listed.repo, manifest.version, manifest);
	await deps.api.reloadManifests();

	return { ok: true, repo: listed.repo, version: manifest.version };
}
