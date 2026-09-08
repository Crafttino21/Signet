import { Notice } from 'obsidian';
import type { ModuleDescriptor, ToolboxModule } from './module';
import type ToolboxPlugin from '../main';

/**
 * Owns every module: which ones exist, which are switched on, and the live
 * instances of the ones currently running.
 *
 * Enable and disable both go through a serialised queue. Without it, flipping a
 * toggle quickly could interleave an activation with the deactivation before it
 * and leave a half-loaded module behind.
 */
export class ModuleRegistry {
	private readonly active = new Map<string, ToolboxModule>();
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly plugin: ToolboxPlugin,
		private readonly descriptors: readonly ModuleDescriptor[]
	) {}

	list(): readonly ModuleDescriptor[] {
		return this.descriptors;
	}

	isEnabled(id: string): boolean {
		return this.plugin.settings.enabledModules[id] === true;
	}

	/** The running instance, or undefined when the module is switched off. */
	getActive(id: string): ToolboxModule | undefined {
		return this.active.get(id);
	}

	/** Brings running modules in line with the stored settings. */
	syncWithSettings(): Promise<void> {
		return this.enqueue(() => {
			for (const descriptor of this.descriptors) {
				if (this.isEnabled(descriptor.id)) {
					this.activate(descriptor);
				} else {
					this.deactivate(descriptor.id);
				}
			}
		});
	}

	setEnabled(id: string, enabled: boolean): Promise<void> {
		return this.enqueue(async () => {
			const descriptor = this.descriptors.find((candidate) => candidate.id === id);
			if (!descriptor) {
				throw new Error(`Unknown module: ${id}`);
			}

			this.plugin.settings.enabledModules[id] = enabled;
			await this.plugin.saveSettings();

			if (enabled) {
				this.activate(descriptor);
			} else {
				this.deactivate(id);
			}
		});
	}

	/**
	 * Unloads every running module. Not needed on plugin unload — Obsidian unloads
	 * child components on its own — but useful in tests and for a full reload.
	 */
	disposeAll(): void {
		for (const id of [...this.active.keys()]) {
			this.deactivate(id);
		}
	}

	private activate(descriptor: ModuleDescriptor): void {
		if (this.active.has(descriptor.id)) {
			return;
		}

		try {
			// Always a fresh instance: a Component is not documented as reusable
			// once it has been unloaded.
			const module = descriptor.create(this.plugin);
			this.plugin.addChild(module);
			this.active.set(descriptor.id, module);
		} catch (error) {
			// One broken module must not take the whole plugin down with it.
			console.error(
				`Toolbox: module "${descriptor.id}" failed to load, switching it off.`,
				error
			);
			this.active.delete(descriptor.id);
			this.plugin.settings.enabledModules[descriptor.id] = false;
			void this.plugin.saveSettings();
			new Notice(`Toolbox: "${descriptor.name}" failed to load and was switched off.`);
		}
	}

	private deactivate(id: string): void {
		const module = this.active.get(id);
		if (!module) {
			return;
		}

		this.active.delete(id);
		try {
			// Switching a module off is an explicit user action, unlike the plugin
			// unloading on shutdown — so the module gets to do the extra cleanup
			// that would be wrong to do on shutdown.
			module.onDisable();
			// Unloads the component, which undoes every this.register* call it made.
			this.plugin.removeChild(module);
		} catch (error) {
			console.error(`Toolbox: module "${id}" failed to unload cleanly.`, error);
		}
	}

	private enqueue(task: () => void | Promise<void>): Promise<void> {
		const run = this.queue.then(task);
		this.queue = run.catch(() => undefined);
		return run;
	}
}
