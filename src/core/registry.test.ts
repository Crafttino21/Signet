// Imported by path rather than as 'obsidian': typechecking resolves 'obsidian' to
// the real package, which would hide the stub's test helpers. At runtime this is
// the same module the alias points at, so the classes are identical.
import { Plugin } from '../test/obsidian.stub';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolboxModule } from './module';
import type { ModuleDescriptor } from './module';
import { ModuleRegistry } from './registry';
import type { ToolboxSettings } from './settings';
import type ToolboxPlugin from '../main';

/** Records what the lifecycle actually did, in order. */
let events: string[] = [];

class TestModule extends ToolboxModule {
	override onload(): void {
		events.push('onload');
		// The point of the whole design: this cleanup must run on disable.
		this.register(() => events.push('cleanup'));
		this.addCommand({ id: 'test', name: 'Test', callback: () => undefined });
	}

	override onDisable(): void {
		events.push('onDisable');
	}

	override onunload(): void {
		events.push('onunload');
	}
}

const testModule: ModuleDescriptor = {
	id: 'test',
	name: 'Test module',
	description: 'For tests only',
	defaultSettings: {},
	create: (plugin) => new TestModule(plugin, testModule),
};

const brokenModule: ModuleDescriptor = {
	id: 'broken',
	name: 'Broken module',
	description: 'Throws on creation',
	defaultSettings: {},
	create: () => {
		throw new Error('boom');
	},
};

class TestPlugin extends Plugin {
	settings: ToolboxSettings = { version: 1, enabledModules: {}, moduleSettings: {} };
	saveSettings = vi.fn(() => Promise.resolve());
}

function setup(descriptors: readonly ModuleDescriptor[]) {
	const plugin = new TestPlugin();
	plugin.load();
	const registry = new ModuleRegistry(plugin as unknown as ToolboxPlugin, descriptors);
	return { plugin, registry };
}

beforeEach(() => {
	events = [];
});

describe('ModuleRegistry', () => {
	it('loads a module when it is switched on and persists the choice', async () => {
		const { plugin, registry } = setup([testModule]);

		await registry.setEnabled('test', true);

		expect(events).toEqual(['onload']);
		expect(registry.isEnabled('test')).toBe(true);
		expect(registry.getActive('test')).toBeDefined();
		expect(plugin.saveSettings).toHaveBeenCalledOnce();
		expect(plugin.commands.has('toolbox:test')).toBe(true);
	});

	it('undoes everything the module registered when it is switched off', async () => {
		const { plugin, registry } = setup([testModule]);

		await registry.setEnabled('test', true);
		await registry.setEnabled('test', false);

		expect(events).toEqual(['onload', 'onDisable', 'cleanup', 'onunload']);
		expect(registry.getActive('test')).toBeUndefined();
		// The command registered in onload is gone again.
		expect(plugin.commands.has('toolbox:test')).toBe(false);
	});

	it('creates a fresh instance on re-enable rather than reusing the old one', async () => {
		const { registry } = setup([testModule]);

		await registry.setEnabled('test', true);
		const first = registry.getActive('test');

		await registry.setEnabled('test', false);
		await registry.setEnabled('test', true);

		expect(registry.getActive('test')).toBeDefined();
		expect(registry.getActive('test')).not.toBe(first);
	});

	it('switches a module off instead of failing the plugin when it throws', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { registry } = setup([brokenModule]);

		await registry.setEnabled('broken', true);

		expect(registry.getActive('broken')).toBeUndefined();
		expect(registry.isEnabled('broken')).toBe(false);
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it('starts only the modules the settings enable', async () => {
		const { registry } = setup([testModule]);
		await registry.syncWithSettings();
		expect(registry.getActive('test')).toBeUndefined();

		await registry.setEnabled('test', true);
		await registry.syncWithSettings();
		// Already running — sync must not load it a second time.
		expect(events).toEqual(['onload']);
	});

	it('serialises rapid toggling so the module ends up in the requested state', async () => {
		const { registry } = setup([testModule]);

		await Promise.all([
			registry.setEnabled('test', true),
			registry.setEnabled('test', false),
			registry.setEnabled('test', true),
		]);

		expect(registry.isEnabled('test')).toBe(true);
		expect(registry.getActive('test')).toBeDefined();
		expect(events).toEqual(['onload', 'onDisable', 'cleanup', 'onunload', 'onload']);
	});
});
