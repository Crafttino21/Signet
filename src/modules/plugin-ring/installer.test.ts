import type { App } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { PluginApi } from '../../core/obsidian-internals';
import { FakeApp } from '../../test/fake-app';
import { CommunityCatalog } from './catalog';
import { installPlugin } from './installer';

/**
 * These tests guard the line between "the host says it has this plugin" and "this
 * device fetches and runs code". A ring snapshot is only as trustworthy as
 * whoever holds the ring code, so an id in one is never enough on its own.
 */

const LISTED = [
	{
		id: 'dataview',
		name: 'Dataview',
		author: 'blacksmithgu',
		description: 'Queries',
		repo: 'blacksmithgu/obsidian-dataview',
	},
	{
		id: 'templater',
		name: 'Templater',
		author: 'SilentVoid13',
		description: 'Templates',
		repo: 'SilentVoid13/Templater',
	},
];

function catalogOf(entries: unknown = LISTED): CommunityCatalog {
	return new CommunityCatalog(() => Promise.resolve(entries));
}

function apiWith(installed: string[] = []) {
	const fake = new FakeApp({
		manifests: installed.map((id) => ({ id, name: id, version: '1.0.0' })),
	});
	const install = vi.fn(() => Promise.resolve());
	(fake.plugins as unknown as { installPlugin: unknown }).installPlugin = install;
	(fake.plugins as unknown as { loadManifests: unknown }).loadManifests = () => Promise.resolve();

	const api = PluginApi.detect(fake as unknown as App);
	if (!api) {
		throw new Error('PluginApi should recognise the fake app');
	}
	return { api, install, fake };
}

function releaseManifest(id: string, version: string) {
	return (url: string) => {
		if (url.includes(`/releases/download/${version}/manifest.json`)) {
			return Promise.resolve({ id, name: id, version, minAppVersion: '1.0.0' });
		}
		return Promise.reject(new Error('404'));
	};
}

describe('the curated list is the boundary', () => {
	it('refuses a plugin that is not listed, whatever the snapshot says', async () => {
		const { api, install } = apiWith();

		const outcome = await installPlugin(
			{ api, catalog: catalogOf(), fetchJson: releaseManifest('evil', '9.9.9') },
			{ id: 'evil', version: '9.9.9' }
		);

		expect(outcome).toEqual({ ok: false, refusal: 'notListed' });
		// The point: Obsidian's installer was never even asked.
		expect(install).not.toHaveBeenCalled();
	});

	it('installs a listed plugin from the repository the list names', async () => {
		const { api, install } = apiWith();

		const outcome = await installPlugin(
			{
				api,
				catalog: catalogOf(),
				fetchJson: releaseManifest('dataview', '0.5.67'),
			},
			{ id: 'dataview', version: '0.5.67' }
		);

		expect(outcome).toEqual({
			ok: true,
			repo: 'blacksmithgu/obsidian-dataview',
			version: '0.5.67',
		});
		expect(install).toHaveBeenCalledWith(
			'blacksmithgu/obsidian-dataview',
			'0.5.67',
			expect.objectContaining({ id: 'dataview' })
		);
	});

	it('accepts a release tagged with a leading v', async () => {
		const { api, install } = apiWith();
		const fetchJson = (url: string) =>
			url.includes('/releases/download/v1.2.3/manifest.json')
				? Promise.resolve({ id: 'templater', name: 'Templater', version: '1.2.3' })
				: Promise.reject(new Error('404'));

		const outcome = await installPlugin(
			{ api, catalog: catalogOf(), fetchJson },
			{ id: 'templater', version: '1.2.3' }
		);

		expect(outcome.ok).toBe(true);
		expect(install).toHaveBeenCalled();
	});

	it('refuses when the version the host names has no release', async () => {
		const { api, install } = apiWith();

		const outcome = await installPlugin(
			{ api, catalog: catalogOf(), fetchJson: () => Promise.reject(new Error('404')) },
			{ id: 'dataview', version: '0.0.1' }
		);

		expect(outcome).toMatchObject({ ok: false, refusal: 'noRelease' });
		expect(install).not.toHaveBeenCalled();
	});

	it('refuses a release whose manifest belongs to a different plugin', async () => {
		const { api, install } = apiWith();

		// The list says dataview lives here, but the release declares something
		// else — so the repository is not what the list vouched for.
		const outcome = await installPlugin(
			{ api, catalog: catalogOf(), fetchJson: releaseManifest('something-else', '0.5.67') },
			{ id: 'dataview', version: '0.5.67' }
		);

		expect(outcome).toMatchObject({ ok: false, refusal: 'noRelease' });
		expect(install).not.toHaveBeenCalled();
	});

	it('refuses when this Obsidian has no installer', async () => {
		const fake = new FakeApp({ manifests: [] });
		const api = PluginApi.detect(fake as unknown as App);

		const outcome = await installPlugin(
			{ api: api!, catalog: catalogOf(), fetchJson: releaseManifest('dataview', '1.0.0') },
			{ id: 'dataview', version: '1.0.0' }
		);

		expect(outcome).toEqual({ ok: false, refusal: 'unsupported' });
	});
});

describe('the catalog itself', () => {
	it('drops entries whose repository could climb out of a URL', async () => {
		const catalog = catalogOf([
			{ id: 'ok', repo: 'owner/name', name: 'Ok', author: 'a', description: 'b' },
			{ id: 'bad', repo: '../../etc/passwd', name: 'Bad', author: 'a', description: 'b' },
			{
				id: 'worse',
				repo: 'owner/name/../../x',
				name: 'Worse',
				author: 'a',
				description: 'b',
			},
		]);

		await expect(catalog.lookup('ok')).resolves.toMatchObject({ repo: 'owner/name' });
		await expect(catalog.lookup('bad')).resolves.toBeUndefined();
		await expect(catalog.lookup('worse')).resolves.toBeUndefined();
	});

	it('treats an empty list as a failure rather than a policy', async () => {
		// Silently returning nothing would make every install look deliberately
		// refused, hiding a broken fetch behind a sensible-looking message.
		await expect(catalogOf([]).lookup('dataview')).rejects.toThrow('empty');
	});

	it('rejects a list that is not a list', async () => {
		await expect(catalogOf({ nope: true }).lookup('dataview')).rejects.toThrow('format');
	});

	it('fetches once and then serves from memory', async () => {
		const fetchJson = vi.fn(() => Promise.resolve(LISTED));
		const catalog = new CommunityCatalog(fetchJson);

		await catalog.lookup('dataview');
		await catalog.lookup('templater');

		expect(fetchJson).toHaveBeenCalledTimes(1);
	});

	it('fetches again once told to forget', async () => {
		const fetchJson = vi.fn(() => Promise.resolve(LISTED));
		const catalog = new CommunityCatalog(fetchJson);

		await catalog.lookup('dataview');
		catalog.forget();
		await catalog.lookup('dataview');

		expect(fetchJson).toHaveBeenCalledTimes(2);
	});
});
