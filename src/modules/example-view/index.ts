import { ItemView } from 'obsidian';
import type { IconName, WorkspaceLeaf } from 'obsidian';
import { ToolboxModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import { registerViewOnce } from '../../core/view';
import type ToolboxPlugin from '../../main';

/**
 * Reference module: a sidebar view. Copy this file for a feature that needs its
 * own panel rather than just a command.
 */

export const EXAMPLE_VIEW_TYPE = 'toolbox-example-view';

type ExampleViewSettings = Record<string, never>;

class ExampleView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType(): string {
		return EXAMPLE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Toolbox example';
	}

	override getIcon(): IconName {
		return 'layout-panel-left';
	}

	protected override async onOpen(): Promise<void> {
		// createEl/createDiv rather than innerHTML — user-controlled strings must
		// never reach the DOM as markup.
		this.contentEl.empty();
		this.contentEl.createEl('p', {
			text: 'This panel is here to be replaced by something useful.',
			cls: 'toolbox-example-view__hint',
		});
	}

	protected override async onClose(): Promise<void> {
		this.contentEl.empty();
	}
}

class ExampleViewModule extends ToolboxModule<ExampleViewSettings> {
	override onload(): void {
		// The view type outlives the module on purpose — see registerViewOnce.
		registerViewOnce(this.plugin, EXAMPLE_VIEW_TYPE, (leaf) => new ExampleView(leaf));

		this.addCommand({
			id: 'open-view',
			name: 'Open example panel',
			callback: () => {
				void this.revealView();
			},
		});
	}

	override onDisable(): void {
		// Only on an explicit switch-off, never on plugin unload: closing leaves
		// during shutdown or an update would lose their position.
		this.app.workspace.detachLeavesOfType(EXAMPLE_VIEW_TYPE);
	}

	private async revealView(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(EXAMPLE_VIEW_TYPE)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}

		await leaf.setViewState({ type: EXAMPLE_VIEW_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}
}

export const exampleViewModule: ModuleDescriptor<ExampleViewSettings> = {
	id: 'example-view',
	name: 'Example panel',
	description: 'Adds a command that opens an empty panel in the right sidebar.',
	defaultSettings: {},
	create: (plugin: ToolboxPlugin) => new ExampleViewModule(plugin, exampleViewModule),
};
