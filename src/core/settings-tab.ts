import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type ToolboxPlugin from '../main';

/**
 * Obsidian 1.13 introduced a declarative settings API (`getSettingDefinitions()`)
 * that also feeds the settings search, and deprecated `display()` in its favour.
 * We stay on `display()` for now: adopting it would raise minAppVersion from 1.7.2
 * to 1.13.0, and `display()` remains supported as the fallback for exactly that
 * reason. Worth revisiting once 1.13 is a safe baseline — the two lint rules that
 * ask for the new API are switched off for this file in eslint.config.js.
 */
export class ToolboxSettingTab extends PluginSettingTab {
	private readonly plugin: ToolboxPlugin;

	constructor(app: App, plugin: ToolboxPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override display(): void {
		const { containerEl } = this;

		// Rebuilt from scratch every time. Patching sections in place would leave
		// stale controls behind whenever a module is switched off.
		containerEl.empty();

		for (const descriptor of this.plugin.registry.list()) {
			new Setting(containerEl).setName(descriptor.name).setHeading();

			new Setting(containerEl)
				.setName('Enable')
				.setDesc(descriptor.description)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.registry.isEnabled(descriptor.id))
						.onChange(async (value) => {
							await this.plugin.registry.setEnabled(descriptor.id, value);
							// Re-render so the module's own controls appear or vanish.
							this.display();
						})
				);

			this.plugin.registry.getActive(descriptor.id)?.displaySettings(containerEl);
		}
	}
}
