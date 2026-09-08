import { Modal, Notice, Setting } from 'obsidian';
import type { App, TFile } from 'obsidian';
import { t } from '../../i18n';
import type { DoubleSyncFinding } from './double-sync';
import type { DeviceHealth } from './health';
import type { Conflict, CopyConflict, MarkerConflict } from './scanner';

function describeDevice(device: DeviceHealth): string {
	if (device.status === 'unknown' || device.ageHours === undefined) {
		return t('sync.device.unknown');
	}
	if (device.ageHours < 1) {
		return t('sync.device.justNow');
	}
	if (device.ageHours < 48) {
		return t('sync.device.hours', { hours: device.ageHours });
	}
	return t('sync.device.days', { days: Math.floor(device.ageHours / 24) });
}

/**
 * Side-by-side view of a conflicting copy and the file it came from, with the two
 * ways out.
 *
 * Nothing is ever resolved without this step. The user has already lost content to
 * a sync tool making decisions for them, so the module only acts on a file after
 * showing what is in it — and what it removes goes to the trash, never away.
 */
class CompareModal extends Modal {
	constructor(
		app: App,
		private readonly conflict: CopyConflict,
		private readonly onResolved: () => void
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(t('sync.compare.title', { name: this.conflict.originalPath }));
		void this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private async render(): Promise<void> {
		const { original, file } = this.conflict;
		const copyText = await this.app.vault.cachedRead(file);
		const originalText = original ? await this.app.vault.cachedRead(original) : null;

		this.contentEl.empty();

		if (originalText !== null && originalText === copyText) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-sync__note',
				text: t('sync.compare.identical'),
			});
		}

		const columns = this.contentEl.createDiv({ cls: 'toolbox-sync__compare' });
		this.renderColumn(columns, t('sync.compare.original'), originalText);
		this.renderColumn(columns, t('sync.compare.copy'), copyText);

		this.contentEl.createEl('p', { cls: 'toolbox-sync__note', text: t('sync.compare.hint') });

		const actions = new Setting(this.contentEl).addButton((button) =>
			button.setButtonText(t('sync.compare.openBoth')).onClick(() => {
				this.close();
				void this.openBoth();
			})
		);

		if (original) {
			actions.addButton((button) =>
				button
					.setButtonText(t('sync.compare.keepOriginal'))
					.setCta()
					.onClick(() => void this.resolve(file))
			);
			actions.addButton((button) =>
				button.setButtonText(t('sync.compare.keepCopy')).onClick(() => void this.keepCopy())
			);
		}
	}

	private renderColumn(parent: HTMLElement, title: string, text: string | null): void {
		const column = parent.createDiv({ cls: 'toolbox-sync__column' });
		column.createEl('h4', { text: title });

		if (text === null) {
			column.createEl('p', {
				cls: 'toolbox-sync__note',
				text: t('sync.report.originalMissing'),
			});
			return;
		}
		column.createEl('pre', { cls: 'toolbox-sync__text' }).createEl('code', { text });
	}

	/** Keeping the copy means it takes the original's place, so nothing is lost. */
	private async keepCopy(): Promise<void> {
		const { original, file, originalPath } = this.conflict;
		if (!original) {
			return;
		}

		try {
			await this.app.fileManager.trashFile(original);
			await this.app.fileManager.renameFile(file, originalPath);
			new Notice(t('sync.notice.trashed', { name: original.name }));
			this.close();
			this.onResolved();
		} catch (error) {
			new Notice(
				t('sync.notice.trashFailed', {
					name: original.name,
					error: error instanceof Error ? error.message : String(error),
				})
			);
		}
	}

	private async resolve(discard: TFile): Promise<void> {
		try {
			// trashFile honours the user's trash setting, so this stays undoable.
			await this.app.fileManager.trashFile(discard);
			new Notice(t('sync.notice.trashed', { name: discard.name }));
			this.close();
			this.onResolved();
		} catch (error) {
			new Notice(
				t('sync.notice.trashFailed', {
					name: discard.name,
					error: error instanceof Error ? error.message : String(error),
				})
			);
		}
	}

	private async openBoth(): Promise<void> {
		if (this.conflict.original) {
			await this.app.workspace.getLeaf(false).openFile(this.conflict.original);
		}
		await this.app.workspace.getLeaf('split').openFile(this.conflict.file);
	}
}

export class SyncReportModal extends Modal {
	constructor(
		app: App,
		private readonly conflicts: readonly Conflict[],
		private readonly devices: readonly DeviceHealth[],
		private readonly options: {
			deepScanned: boolean;
			doubleSync?: DoubleSyncFinding;
			onRescan: () => Promise<void>;
		}
	) {
		super(app);
	}

	override onOpen(): void {
		this.setTitle(t('sync.report.title'));
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		this.contentEl.empty();

		// The double-sync warning goes first: while it applies, every conflict below
		// is a symptom of it rather than an isolated accident.
		if (this.options.doubleSync) {
			this.renderDoubleSync(this.options.doubleSync);
		}

		const copies = this.conflicts.filter((c): c is CopyConflict => c.kind === 'copy');
		const markers = this.conflicts.filter((c): c is MarkerConflict => c.kind === 'markers');

		if (this.conflicts.length === 0) {
			this.contentEl.createEl('p', { text: t('sync.report.clean') });
		}

		if (copies.length > 0) {
			new Setting(this.contentEl).setName(t('sync.report.copies')).setHeading();
			const list = this.contentEl.createEl('ul', { cls: 'toolbox-sync__list' });
			for (const conflict of copies) {
				this.renderCopy(list, conflict);
			}
		}

		if (markers.length > 0) {
			new Setting(this.contentEl).setName(t('sync.report.markers')).setHeading();
			const list = this.contentEl.createEl('ul', { cls: 'toolbox-sync__list' });
			for (const conflict of markers) {
				this.renderMarker(list, conflict);
			}
		}

		if (!this.options.deepScanned) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-sync__note',
				text: t('sync.report.deepHint'),
			});
		}

		this.renderDevices();
	}

	private renderDoubleSync(finding: DoubleSyncFinding): void {
		const box = this.contentEl.createDiv({ cls: 'toolbox-sync__alert' });
		box.createEl('h3', { text: t('sync.double.title') });
		box.createEl('p', {
			text: t('sync.double.body', {
				tool: finding.tool,
				plugins: finding.plugins.join(', '),
			}),
		});
		box.createEl('p', { text: t('sync.double.advice') });
		box.createEl('p', {
			cls: 'toolbox-sync__meta',
			text: t('sync.double.folder', { folder: finding.folder }),
		});
	}

	private renderCopy(list: HTMLElement, conflict: CopyConflict): void {
		const row = list.createEl('li', { cls: 'toolbox-sync__row' });
		row.createSpan({ cls: 'toolbox-sync__name', text: conflict.file.path });
		row.createSpan({
			cls: 'toolbox-sync__meta',
			text: `${conflict.source} · ${conflict.detail}`,
		});

		if (!conflict.original) {
			row.createSpan({ cls: 'toolbox-sync__warn', text: t('sync.report.originalMissing') });
		}

		const actions = row.createDiv({ cls: 'toolbox-sync__actions' });
		actions
			.createEl('button', { text: t('sync.report.compare') })
			.addEventListener('click', () => {
				new CompareModal(this.app, conflict, () => {
					void this.options.onRescan();
				}).open();
			});
		actions
			.createEl('button', { text: t('sync.report.open') })
			.addEventListener('click', () => {
				void this.app.workspace.getLeaf(false).openFile(conflict.file);
			});
	}

	private renderMarker(list: HTMLElement, conflict: MarkerConflict): void {
		const first = conflict.markers[0];
		const row = list.createEl('li', { cls: 'toolbox-sync__row' });

		row.createSpan({ cls: 'toolbox-sync__name', text: conflict.file.path });
		row.createSpan({
			cls: 'toolbox-sync__meta',
			text:
				conflict.markers.length === 1
					? t('sync.report.markerOne')
					: t('sync.report.markerMany', { count: conflict.markers.length }),
		});

		const actions = row.createDiv({ cls: 'toolbox-sync__actions' });
		actions
			.createEl('button', { text: t('sync.report.open') })
			.addEventListener('click', () => {
				// Merging is the user's call — this only takes them to the first block.
				void this.app.workspace.getLeaf(false).openFile(conflict.file, {
					eState: first ? { line: first.line - 1 } : undefined,
				});
			});
	}

	private renderDevices(): void {
		new Setting(this.contentEl).setName(t('sync.report.devices')).setHeading();

		if (this.devices.length === 0) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-sync__note',
				text: t('sync.report.noDevices'),
			});
			return;
		}

		const list = this.contentEl.createEl('ul', { cls: 'toolbox-sync__list' });
		for (const device of this.devices) {
			const row = list.createEl('li', { cls: 'toolbox-sync__row' });
			row.createSpan({ cls: 'toolbox-sync__name', text: device.deviceName });
			row.createSpan({
				cls: device.status === 'fresh' ? 'toolbox-sync__meta' : 'toolbox-sync__warn',
				text: device.isSelf ? t('sync.device.self') : describeDevice(device),
			});
		}
	}
}
