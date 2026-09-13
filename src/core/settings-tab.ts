import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type SignetPlugin from '../main';
import { t } from '../i18n';
import { lastSeenVersion } from './device-state';
import { notesFor, notesSince } from './release';
import { WhatsNewModal } from './whats-new';

/**
 * Obsidian 1.13 introduced a declarative settings API (`getSettingDefinitions()`)
 * that also feeds the settings search, and deprecated `display()` in its favour.
 * We stay on `display()` for now: adopting it would raise minAppVersion from 1.8.7
 * to 1.13.0, and `display()` remains supported as the fallback for exactly that
 * reason. Worth revisiting once 1.13 is a safe baseline — the two lint rules that
 * ask for the new API are switched off for this file in eslint.config.js.
 */
export class SignetSettingTab extends PluginSettingTab {
	private readonly plugin: SignetPlugin;

	constructor(app: App, plugin: SignetPlugin) {
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
		const page = containerEl.createDiv({ cls: 'signet-settings' });

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

		// Last, because it is about the plugin rather than about anything it does,
		// and because a settings page should open on what the user came for.
		this.displayUpdates(page);
	}

	/**
	 * Whether to look for new versions, and the notes for this one.
	 *
	 * The notes are reachable again rather than only at the moment of the update:
	 * they appear once, on a start that is usually the middle of doing something
	 * else, and "what was that dialog" is a fair question to be able to answer.
	 */
	private displayUpdates(page: HTMLElement): void {
		new Setting(page).setName(t('update.settings.heading')).setHeading();

		new Setting(page)
			.setName(t('update.settings.check'))
			.setDesc(t('update.settings.checkDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.checkForUpdates).onChange(async (value) => {
					this.plugin.settings.checkForUpdates = value;
					await this.plugin.saveSettings();
				})
			);

		const installed = this.plugin.manifest.version;
		// Everything this device has not acknowledged, not only the newest release:
		// somebody who skipped three versions wants all three. Once they have been
		// acknowledged the button still works and shows this version's own notes.
		const outstanding = notesSince(installed, lastSeenVersion(this.app));
		const shown = outstanding.length > 0 ? outstanding : notesFor(installed);
		if (shown.length === 0) {
			return;
		}

		new Setting(page)
			.setName(t('update.settings.whatsNew'))
			.setDesc(t('update.settings.whatsNewDesc'))
			.addButton((button) =>
				button.setButtonText(t('update.settings.showNotes')).onClick(() => {
					new WhatsNewModal(this.app, shown, undefined, installed).open();
				})
			);
	}
}
