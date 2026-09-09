import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';
import type ToolboxPlugin from '../main';

/**
 * The guided setup.
 *
 * Getting this running takes a handful of decisions in a particular order — a
 * ring first, because its code is the key to everything else, then a server. Left
 * to the settings screen that order is invisible, and someone reasonably tries the
 * server first and is told to go away and do something else.
 *
 * Each module contributes its own step rather than the wizard knowing what a ring
 * or a server is, so a module keeps its setup beside the rest of its code and a
 * new one appears here without this file changing.
 */

export interface SetupStep {
	/** Short label, shown in the list of steps. */
	title: string;
	/** One line on what this step is for. */
	hint: string;
	/** True once the step no longer needs anything from the user. */
	satisfied: () => boolean;
	/**
	 * Draws the step's inputs. Call `changed` after anything that might have
	 * satisfied it, so the wizard can move on.
	 */
	render: (containerEl: HTMLElement, changed: () => void) => void;
}

export class SetupModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: ToolboxPlugin
	) {
		super(app);
	}

	override onOpen(): void {
		this.contentEl.addClass('toolbox-modal');
		this.setTitle(t('setup.title'));
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private steps(): SetupStep[] {
		return this.plugin.registry
			.list()
			.flatMap(
				(descriptor) => this.plugin.registry.getActive(descriptor.id)?.setupStep() ?? []
			);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('toolbox-setup');

		const steps = this.steps();
		if (steps.length === 0) {
			contentEl.createEl('p', { text: t('setup.nothing') });
			return;
		}

		const outstanding = steps.filter((step) => !step.satisfied());
		if (outstanding.length === 0) {
			contentEl.createEl('p', { cls: 'toolbox-setup__done', text: t('setup.allDone') });
		}

		steps.forEach((step, index) => {
			const done = step.satisfied();
			const section = contentEl.createDiv({
				cls: done ? 'toolbox-setup__step toolbox-setup__step--done' : 'toolbox-setup__step',
			});

			section.createEl('h3', {
				text: `${String(index + 1)}. ${step.title}${done ? ' ✓' : ''}`,
			});
			section.createEl('p', { cls: 'toolbox-setup__hint', text: step.hint });

			// A finished step collapses to its heading: it is there for reassurance,
			// not for another round of decisions.
			if (!done) {
				step.render(section, () => {
					this.render();
				});
			}
		});

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(outstanding.length === 0 ? t('setup.finish') : t('common.cancel'))
				.setCta()
				.onClick(() => {
					this.close();
					void this.plugin.openPanel();
				})
		);
	}
}
