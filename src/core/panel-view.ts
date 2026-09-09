import { ItemView } from 'obsidian';
import type { IconName, WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n';
import type ToolboxPlugin from '../main';

export const TOOLBOX_PANEL_TYPE = 'toolbox-panel';

/**
 * The one place to manage everything Toolbox does.
 *
 * The panel does not know what any feature is. It walks the modules that are
 * switched on and asks each to draw itself, which keeps a feature's code in its
 * own folder and means a new module appears here without this file changing.
 *
 * It redraws on demand rather than on a timer: a panel that rebuilt itself every
 * second would steal focus from anything the user was in the middle of pressing.
 */
export class ToolboxPanelView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: ToolboxPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return TOOLBOX_PANEL_TYPE;
	}

	getDisplayText(): string {
		return t('panel.title');
	}

	override getIcon(): IconName {
		return 'wrench';
	}

	protected override async onOpen(): Promise<void> {
		this.render();
	}

	protected override async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('toolbox-panel');

		// The shortest path from "installed" to "working" belongs at the top, and
		// disappears once there is nothing left to set up.
		const outstanding = this.plugin.registry
			.list()
			.flatMap(
				(descriptor) => this.plugin.registry.getActive(descriptor.id)?.setupStep() ?? []
			)
			.filter((step) => !step.satisfied());

		if (outstanding.length > 0) {
			const banner = contentEl.createDiv({ cls: 'toolbox-panel__setup' });
			banner.createEl('p', {
				text: t('panel.setupNeeded', { count: outstanding.length }),
			});
			banner
				.createEl('button', { text: t('setup.command'), cls: 'mod-cta' })
				.addEventListener('click', () => {
					this.plugin.openSetup();
				});
		}

		let drew = false;
		for (const descriptor of this.plugin.registry.list()) {
			const module = this.plugin.registry.getActive(descriptor.id);
			if (!module) {
				continue;
			}

			// A module with nothing to show should not leave an empty heading
			// behind, so it is given a scratch element and only kept if it used it.
			const section = createDiv({ cls: 'toolbox-panel__section' });
			module.displayPanel(section);
			if (section.childElementCount === 0) {
				continue;
			}

			contentEl.appendChild(section);
			drew = true;
		}

		if (!drew) {
			contentEl.createEl('p', { cls: 'toolbox-panel__empty', text: t('panel.nothing') });
		}
	}
}
