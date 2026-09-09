import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type { SyncReport } from './engine';
import type { SyncAction } from './reconcile';

const ACTION_KEY: Record<SyncAction['kind'], TranslationKey> = {
	upload: 'vaultSync.action.upload',
	download: 'vaultSync.action.download',
	deleteLocal: 'vaultSync.action.deleteLocal',
	deleteRemote: 'vaultSync.action.deleteRemote',
	conflict: 'vaultSync.action.conflict',
	resurrect: 'vaultSync.action.resurrect',
};

/** Actions that change this device, and so deserve a confirmation. */
const LOCAL_KINDS = new Set<SyncAction['kind']>(['download', 'deleteLocal', 'conflict']);

/**
 * Shows what a sync would do before it does it.
 *
 * Only ever asked for when the run would change something on this device.
 * Uploading is not worth interrupting anyone over; overwriting or trashing a file
 * here is, especially for someone who has lost notes to a sync tool before.
 */
export class SyncPlanModal extends Modal {
	constructor(
		app: App,
		private readonly actions: readonly SyncAction[],
		private readonly context: { firstRun: boolean },
		private readonly onConfirm: () => void
	) {
		super(app);
	}

	override onOpen(): void {
		this.contentEl.addClass('toolbox-modal');
		this.setTitle(t('vaultSync.plan.title'));

		if (this.context.firstRun) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-sync__note',
				text: t('vaultSync.plan.firstRun'),
			});
		}

		const local = this.actions.filter((action) => LOCAL_KINDS.has(action.kind));
		const remote = this.actions.filter((action) => !LOCAL_KINDS.has(action.kind));

		if (local.length > 0) {
			this.renderSection(t('vaultSync.plan.hereChanges'), local);
		}
		if (remote.length > 0) {
			this.renderSection(t('vaultSync.plan.serverChanges'), remote);
		}

		if (this.actions.some((action) => action.kind === 'conflict')) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-sync__note',
				text: t('vaultSync.plan.conflictNote'),
			});
		}

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(t('common.cancel')).onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText(t('vaultSync.plan.confirm'))
					.setCta()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private renderSection(title: string, actions: readonly SyncAction[]): void {
		new Setting(this.contentEl).setName(title).setHeading();

		const list = this.contentEl.createEl('ul', { cls: 'toolbox-sync__list' });
		for (const action of actions) {
			const row = list.createEl('li', { cls: 'toolbox-sync__row' });
			row.createSpan({ cls: 'toolbox-sync__name', text: action.path });
			row.createSpan({
				cls: action.kind === 'deleteLocal' ? 'toolbox-sync__warn' : 'toolbox-sync__meta',
				text: t(ACTION_KEY[action.kind]),
			});
		}
	}
}

/** One line summarising a finished run, for a notice. */
export function describeReport(report: SyncReport): string {
	if (report.failed.length > 0) {
		return t('vaultSync.result.partial', {
			done: report.uploaded.length + report.downloaded.length,
			failed: report.failed.length,
		});
	}

	const parts: string[] = [];
	if (report.downloaded.length > 0) {
		parts.push(t('vaultSync.result.downloaded', { count: report.downloaded.length }));
	}
	if (report.uploaded.length > 0) {
		parts.push(t('vaultSync.result.uploaded', { count: report.uploaded.length }));
	}
	if (report.trashed.length > 0) {
		parts.push(t('vaultSync.result.trashed', { count: report.trashed.length }));
	}
	if (report.conflicts.length > 0) {
		parts.push(t('vaultSync.result.conflicts', { count: report.conflicts.length }));
	}

	return parts.length === 0 ? t('vaultSync.result.upToDate') : parts.join(' · ');
}
