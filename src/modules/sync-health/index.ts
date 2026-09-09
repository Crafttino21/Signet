import { Notice, Platform, Setting } from 'obsidian';
import { ToolboxModule } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type { ModuleDescriptor } from '../../core/module';
import type ToolboxPlugin from '../../main';
import { t } from '../../i18n';
import { detectDoubleSync } from './double-sync';
import type { DoubleSyncFinding } from './double-sync';
import { devicesNeedingAttention, evaluateHeartbeats } from './health';
import type { DeviceHealth } from './health';
import { HeartbeatStore } from './heartbeat';
import { SyncReportModal } from './report-modal';
import { scanConflicts } from './scanner';
import type { Conflict } from './scanner';

/**
 * Watches the sync the user already has, rather than replacing it.
 *
 * The three things that go wrong with vault sync are invisible from inside
 * Obsidian: conflicting copies pile up in folders nobody opens, notes get conflict
 * markers written into them and still look normal in the file tree, and a device
 * quietly stops syncing without anything saying so.
 *
 * This module surfaces all three and never writes to a note on its own. Resolving
 * a conflict moves the losing file to the trash, so every action stays undoable —
 * which matters, because the sync problems it reports have already cost this user
 * content once.
 */

type SyncHealthSettings = {
	checkOnStart: boolean;
	/** Hours without a heartbeat before a device counts as stale. 0 disables it. */
	staleAfterHours: number;
	heartbeatFolder: string;
	excludedFolders: string[];
	doubleSyncCheck: boolean;
	/** Own identity, used when the plugin ring has not established one. */
	deviceId: string;
	deviceName: string;
};

const DEFAULT_SETTINGS: SyncHealthSettings = {
	checkOnStart: true,
	staleAfterHours: 48,
	heartbeatFolder: 'Toolbox/health',
	excludedFolders: [],
	doubleSyncCheck: true,
	deviceId: '',
	deviceName: '',
};

const HEARTBEAT_INTERVAL_MINUTES = 30;
const RING_MODULE_ID = 'plugin-ring';

interface RingIdentity {
	deviceId?: unknown;
	deviceName?: unknown;
}

class SyncHealthModule extends ToolboxModule<SyncHealthSettings> {
	/** Result of the last scan, so the panel can show it without rescanning. */
	private lastCount: number | undefined;

	override onload(): void {
		void this.beat();

		this.addRibbonIcon('refresh-ccw-dot', t('sync.ribbon'), () => void this.openReport(false));

		this.addCommand({
			id: 'report',
			name: t('sync.command.report'),
			callback: () => void this.openReport(false),
		});
		this.addCommand({
			id: 'deep-scan',
			name: t('sync.command.deepScan'),
			callback: () => void this.openReport(true),
		});

		this.registerInterval(
			window.setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MINUTES * 60 * 1000)
		);

		// The vault index is not ready during onload, so anything that walks files
		// waits for the layout.
		this.app.workspace.onLayoutReady(() => void this.startupCheck());
	}

	override displayPanel(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: t('sync.panel.title') });

		const clean = this.lastCount === 0;
		containerEl.createEl('p', {
			cls: clean ? 'toolbox-panel__state' : 'toolbox-panel__state toolbox-panel__state--warn',
			text:
				this.lastCount === undefined
					? t('sync.panel.unchecked')
					: clean
						? t('sync.panel.clean')
						: t('sync.panel.conflicts', { count: this.lastCount }),
		});

		const buttons = containerEl.createDiv({ cls: 'toolbox-panel__buttons' });
		buttons
			.createEl('button', { text: t('sync.panel.check') })
			.addEventListener('click', () => {
				void this.refreshCount();
			});
		buttons
			.createEl('button', { text: t('sync.panel.report') })
			.addEventListener('click', () => {
				void this.openReport(false);
			});
	}

	/** Rescans for the panel, without opening anything. */
	private async refreshCount(): Promise<void> {
		this.lastCount = (await this.scan(false)).length;
		this.refreshPanel();
	}

	override displaySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('sync.settings.checkOnStart'))
			.setDesc(t('sync.settings.checkOnStartDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.checkOnStart).onChange(async (value) => {
					await this.patchSettings({ checkOnStart: value });
				})
			);

		const advanced = advancedSection(containerEl);

		new Setting(advanced)
			.setName(t('sync.settings.staleAfter'))
			.setDesc(t('sync.settings.staleAfterDesc'))
			.addText((text) =>
				text.setValue(String(this.settings.staleAfterHours)).onChange(async (value) => {
					const hours = Number.parseInt(value, 10);
					await this.patchSettings({
						staleAfterHours: Number.isFinite(hours) && hours >= 0 ? hours : 0,
					});
				})
			);

		new Setting(advanced)
			.setName(t('sync.settings.heartbeatFolder'))
			.setDesc(t('sync.settings.heartbeatFolderDesc'))
			.addText((text) =>
				text.setValue(this.settings.heartbeatFolder).onChange(async (value) => {
					await this.patchSettings({
						heartbeatFolder: value.trim() || DEFAULT_SETTINGS.heartbeatFolder,
					});
				})
			);

		new Setting(advanced)
			.setName(t('sync.settings.excluded'))
			.setDesc(t('sync.settings.excludedDesc'))
			.addTextArea((text) =>
				text.setValue(this.settings.excludedFolders.join('\n')).onChange(async (value) => {
					await this.patchSettings({
						excludedFolders: value
							.split('\n')
							.map((line) => line.trim().replace(/\/+$/, ''))
							.filter((line) => line.length > 0),
					});
				})
			);

		if (Platform.isDesktopApp) {
			new Setting(advanced)
				.setName(t('sync.settings.doubleSyncCheck'))
				.setDesc(t('sync.settings.doubleSyncCheckDesc'))
				.addToggle((toggle) =>
					toggle.setValue(this.settings.doubleSyncCheck).onChange(async (value) => {
						await this.patchSettings({ doubleSyncCheck: value });
					})
				);
		}
	}

	// --- checks -------------------------------------------------------------

	private async startupCheck(): Promise<void> {
		const doubleSync = this.doubleSync();
		if (doubleSync) {
			// Worth saying even when nothing is conflicting yet: it is the cause,
			// and conflicts are only a matter of time.
			new Notice(t('sync.notice.doubleSync'), 10000);
		}

		if (!this.settings.checkOnStart) {
			return;
		}

		const conflicts = await this.scan(false);
		this.lastCount = conflicts.length;
		this.refreshPanel();
		if (conflicts.length === 1) {
			new Notice(t('sync.notice.foundOne'));
		} else if (conflicts.length > 1) {
			new Notice(t('sync.notice.foundMany', { count: conflicts.length }));
		}

		const stale = devicesNeedingAttention(await this.deviceHealth());
		for (const device of stale) {
			new Notice(
				`${device.deviceName}: ${t('sync.device.days', { days: Math.floor((device.ageHours ?? 0) / 24) })}`
			);
		}
	}

	private async openReport(deep: boolean): Promise<void> {
		if (deep) {
			new Notice(t('sync.notice.scanning'));
		}

		const conflicts = await this.scan(deep);
		this.lastCount = conflicts.length;
		const devices = await this.deviceHealth();

		if (conflicts.length === 0 && !deep) {
			new Notice(t('sync.notice.clean'));
		}

		new SyncReportModal(this.app, conflicts, devices, {
			deepScanned: deep,
			doubleSync: this.doubleSync(),
			onRescan: () => this.openReport(deep),
		}).open();
	}

	private scan(deep: boolean): Promise<Conflict[]> {
		return scanConflicts(this.app, this.excluded(), { deep });
	}

	private doubleSync(): DoubleSyncFinding | undefined {
		return this.settings.doubleSyncCheck ? detectDoubleSync(this.app) : undefined;
	}

	// --- heartbeats ---------------------------------------------------------

	private async beat(): Promise<void> {
		const identity = await this.identity();
		try {
			await this.store().write({
				deviceId: identity.id,
				deviceName: identity.name,
				updatedAt: new Date().toISOString(),
			});
		} catch (error) {
			console.error('Toolbox: could not write the sync heartbeat.', error);
		}
	}

	private async deviceHealth(): Promise<DeviceHealth[]> {
		if (this.settings.staleAfterHours <= 0) {
			return [];
		}

		const identity = await this.identity();
		return evaluateHeartbeats(await this.store().readAll(), {
			now: new Date(),
			staleAfterHours: this.settings.staleAfterHours,
			selfId: identity.id,
		});
	}

	private store(): HeartbeatStore {
		return new HeartbeatStore(
			this.app,
			this.settings.heartbeatFolder || DEFAULT_SETTINGS.heartbeatFolder
		);
	}

	/**
	 * Prefers the identity the plugin ring already established, so a device is one
	 * device across both modules instead of appearing twice.
	 */
	private async identity(): Promise<{ id: string; name: string }> {
		const ring = this.plugin.settings.moduleSettings[RING_MODULE_ID] as
			RingIdentity | undefined;
		const ringId = typeof ring?.deviceId === 'string' ? ring.deviceId : '';
		const ringName = typeof ring?.deviceName === 'string' ? ring.deviceName.trim() : '';

		let id = ringId || this.settings.deviceId;
		if (!id) {
			id = crypto.randomUUID();
			await this.patchSettings({ deviceId: id });
		}

		const name =
			ringName ||
			this.settings.deviceName.trim() ||
			(Platform.isMobile ? t('ring.device.mobile') : t('ring.device.desktop'));

		return { id, name };
	}

	private excluded(): string[] {
		// The heartbeat folder is ours; scanning it would be noise.
		return [...this.settings.excludedFolders, this.settings.heartbeatFolder];
	}
}

export const syncHealthModule: ModuleDescriptor<SyncHealthSettings> = {
	id: 'sync-health',
	get name() {
		return t('sync.name');
	},
	get description() {
		return t('sync.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new SyncHealthModule(plugin, syncHealthModule),
};
