import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n';
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
		this.contentEl.addClass('toolbox-modal');
		this.setTitle(t('ring.join.title'));
		this.contentEl.createEl('p', { cls: 'toolbox-ring__hint', text: t('ring.join.hint') });

		new Setting(this.contentEl).setName(t('ring.join.label')).addText((text) =>
			text.setPlaceholder(t('ring.join.placeholder')).onChange((value) => {
				this.code = value;
			})
		);

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText(t('ring.join.submit'))
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
	/** Whether the code on screen is the one carrying the server address. */
	private withAddress = true;

	constructor(
		app: App,
		private readonly codes: { ringCode: string; joinCode: string }
	) {
		super(app);
	}

	private get shown(): string {
		return this.withAddress ? this.codes.joinCode : this.codes.ringCode;
	}

	override onOpen(): void {
		this.contentEl.addClass('toolbox-modal');
		this.setTitle(t('ring.code.title'));
		this.render();
	}

	private render(): void {
		const carries = this.codes.joinCode !== this.codes.ringCode;
		this.contentEl.empty();

		this.contentEl.createEl('p', {
			cls: 'toolbox-ring__hint',
			text: carries && this.withAddress ? t('ring.code.hintWithServer') : t('ring.code.hint'),
		});
		this.contentEl.createDiv({ cls: 'toolbox-ring__code', text: this.shown });

		// Only offered when there is something to leave out. The short code is for
		// the case where the other device reaches the server somewhere else — over a
		// VPN, or by a name this network does not resolve.
		if (carries) {
			new Setting(this.contentEl)
				.setName(t('ring.code.includeServer'))
				.setDesc(t('ring.code.includeServerDesc'))
				.addToggle((toggle) =>
					toggle.setValue(this.withAddress).onChange((value) => {
						this.withAddress = value;
						this.render();
					})
				);
		}

		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText(t('common.copy'))
				.setCta()
				.onClick(() => {
					void navigator.clipboard.writeText(this.shown).then(
						() => new Notice(t('ring.notice.codeCopied')),
						() => new Notice(t('ring.notice.codeCopyFailed'))
					);
				})
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Asks whether a ring file this device cannot use may be moved aside.
 *
 * It exists because the alternative is a host that can never publish again: a
 * leftover file from an earlier ring does not decrypt, and a publish that stops
 * at that has no way forward. The answer defaults to no, and the file is trashed
 * rather than overwritten — it is another ring's only copy of itself.
 */
export class RingFileConflictModal extends Modal {
	private replace = false;

	private constructor(
		app: App,
		private readonly context: { path: string; kind: 'foreign' | 'corrupt' },
		private readonly done: (replace: boolean) => void
	) {
		super(app);
	}

	static ask(app: App, context: { path: string; kind: 'foreign' | 'corrupt' }): Promise<boolean> {
		return new Promise((resolve) => {
			new RingFileConflictModal(app, context, resolve).open();
		});
	}

	override onOpen(): void {
		this.contentEl.addClass('toolbox-modal');
		this.setTitle(t('ring.conflict.title'));

		this.contentEl.createEl('p', {
			text:
				this.context.kind === 'foreign'
					? t('ring.conflict.foreign', { path: this.context.path })
					: t('ring.conflict.corrupt', { path: this.context.path }),
		});
		this.contentEl.createEl('p', {
			cls: 'toolbox-ring__hint',
			text: t('ring.conflict.trashHint'),
		});

		// The safe answer is the one under the cursor. Replacing is a plain button
		// marked as a warning, because it moves a file this device cannot read.
		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText(t('ring.conflict.keep'))
					.setCta()
					.onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText(t('ring.conflict.replace'))
					.onClick(() => {
						this.replace = true;
						this.close();
					})
					.buttonEl.addClass('mod-warning')
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		this.done(this.replace);
	}
}

const KIND_KEY: Record<DiffItem['kind'], TranslationKey> = {
	missing: 'ring.kind.missing',
	enable: 'ring.kind.enable',
	disable: 'ring.kind.disable',
	version: 'ring.kind.version',
	settings: 'ring.kind.settings',
	extra: 'ring.kind.extra',
};

const REASON_KEY: Record<NonNullable<DiffItem['reason']>, TranslationKey> = {
	desktopOnly: 'ring.reason.desktopOnly',
	notInstalled: 'ring.reason.notInstalled',
	cannotInstall: 'ring.reason.cannotInstall',
	noUpdate: 'ring.reason.noUpdate',
	hostLacks: 'ring.reason.hostLacks',
};

/** Turns an apply run into the sentence shown afterwards. */
export function describeResult(result: ApplyResult): string {
	const total = result.applied.length + result.failed.length;
	const installed =
		result.installed.length > 0
			? ` ${t('ring.result.installed', { count: result.installed.length })}`
			: '';

	if (result.complete) {
		return (
			(total === 1
				? t('ring.result.appliedOne')
				: t('ring.result.appliedMany', { count: total })) + installed
		);
	}

	return t('ring.result.partial', {
		applied: result.applied.length,
		total,
		names: result.failed.map((failure) => failure.plan.name).join(', '),
	});
}

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

		this.contentEl.addClass('toolbox-modal');
		this.setTitle(t('ring.diff.title', { host: this.context.hostName }));

		if (this.context.hostChanged) {
			this.contentEl.createEl('p', {
				cls: 'toolbox-ring__warning',
				text: t('ring.diff.hostChanged'),
			});
		}

		if (this.items.length === 0) {
			this.contentEl.createEl('p', { text: t('ring.diff.upToDate') });
			return;
		}

		if (actionable.length > 0) {
			this.renderSection(t('ring.diff.willApply'), actionable);
		}
		if (rest.length > 0) {
			this.renderSection(t('ring.diff.leftAlone'), rest);
		}

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText(t('common.cancel')).onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText(this.applyLabel(actionable.length))
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

	private applyLabel(count: number): string {
		if (count === 0) {
			return t('ring.diff.nothingToApply');
		}
		return count === 1 ? t('ring.diff.applyOne') : t('ring.diff.applyMany', { count });
	}

	private renderSection(title: string, items: readonly DiffItem[]): void {
		new Setting(this.contentEl).setName(title).setHeading();

		const list = this.contentEl.createEl('ul', { cls: 'toolbox-ring__list' });
		for (const item of items) {
			const row = list.createEl('li', { cls: 'toolbox-ring__row' });
			row.createSpan({ cls: 'toolbox-ring__name', text: item.name });
			row.createSpan({
				cls: 'toolbox-ring__kind',
				text:
					item.kind === 'missing' && item.actionable
						? t('ring.kind.install')
						: t(KIND_KEY[item.kind]),
			});

			const detail = this.describeVersions(item);
			if (detail) {
				row.createSpan({ cls: 'toolbox-ring__detail', text: detail });
			}
			if (item.reason) {
				row.createSpan({ cls: 'toolbox-ring__reason', text: t(REASON_KEY[item.reason]) });
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
