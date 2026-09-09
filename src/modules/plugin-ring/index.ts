import { Notice, Platform, Setting, TFile } from 'obsidian';
import { PluginApi } from '../../core/obsidian-internals';
import { ToolboxModule } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type { ModuleDescriptor } from '../../core/module';
import type ToolboxPlugin from '../../main';
import { t } from '../../i18n';
import { applyPlans } from './apply';
import type { ApplyResult } from './apply';
import { formatRingCode, generateRingSecret, parseRingCode } from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { deriveRingId, openSnapshot, RingDecryptionError, sealSnapshot } from '@toolbox/protocol';
import { computeDiff, planApply } from './diff';
import { JoinRingModal, RingDiffModal, ShowCodeModal } from './modals';
import { RingFile } from './ring-file';
import { collectLocalPlugins, buildSnapshot } from './snapshot';
import { isRingSnapshot } from './types';
import type { DiffItem, RingSnapshot } from './types';

/**
 * Keeps the plugins of several devices in step.
 *
 * All devices open the same synced vault, so the ring needs no server: the host
 * writes an encrypted snapshot to an ordinary vault file and the other devices
 * read it. An ordinary file is the point — config folders do not reach mobile in
 * this setup, ordinary files do.
 *
 * Applying a snapshot means running code from elsewhere, which is a pattern that
 * has been attacked in the wild (PHANTOMPULSE, April 2026, where a shared vault
 * was used to pull in plugins that then executed shell commands). Hence: joining
 * takes the code, snapshots are authenticated by being AES-GCM encrypted with it,
 * and nothing is ever applied without the diff being shown first.
 */

type PluginRingSettings = {
	/** The printable ring code. Null when this device is not in a ring. */
	code: string | null;
	role: 'host' | 'client' | null;
	deviceId: string;
	deviceName: string;
	/** Device id of the host we trust; a change is worth warning about. */
	hostId: string | null;
	ringFilePath: string;
	/** Last sequence this host published — its half of the concurrency check. */
	lastPublishedSeq: number;
	/** Last sequence fully applied here. Only advances when nothing failed. */
	lastAppliedSeq: number;
	/** Plugins whose settings the host keeps to itself. */
	excludedIds: string[];
	/** Plugins this device never touches. */
	ignoredIds: string[];
};

const DEFAULT_SETTINGS: PluginRingSettings = {
	code: null,
	role: null,
	deviceId: '',
	deviceName: '',
	hostId: null,
	ringFilePath: 'Toolbox/plugin-ring.json',
	lastPublishedSeq: 0,
	lastAppliedSeq: 0,
	excludedIds: [],
	ignoredIds: [],
};

function parseIdList(value: string): string[] {
	return value
		.split(/[\s,]+/)
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}

class PluginRingModule extends ToolboxModule<PluginRingSettings> {
	private api?: PluginApi;

	override onload(): void {
		this.api = PluginApi.detect(this.app);
		if (!this.api) {
			// Without the internal plugin manager there is nothing this module can
			// do. Say so once and stay inert rather than failing later per command.
			console.error(
				'Toolbox: the plugin ring needs Obsidian internals that are not available here:',
				PluginApi.missing(this.app).join(', ')
			);
			new Notice(t('ring.unsupported.notice'));
			return;
		}

		void this.ensureDeviceIdentity();

		this.addCommand({
			id: 'ring-create',
			name: t('ring.command.create'),
			callback: () => void this.createRing(),
		});
		this.addCommand({
			id: 'ring-join',
			name: t('ring.command.join'),
			callback: () => this.promptJoin(),
		});
		this.addCommand({
			id: 'ring-show-code',
			name: t('ring.command.showCode'),
			callback: () => this.showCode(),
		});
		this.addCommand({
			id: 'ring-publish',
			name: t('ring.command.publish'),
			callback: () => void this.publish(),
		});
		this.addCommand({
			id: 'ring-check',
			name: t('ring.command.check'),
			callback: () => void this.check(),
		});
		this.addCommand({
			id: 'ring-leave',
			name: t('ring.command.leave'),
			callback: () => void this.leave(),
		});

		// A client learns about a new snapshot the moment sync drops it in.
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (
					file instanceof TFile &&
					file.path === this.ringFile().path &&
					this.settings.role === 'client'
				) {
					void this.notifyIfNewer();
				}
			})
		);

		// The file index is not populated yet during onload, so the scan has to wait
		// for the layout to settle or it would always find nothing.
		this.app.workspace.onLayoutReady(() => this.warnAboutConflictCopies());
	}

	override displayPanel(containerEl: HTMLElement): void {
		if (!this.api) {
			return;
		}

		containerEl.createEl('h3', { text: t('ring.panel.title') });

		const { role } = this.settings;
		containerEl.createEl('p', {
			cls: 'toolbox-panel__state',
			text:
				role === null
					? t('ring.panel.none')
					: role === 'host'
						? t('ring.panel.host', { seq: this.settings.lastPublishedSeq })
						: t('ring.panel.client', { seq: this.settings.lastAppliedSeq }),
		});

		const buttons = containerEl.createDiv({ cls: 'toolbox-panel__buttons' });
		const button = (label: string, onClick: () => void): void => {
			buttons.createEl('button', { text: label }).addEventListener('click', onClick);
		};

		if (role === null) {
			button(t('ring.settings.createRing'), () => void this.createRing());
			button(t('ring.settings.joinWithCode'), () => {
				this.promptJoin();
			});
			return;
		}

		button(t('ring.settings.showCode'), () => {
			this.showCode();
		});
		if (role === 'host') {
			button(t('ring.settings.publishNow'), () => void this.publish());
		} else {
			button(t('ring.settings.checkNow'), () => void this.check());
		}
	}

	override displaySettings(containerEl: HTMLElement): void {
		if (!this.api) {
			containerEl.createEl('p', {
				cls: 'toolbox-ring__warning',
				text: t('ring.unsupported.settings'),
			});
			return;
		}

		const { role, code } = this.settings;
		new Setting(containerEl)
			.setName(t('ring.settings.status'))
			.setDesc(
				role === null
					? t('ring.settings.statusNone')
					: role === 'host'
						? t('ring.settings.statusHost', { seq: this.settings.lastPublishedSeq })
						: t('ring.settings.statusClient', { seq: this.settings.lastAppliedSeq })
			);

		if (role === null) {
			new Setting(containerEl)
				.setName(t('ring.settings.startOrJoin'))
				.addButton((button) =>
					button
						.setButtonText(t('ring.settings.createRing'))
						.setCta()
						.onClick(() => void this.createRing())
				)
				.addButton((button) =>
					button
						.setButtonText(t('ring.settings.joinWithCode'))
						.onClick(() => this.promptJoin())
				);
		} else {
			new Setting(containerEl)
				.setName(t('ring.settings.ring'))
				.addButton((button) =>
					button.setButtonText(t('ring.settings.showCode')).onClick(() => this.showCode())
				)
				.addButton((button) =>
					role === 'host'
						? button
								.setButtonText(t('ring.settings.publishNow'))
								.setCta()
								.onClick(() => void this.publish())
						: button
								.setButtonText(t('ring.settings.checkNow'))
								.setCta()
								.onClick(() => void this.check())
				)
				// No destructive styling: setDestructive() needs Obsidian 1.13, and
				// leaving a ring changes nothing that is installed anyway.
				.addButton((button) =>
					button.setButtonText(t('ring.settings.leave')).onClick(() => void this.leave())
				);
		}

		new Setting(containerEl)
			.setName(t('ring.settings.device'))
			.setDesc(t('ring.settings.deviceDesc'))
			.addText((text) =>
				text.setValue(this.settings.deviceName).onChange(async (value) => {
					await this.patchSettings({ deviceName: value });
				})
			);

		const advanced = advancedSection(containerEl);

		new Setting(advanced)
			.setName(t('ring.settings.file'))
			.setDesc(t('ring.settings.fileDesc'))
			.addText((text) =>
				text.setValue(this.settings.ringFilePath).onChange(async (value) => {
					await this.patchSettings({
						ringFilePath: value.trim() || DEFAULT_SETTINGS.ringFilePath,
					});
				})
			);

		new Setting(advanced)
			.setName(t('ring.settings.excluded'))
			.setDesc(t('ring.settings.excludedDesc'))
			.addTextArea((text) =>
				text.setValue(this.settings.excludedIds.join(' ')).onChange(async (value) => {
					await this.patchSettings({ excludedIds: parseIdList(value) });
				})
			);

		new Setting(advanced)
			.setName(t('ring.settings.ignored'))
			.setDesc(t('ring.settings.ignoredDesc'))
			.addTextArea((text) =>
				text.setValue(this.settings.ignoredIds.join(' ')).onChange(async (value) => {
					await this.patchSettings({ ignoredIds: parseIdList(value) });
				})
			);

		if (code) {
			containerEl.createEl('p', {
				cls: 'toolbox-ring__hint',
				text: t('ring.settings.codeWarning'),
			});
		}
	}

	// --- ring lifecycle -----------------------------------------------------

	private async createRing(): Promise<void> {
		if (this.settings.role !== null) {
			new Notice(t('ring.notice.alreadyInRing'));
			return;
		}

		const code = formatRingCode(generateRingSecret());
		await this.patchSettings({
			code,
			role: 'host',
			hostId: this.settings.deviceId,
			lastPublishedSeq: 0,
			lastAppliedSeq: 0,
		});

		await this.publish();
		this.refreshPanel();
		new ShowCodeModal(this.app, code).open();
	}

	private promptJoin(): void {
		new JoinRingModal(this.app, (code) => this.join(code)).open();
	}

	private async join(rawCode: string): Promise<void> {
		let secret: Bytes;
		try {
			secret = parseRingCode(rawCode);
		} catch {
			new Notice(t('ring.notice.invalidCode'));
			return;
		}

		const state = await this.ringFile().read();
		if (state.status !== 'ok') {
			new Notice(state.status === 'absent' ? t('ring.notice.noRingFileYet') : state.message);
			return;
		}

		if ((await deriveRingId(secret)) !== state.envelope.ring) {
			new Notice(t('ring.notice.codeMismatch'));
			return;
		}

		const snapshot = await this.decrypt(secret, state.envelope);
		if (!snapshot) {
			return;
		}

		await this.patchSettings({
			code: formatRingCode(secret),
			role: 'client',
			hostId: snapshot.host.id,
			lastAppliedSeq: 0,
		});

		new Notice(t('ring.notice.joined', { host: snapshot.host.name }));
		await this.check();
	}

	private async leave(): Promise<void> {
		await this.patchSettings({
			code: null,
			role: null,
			hostId: null,
			lastAppliedSeq: 0,
			lastPublishedSeq: 0,
		});
		new Notice(t('ring.notice.left'));
	}

	private showCode(): void {
		if (!this.settings.code) {
			new Notice(t('ring.notice.notInRing'));
			return;
		}
		new ShowCodeModal(this.app, this.settings.code).open();
	}

	// --- host ---------------------------------------------------------------

	private async publish(): Promise<void> {
		const secret = this.secret();
		if (!secret || !this.api) {
			new Notice(t('ring.notice.notInRing'));
			return;
		}
		if (this.settings.role !== 'host') {
			new Notice(t('ring.notice.notHost'));
			return;
		}

		const file = this.ringFile();
		const state = await file.read();

		if (state.status === 'unreadable') {
			new Notice(t('ring.notice.retryLater', { message: state.message }));
			return;
		}

		if (state.status === 'ok') {
			const current = await this.decrypt(secret, state.envelope);
			if (!current) {
				return;
			}
			// Optimistic concurrency: if the file moved on since we last wrote it,
			// another device has been publishing. Stop rather than overwrite it.
			if (current.seq !== this.settings.lastPublishedSeq) {
				new Notice(t('ring.notice.raced', { host: current.host.name }));
				return;
			}
		}

		const seq = this.settings.lastPublishedSeq + 1;
		const snapshot = await buildSnapshot(this.app, this.api, {
			selfId: this.plugin.manifest.id,
			excludedIds: this.settings.excludedIds,
			host: { id: this.settings.deviceId, name: this.deviceName() },
			seq,
		});

		await file.write(await sealSnapshot(secret, snapshot));
		await this.patchSettings({ lastPublishedSeq: seq });
		this.refreshPanel();
		new Notice(t('ring.notice.published', { count: snapshot.plugins.length }));
	}

	// --- client -------------------------------------------------------------

	private async notifyIfNewer(): Promise<void> {
		const snapshot = await this.loadSnapshot({ quiet: true });
		if (snapshot && snapshot.seq > this.settings.lastAppliedSeq) {
			new Notice(t('ring.notice.hasChanges'));
		}
	}

	private async check(): Promise<void> {
		const snapshot = await this.loadSnapshot({ quiet: false });
		if (!snapshot || !this.api) {
			return;
		}

		const local = await collectLocalPlugins(this.app, this.api, this.plugin.manifest.id);
		const items = computeDiff(local, snapshot, {
			selfId: this.plugin.manifest.id,
			isMobile: Platform.isMobile,
			ignoredIds: this.settings.ignoredIds,
		});

		new RingDiffModal(
			this.app,
			items,
			{
				hostName: snapshot.host.name,
				hostChanged:
					this.settings.hostId !== null && this.settings.hostId !== snapshot.host.id,
			},
			() => this.apply(items, snapshot)
		).open();
	}

	private async apply(items: readonly DiffItem[], snapshot: RingSnapshot): Promise<ApplyResult> {
		if (!this.api) {
			return { applied: [], failed: [], complete: false };
		}

		const selfId = this.plugin.manifest.id;
		const plans = planApply(items, snapshot, { selfId });
		const result = await applyPlans(this.app, this.api, plans, selfId);

		// Only a clean run counts as caught up. Recording it otherwise would hide
		// the remaining differences behind an empty diff.
		if (result.complete) {
			await this.patchSettings({ lastAppliedSeq: snapshot.seq, hostId: snapshot.host.id });
		}
		return result;
	}

	// --- helpers ------------------------------------------------------------

	private async loadSnapshot(options: { quiet: boolean }): Promise<RingSnapshot | undefined> {
		const secret = this.secret();
		if (!secret) {
			if (!options.quiet) {
				new Notice(t('ring.notice.notInRing'));
			}
			return undefined;
		}

		const state = await this.ringFile().read();
		if (state.status !== 'ok') {
			if (!options.quiet) {
				new Notice(state.status === 'absent' ? t('ring.notice.noRingFile') : state.message);
			}
			return undefined;
		}

		return this.decrypt(secret, state.envelope, options.quiet);
	}

	private async decrypt(
		secret: Bytes,
		envelope: Parameters<typeof openSnapshot>[1],
		quiet = false
	): Promise<RingSnapshot | undefined> {
		try {
			const snapshot = await openSnapshot(secret, envelope);
			if (!isRingSnapshot(snapshot)) {
				if (!quiet) {
					new Notice(t('ring.notice.unknownFormat'));
				}
				return undefined;
			}
			return snapshot;
		} catch (error) {
			if (!quiet) {
				new Notice(
					error instanceof RingDecryptionError
						? t('ring.notice.wrongRing')
						: t('ring.notice.unreadable')
				);
			}
			return undefined;
		}
	}

	private secret(): Bytes | undefined {
		if (!this.settings.code) {
			return undefined;
		}
		try {
			return parseRingCode(this.settings.code);
		} catch {
			return undefined;
		}
	}

	private ringFile(): RingFile {
		return new RingFile(this.app, this.settings.ringFilePath || DEFAULT_SETTINGS.ringFilePath);
	}

	private deviceName(): string {
		return (
			this.settings.deviceName.trim() ||
			(Platform.isMobile ? t('ring.device.mobile') : t('ring.device.desktop'))
		);
	}

	private async ensureDeviceIdentity(): Promise<void> {
		if (!this.settings.deviceId) {
			await this.patchSettings({ deviceId: crypto.randomUUID() });
		}
	}

	private warnAboutConflictCopies(): void {
		if (this.settings.role === null) {
			return;
		}
		const copies = this.ringFile().findConflictCopies();
		if (copies.length > 0) {
			new Notice(t('ring.notice.conflictCopies', { count: copies.length }));
		}
	}
}

export const pluginRingModule: ModuleDescriptor<PluginRingSettings> = {
	id: 'plugin-ring',
	// Getters, because the descriptor is built at import time while the locale is
	// only chosen once the plugin loads.
	get name() {
		return t('ring.name');
	},
	get description() {
		return t('ring.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new PluginRingModule(plugin, pluginRingModule),
};
