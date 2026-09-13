import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../i18n';
import { notesSince } from './release';
import type { ReleaseNote } from './release';

/**
 * What changed, said once, the first time the new version runs.
 *
 * A modal rather than a notice because it is a list and it is worth reading; once
 * rather than until dismissed because it is not a task. The two are deliberately
 * opposite to the update banner in the panel, which is a state — there is a newer
 * version than this one — and so stays until it stops being true.
 *
 * It never appears on a first install. Somebody who has just installed the plugin
 * has not skipped anything, and opening a changelog at them is answering a
 * question they have not asked. See {@link notesSince}.
 */
export class WhatsNewModal extends Modal {
	constructor(
		app: App,
		private readonly notes: readonly ReleaseNote[],
		/** What this device was on before. Absent when the notes were asked for. */
		private readonly from: string | undefined,
		private readonly to: string
	) {
		super(app);
	}

	/**
	 * Opens the modal if there is anything to say, and reports whether it did.
	 *
	 * The caller wants the whole decision in one place: working out that there is
	 * nothing to show and then not showing it is not something a start-up path
	 * should have to spell out.
	 */
	static openIfAnything(app: App, installed: string, lastSeen: string | null): boolean {
		const notes = notesSince(installed, lastSeen);
		if (notes.length === 0) {
			return false;
		}
		new WhatsNewModal(app, notes, lastSeen ?? undefined, installed).open();
		return true;
	}

	override onOpen(): void {
		this.contentEl.addClass('signet-modal');
		this.setTitle(t('whatsNew.title'));
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('signet-whats-new');

		if (this.from !== undefined) {
			contentEl.createEl('p', {
				cls: 'signet-whats-new__intro',
				text: t('whatsNew.intro', { from: this.from, to: this.to }),
			});
		}

		if (this.notes.length === 0) {
			contentEl.createEl('p', { text: t('whatsNew.nothing') });
		}

		for (const note of this.notes) {
			const section = contentEl.createDiv({ cls: 'signet-whats-new__release' });
			section.createEl('h3', { text: t('whatsNew.version', { version: note.version }) });

			const list = section.createEl('ul');
			for (const entry of note.entries) {
				list.createEl('li', { text: t(entry) });
			}
		}

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(t('whatsNew.done'))
				.setCta()
				.onClick(() => {
					this.close();
				})
		);
	}
}
