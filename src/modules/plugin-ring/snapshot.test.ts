import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { PluginApi } from '../../core/obsidian-internals';
import { FakeApp } from '../../test/fake-app';
import { buildSnapshot } from './snapshot';

/**
 * What the host publishes.
 *
 * Besides the plugins, the snapshot carries where the sync server is — which is
 * what spares every other device from being told an address by hand. It travels
 * inside the same encrypted envelope as everything else, because the address of a
 * machine on someone's home network is not a thing to write in clear text into a
 * vault that may be shared.
 */

const SELF = 'toolbox';

function setup() {
	const fake = new FakeApp({
		manifests: [
			{ id: 'alpha', name: 'Alpha', version: '1.0.0' },
			{ id: SELF, name: 'Toolbox', version: '0.1.0' },
		],
		enabled: ['alpha'],
		files: { '.obsidian/plugins/alpha/data.json': JSON.stringify({ mode: 'dark' }) },
	});
	const app = fake as unknown as App;
	const api = PluginApi.detect(app);
	if (!api) {
		throw new Error('PluginApi should recognise the fake app');
	}
	return { app, api };
}

const host = { id: 'device-1', name: 'Laptop' };

describe('building a snapshot', () => {
	it('carries the sync server the host was given', async () => {
		const { app, api } = setup();

		const snapshot = await buildSnapshot(app, api, {
			selfId: SELF,
			excludedIds: [],
			host,
			seq: 1,
			sync: { serverUrl: 'http://10.112.156.244:8787' },
		});

		expect(snapshot.sync).toEqual({ serverUrl: 'http://10.112.156.244:8787' });
	});

	it('leaves the field out entirely when there is no server', async () => {
		// A ring used only to keep plugins in step should not gain an empty field
		// that a reader then has to interpret.
		const { app, api } = setup();

		const snapshot = await buildSnapshot(app, api, {
			selfId: SELF,
			excludedIds: [],
			host,
			seq: 1,
			sync: {},
		});

		expect('sync' in snapshot).toBe(false);
	});

	it('never publishes Toolbox itself', async () => {
		// Its own data.json holds the ring code, which is the key to everything.
		const { app, api } = setup();

		const snapshot = await buildSnapshot(app, api, {
			selfId: SELF,
			excludedIds: [],
			host,
			seq: 1,
			sync: { serverUrl: 'http://10.112.156.244:8787' },
		});

		expect(snapshot.plugins.map((plugin) => plugin.id)).not.toContain(SELF);
	});

	it('drops the settings of an excluded plugin but keeps the plugin', async () => {
		const { app, api } = setup();

		const snapshot = await buildSnapshot(app, api, {
			selfId: SELF,
			excludedIds: ['alpha'],
			host,
			seq: 1,
		});

		const alpha = snapshot.plugins.find((plugin) => plugin.id === 'alpha');
		expect(alpha).toBeDefined();
		expect(alpha?.settings).toBeUndefined();
	});
});
