import { Notice, Setting } from 'obsidian';
import type { TAbstractFile } from 'obsidian';
import { ToolboxModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import type ToolboxPlugin from '../../main';

/**
 * Reference module: reacting to vault and workspace events.
 *
 * This is the case where per-module cleanup is visible. Everything below is
 * registered through `this.register*`, so switching the module off detaches the
 * listeners immediately — no flag checks inside the handlers, no leaks.
 */

type ExampleEventsSettings = {
	notifyOnRename: boolean;
};

const DEFAULT_SETTINGS: ExampleEventsSettings = {
	notifyOnRename: false,
};

class ExampleEventsModule extends ToolboxModule<ExampleEventsSettings> {
	private renameCount = 0;

	override onload(): void {
		this.registerEvent(
			this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
				this.renameCount += 1;
				if (this.settings.notifyOnRename) {
					new Notice(`${oldPath} → ${file.path}`);
				}
			})
		);

		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				// A hook for whatever should happen when the active note changes.
			})
		);
	}

	override displaySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Show a notice when a file is renamed')
			.setDesc(`Renames seen since this module was switched on: ${this.renameCount}.`)
			.addToggle((toggle) =>
				toggle.setValue(this.settings.notifyOnRename).onChange(async (value) => {
					await this.patchSettings({ notifyOnRename: value });
				})
			);
	}
}

export const exampleEventsModule: ModuleDescriptor<ExampleEventsSettings> = {
	id: 'example-events',
	name: 'Example events',
	description: 'Listens to vault and workspace events for as long as it is switched on.',
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new ExampleEventsModule(plugin, exampleEventsModule),
};
