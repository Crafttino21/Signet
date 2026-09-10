import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { ServerSetupOutcome } from '../../core/ring-link';
import { SERVER_PLACEHOLDER } from './server-url';

/** What connecting was asked to do, and what it said. */
export interface ConnectAttempt {
	serverUrl: string;
	registrationSecret: string;
}

export type ConnectResult = { ok: true } | { ok: false; message: string };

/**
 * The server, asked for before a ring code exists to hand out.
 *
 * This is the first thing a new ring does, and the ordering is the whole point:
 * the code carries the server address, so a code shown before the server is
 * connected carries none — and every device that joins with it is stranded with
 * no way of finding out why. Asking here means the first code anyone sees is
 * already the complete one.
 *
 * The modal stays open when connecting fails. A wrong port or a mistyped secret
 * is the ordinary outcome of this dialog, and closing it would throw away the
 * other field along with the ring that has not been created yet.
 */
export class ConnectServerModal extends Modal {
	private serverUrl = '';
	private registrationSecret = '';
	private outcome: ServerSetupOutcome = 'cancelled';
	private busy = false;
	private error: string | undefined;

	private constructor(
		app: App,
		private readonly connect: (attempt: ConnectAttempt) => Promise<ConnectResult>,
		private readonly done: (outcome: ServerSetupOutcome) => void
	) {
		super(app);
	}

	static ask(
		app: App,
		connect: (attempt: ConnectAttempt) => Promise<ConnectResult>
	): Promise<ServerSetupOutcome> {
		return new Promise((resolve) => {
			new ConnectServerModal(app, connect, resolve).open();
		});
	}

	override onOpen(): void {
		this.contentEl.addClass('signet-modal');
		this.setTitle(t('vaultSync.connect.title'));
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.done(this.outcome);
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('p', { cls: 'signet-ring__hint', text: t('vaultSync.connect.hint') });

		if (this.error !== undefined) {
			contentEl.createEl('p', { cls: 'signet-ring__warning', text: this.error });
		}

		new Setting(contentEl)
			.setName(t('vaultSync.settings.server'))
			.setDesc(t('vaultSync.connect.serverDesc'))
			.addText((text) =>
				text
					.setPlaceholder(SERVER_PLACEHOLDER)
					.setValue(this.serverUrl)
					.onChange((value) => {
						this.serverUrl = value;
					})
			);

		new Setting(contentEl)
			.setName(t('vaultSync.settings.registration'))
			.setDesc(t('vaultSync.connect.secretDesc'))
			.addText((text) =>
				text.setValue(this.registrationSecret).onChange((value) => {
					this.registrationSecret = value;
				})
			);

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText(
						this.busy ? t('vaultSync.connect.working') : t('vaultSync.connect.connect')
					)
					.setCta()
					.setDisabled(this.busy)
					.onClick(() => void this.attempt())
			)
			.addButton((button) =>
				button
					.setButtonText(t('vaultSync.connect.without'))
					.setDisabled(this.busy)
					.onClick(() => {
						this.outcome = 'skipped';
						this.close();
					})
			);

		contentEl.createEl('p', {
			cls: 'signet-ring__hint',
			text: t('vaultSync.connect.withoutHint'),
		});
	}

	private async attempt(): Promise<void> {
		this.busy = true;
		this.error = undefined;
		this.render();

		const result = await this.connect({
			serverUrl: this.serverUrl,
			registrationSecret: this.registrationSecret,
		});

		this.busy = false;
		if (result.ok) {
			this.outcome = 'connected';
			this.close();
			return;
		}

		this.error = result.message;
		this.render();
	}
}
