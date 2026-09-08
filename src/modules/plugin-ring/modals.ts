import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { describeResult } from './apply';
import type { ApplyResult } from './apply';
import type { DiffItem } from './types';

/** Asks for a ring code. Validation happens in the caller, which knows the ring. */
export class JoinRingModal extends Modal {
	private code = '';

	constructor(
		app: App,
		private readonly onSubmit: (code: string) => Promise<void>
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Join a plugin ring');

		this.contentEl.createEl('p', {
			cls: 'toolbox-ring__hint',
			text: 'Enter the code shown on the device that hosts the ring. Nothing is changed until you have seen what would happen.',
		});

		new Setting(this.contentEl).setName('Ring code').addText((text) =>
			text.setPlaceholder('Paste your ring code').onChange((value) => {
				this.code = value;
			})
		);

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Join')
				.setCta()
				.onClick(() => {
					const code = this.code;
					this.close();
					void this.onSubmit(code);
				})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Shows the ring code so it can be typed on another device. */
export class ShowCodeModal extends Modal {
	constructor(
		app: App,
		private readonly code: string
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle('Your ring code');

		this.contentEl.createEl('p', {
			cls: 'toolbox-ring__hint',
			text: 'Enter this on another device to add it to the ring. Anyone who has it can read and publish to the ring, so treat it like a password.',
		});
		this.contentEl.createDiv({ cls: 'toolbox-ring__code', text: this.code });

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Copy')
				.setCta()
				.onClick(() => {
					void navigator.clipboard.writeText(this.code).then(
						() => new Notice('Ring code copied.'),
						() => new Notice('Could not copy the code — select it by hand.')
					);
				})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

const KIND_LABEL: Record<DiffItem['kind'], string> = {
	missing: 'Not installed here',
	enable: 'Switch on',
	disable: 'Switch off',
	version: 'Different version',
	settings: 'Settings differ',
	extra: 'Only on this device',
};

/**
 * Shows what would change and asks before doing any of it.
 *
 * Applying a ring update means running other people's code, so this dialog is
 * mandatory rather than a convenience: a synced file must never be able to change
 * a device on its own.
 */
export class RingDiffModal extends Modal {
	constructor(
		app: App,
		private readonly items: readonly DiffItem[],
		private readonly context: { hostName: string; hostChanged: boolean },
		private readonly onApply: () => Promise<ApplyResult>
	) {
		super(app);
	}

	override onOpen(): void {
		const actionable = this.items.filter((item) => item.actionable);
		const rest = this.items.filter((item) => !item.actionable);

		this.setTitle(`Ring update from "${this.context.hostName}"`);

		if (this.context.hostChanged) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-ring__warning',
				text: 'This snapshot was published by a different device than before. If you did not hand the host role over yourself, do not apply it.',
			});
		}

		if (this.items.length === 0) {
			this.contentEl.createEl('p', { text: 'This device already matches the host.' });
			return;
		}

		if (actionable.length > 0) {
			this.renderSection('Will be applied', actionable);
		}
		if (rest.length > 0) {
			this.renderSection('Left alone', rest);
		}

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(
						actionable.length === 0
							? 'Nothing to apply'
							: `Apply ${actionable.length} change${actionable.length === 1 ? '' : 's'}`
					)
					.setCta()
					.setDisabled(actionable.length === 0)
					.onClick(() => {
						this.close();
						void this.onApply().then((result) => new Notice(describeResult(result)));
					})
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private renderSection(title: string, items: readonly DiffItem[]): void {
		new Setting(this.contentEl).setName(title).setHeading();

		const list = this.contentEl.createEl('ul', { cls: 'toolbox-ring__list' });
		for (const item of items) {
			const row = list.createEl('li', { cls: 'toolbox-ring__row' });
			row.createSpan({ cls: 'toolbox-ring__name', text: item.name });
			row.createSpan({ cls: 'toolbox-ring__kind', text: KIND_LABEL[item.kind] });

			const detail = this.describeVersions(item);
			if (detail) {
				row.createSpan({ cls: 'toolbox-ring__detail', text: detail });
			}
			if (item.reason) {
				row.createSpan({ cls: 'toolbox-ring__reason', text: item.reason });
			}
		}
	}

	private describeVersions(item: DiffItem): string {
		if (item.hostVersion && item.localVersion) {
			return `${item.localVersion} → ${item.hostVersion}`;
		}
		return item.hostVersion ?? item.localVersion ?? '';
	}
}
