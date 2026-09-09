import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type ToolboxPlugin from '../main';
import { t } from '../i18n';

/**
 * Obsidian 1.13 introduced a declarative settings API (`getSettingDefinitions()`)
 * that also feeds the settings search, and deprecated `display()` in its favour.
 * We stay on `display()` for now: adopting it would raise minAppVersion from 1.8.7
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

	/**
	 * Redraws, but only while the user is actually looking at this tab.
	 *
	 * A module calls this after changing something the settings show — creating a
	 * ring, registering with a server. Without it the controls keep describing the
	 * state from before the button was pressed until the tab is left and reopened,
	 * which reads as "nothing happened".
	 *
	 * The visibility check is what makes it safe to call from anywhere: when the
	 * tab is closed its container is detached, and redrawing into it would be work
	 * nobody sees, thrown away by the next `display()`.
	 */
	refresh(): void {
		if (this.containerEl.isConnected) {
			this.display();
		}
	}

	override display(): void {
		const { containerEl } = this;

		// Rebuilt from scratch every time. Patching sections in place would leave
		// stale controls behind whenever a module is switched off.
		containerEl.empty();

		// Every module gets its own container: it is what the narrow-screen rules in
		// styles.css hang off, and Obsidian's setting rows are otherwise loose
		// children of a tab this plugin does not own.
		const page = containerEl.createDiv({ cls: 'toolbox-settings' });

		for (const descriptor of this.plugin.registry.visible()) {
			new Setting(page).setName(descriptor.name).setHeading();

			new Setting(page)
				.setName(t('common.enable'))
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

			this.plugin.registry.getActive(descriptor.id)?.displaySettings(page);
		}
	}
}
