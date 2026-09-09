import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { PluginApi } from '../../core/obsidian-internals';
import { applyPlans } from './apply';
import type { InstallOutcome } from './installer';
import { FakeApp } from '../../test/fake-app';
import type { FakeAppOptions } from '../../test/fake-app';
import type { PluginPlan } from './types';

const SELF = 'toolbox';

function setup(options: FakeAppOptions) {
	const fake = new FakeApp(options);
	const app = fake as unknown as App;
	const api = PluginApi.detect(app);
	if (!api) {
		throw new Error('PluginApi should recognise the fake app');
	}
	return { fake, app, api };
}

const manifests = [
	{ id: 'alpha', name: 'Alpha', version: '1.0.0' },
	{ id: 'beta', name: 'Beta', version: '1.0.0' },
	{ id: SELF, name: 'Toolbox', version: '0.1.0' },
];

function plan(over: Partial<PluginPlan> & { id: string }): PluginPlan {
	return { name: over.id, ...over };
}

describe('applyPlans', () => {
	it('switches a plugin on', async () => {
		const { fake, app, api } = setup({ manifests, enabled: [] });

		const result = await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: 'alpha', enabled: true }),
		]);

		expect(result.complete).toBe(true);
		expect(fake.plugins.enabledPlugins.has('alpha')).toBe(true);
	});

	it('reloads a running plugin around a settings write', async () => {
		const { fake, app, api } = setup({ manifests, enabled: ['alpha'] });

		await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: 'alpha', settings: { theme: 'dark' } }),
		]);

		// It must be off while the file is written, then back on — otherwise the
		// running plugin would overwrite what we just wrote.
		expect(fake.calls).toEqual(['disable:alpha', 'enable:alpha']);
		expect(fake.readData('alpha')).toEqual({ theme: 'dark' });
		expect(fake.plugins.enabledPlugins.has('alpha')).toBe(true);
	});

	it('leaves a plugin off when the host has it off, even after writing settings', async () => {
		const { fake, app, api } = setup({ manifests, enabled: [] });

		await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: 'alpha', settings: { a: 1 }, enabled: false }),
		]);

		expect(fake.readData('alpha')).toEqual({ a: 1 });
		expect(fake.plugins.enabledPlugins.has('alpha')).toBe(false);
	});

	it('finishes one plugin completely before starting the next', async () => {
		const { fake, app, api } = setup({ manifests, enabled: ['alpha', 'beta'] });

		await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: 'alpha', settings: { a: 1 } }),
			plan({ id: 'beta', settings: { b: 2 } }),
		]);

		// Not disable:alpha, disable:beta, enable:alpha, enable:beta — a crash in the
		// middle of that would leave both plugins switched off.
		expect(fake.calls).toEqual([
			'disable:alpha',
			'enable:alpha',
			'disable:beta',
			'enable:beta',
		]);
	});

	it('keeps going after a failure and reports it', async () => {
		const { fake, app, api } = setup({ manifests, enabled: [], failOn: ['alpha'] });

		const result = await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: 'alpha', enabled: true }),
			plan({ id: 'beta', enabled: true }),
		]);

		expect(result.complete).toBe(false);
		expect(result.failed).toEqual([
			expect.objectContaining({ plan: expect.objectContaining({ id: 'alpha' }) }),
		]);
		expect(result.applied.map((p) => p.id)).toEqual(['beta']);
		// The healthy plugin was still switched on.
		expect(fake.plugins.enabledPlugins.has('beta')).toBe(true);
	});

	it('installs a plugin this device does not have, then switches it on', async () => {
		const { fake, app, api } = setup({ manifests, enabled: [] });
		const asked: { id: string; version: string }[] = [];

		const result = await applyPlans(
			{
				app,
				api,
				selfId: SELF,
				install: (request) => {
					asked.push(request);
					// Stand in for Obsidian's installer having written the files.
					fake.plugins.manifests[request.id] = {
						id: request.id,
						name: request.id,
						version: request.version,
					};
					return Promise.resolve({
						ok: true,
						repo: 'someone/' + request.id,
						version: request.version,
					} satisfies InstallOutcome);
				},
			},
			[plan({ id: 'gamma', install: '1.4.0', enabled: true, settings: { a: 1 } })]
		);

		expect(asked).toEqual([{ id: 'gamma', version: '1.4.0' }]);
		expect(result.installed).toEqual(['gamma']);
		expect(fake.readData('gamma')).toEqual({ a: 1 });
		expect(fake.plugins.enabledPlugins.has('gamma')).toBe(true);
		// A fresh install is not running, so there is nothing to switch off first.
		expect(fake.calls).toEqual(['enable:gamma']);
	});

	it('reports a refusal instead of half-applying it', async () => {
		const { fake, app, api } = setup({ manifests, enabled: [] });

		const result = await applyPlans(
			{
				app,
				api,
				selfId: SELF,
				install: () =>
					Promise.resolve({ ok: false, refusal: 'notListed' } satisfies InstallOutcome),
			},
			[plan({ id: 'gamma', install: '1.0.0', enabled: true })]
		);

		expect(result.complete).toBe(false);
		expect(result.installed).toEqual([]);
		// Nothing was switched on for a plugin that was never fetched.
		expect(fake.calls).toEqual([]);
		expect(result.failed[0]?.error).toContain('community plugin list');
	});

	it('fails a plan that needs installing when installing is switched off', async () => {
		const { app, api } = setup({ manifests, enabled: [] });

		const result = await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: 'gamma', install: '1.0.0' }),
		]);

		expect(result.complete).toBe(false);
		expect(result.failed).toHaveLength(1);
	});

	it('never touches Toolbox itself', async () => {
		const { fake, app, api } = setup({ manifests, enabled: [SELF] });

		const result = await applyPlans({ app, api, selfId: SELF }, [
			plan({ id: SELF, enabled: false, settings: { secret: 'leaked' } }),
		]);

		expect(fake.calls).toEqual([]);
		expect(fake.plugins.enabledPlugins.has(SELF)).toBe(true);
		expect(result.applied).toEqual([]);
		expect(result.complete).toBe(true);
	});
});

describe('PluginApi', () => {
	it('reports the installed plugins with their enabled state', () => {
		const { api } = setup({ manifests, enabled: ['alpha'] });

		expect(api.listInstalled()).toEqual([
			expect.objectContaining({ id: 'alpha', enabled: true, isDesktopOnly: false }),
			expect.objectContaining({ id: 'beta', enabled: false }),
			expect.objectContaining({ id: SELF, enabled: false }),
		]);
	});

	it('declines to work when the internal API is not there', () => {
		const app = { vault: { configDir: '.obsidian' } } as unknown as App;

		expect(PluginApi.detect(app)).toBeUndefined();
		expect(PluginApi.missing(app)).toEqual(['app.plugins']);
	});

	it('declines to work when the internal API changed shape', () => {
		const app = { plugins: { manifests: {} } } as unknown as App;

		expect(PluginApi.detect(app)).toBeUndefined();
		expect(PluginApi.missing(app)).toContain('enablePlugin');
	});
});
