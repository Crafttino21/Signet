import { Notice, Setting } from 'obsidian';
import { ToolboxModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import type ToolboxPlugin from '../../main';

/**
 * Reference module: a command, a ribbon icon, and one setting of its own.
 * Copy this file as the starting point for a simple feature.
 */

type ExampleCommandSettings = {
	greeting: string;
};

const DEFAULT_SETTINGS: ExampleCommandSettings = {
	greeting: 'Hello from Toolbox',
};

class ExampleCommandModule extends ToolboxModule<ExampleCommandSettings> {
	override onload(): void {
		// this.addCommand / this.addRibbonIcon (not this.plugin.*) so both are
		// undone again when the module is switched off.
		this.addCommand({
			id: 'show-greeting',
			name: 'Show greeting',
			callback: () => this.showGreeting(),
		});

		this.addRibbonIcon('message-square', 'Show greeting', () => this.showGreeting());
	}

	override displaySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Greeting')
			.setDesc('Text shown by the command and the ribbon icon.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.greeting)
					.setValue(this.settings.greeting)
					.onChange(async (value) => {
						await this.patchSettings({ greeting: value });
					})
			);
	}

	private showGreeting(): void {
		new Notice(this.settings.greeting || DEFAULT_SETTINGS.greeting);
	}
}

export const exampleCommandModule: ModuleDescriptor<ExampleCommandSettings> = {
	id: 'example-command',
	name: 'Example command',
	description: 'Adds a command and a ribbon icon that show a short message.',
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new ExampleCommandModule(plugin, exampleCommandModule),
};
