import { Plugin } from 'obsidian';
import { ModuleRegistry } from './core/registry';
import { migrateSettings } from './core/settings';
import type { ToolboxSettings } from './core/settings';
import { ToolboxSettingTab } from './core/settings-tab';
import { TOOLBOX_MODULES } from './modules';

/**
 * The plugin itself does almost nothing: it loads settings, hands the module list
 * to the registry, and adds the settings tab. Every feature lives in src/modules.
 */
export default class ToolboxPlugin extends Plugin {
	// Plugin declares `settings?: unknown` and expects subclasses to narrow it.
	override settings!: ToolboxSettings;
	registry!: ModuleRegistry;

	override async onload(): Promise<void> {
		this.settings = migrateSettings(await this.loadData(), TOOLBOX_MODULES);
		this.registry = new ModuleRegistry(this, TOOLBOX_MODULES);

		this.addSettingTab(new ToolboxSettingTab(this.app, this));

		await this.registry.syncWithSettings();
	}

	override onunload(): void {
		// Deliberately empty. Obsidian unloads child components — and therefore every
		// module — on its own, and leaves are left attached on purpose: detaching them
		// here would break their restoration after a plugin update.
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Called when another device changes data.json underneath us (e.g. via sync). */
	override async onExternalSettingsChange(): Promise<void> {
		this.settings = migrateSettings(await this.loadData(), TOOLBOX_MODULES);
		await this.registry.syncWithSettings();
	}
}
