import { Notice, Platform, Setting } from 'obsidian';
import { deriveAuthToken, deriveVaultId, hashAuthToken, parseRingCode } from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { ToolboxModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import type ToolboxPlugin from '../../main';
import { t } from '../../i18n';
import { SyncClient, SyncServerError } from './client';
import { isQuiet, planSync, runSync } from './engine';
import type { SyncDeps } from './engine';
import { LiveSession } from './live';
import { touchesLocalFiles } from './reconcile';
import { SyncStateStore } from './state';
import { describeReport, SyncPlanModal } from './sync-modal';

/**
 * Vault sync against your own server.
 *
 * Everything is encrypted on this device before it leaves, with keys derived from
 * the same ring code the plugin ring already uses — so one code covers both which
 * plugins you have and what your notes say, and the server can read neither.
 *
 * The run itself lives in `engine.ts`. This file is the part the user touches:
 * settings, commands, and the decision about when to ask before changing files.
 */

type VaultSyncSettings = {
	serverUrl: string;
	/** Needed once to create the vault, then cleared — it is not a login. */
	registrationSecret: string;
	registered: boolean;
	excludedFolders: string[];
	/** 0 switches the timer off. Ignored while live sync is on. */
	autoSyncMinutes: number;
	confirmLocalChanges: boolean;
	/** Keeps open devices in step by parking a request on the server. */
	liveSync: boolean;
	/** Catch up as soon as Obsidian is opened or brought back to the front. */
	syncOnStart: boolean;
};

const DEFAULT_SETTINGS: VaultSyncSettings = {
	serverUrl: '',
	registrationSecret: '',
	registered: false,
	excludedFolders: [],
	autoSyncMinutes: 0,
	confirmLocalChanges: true,
	liveSync: false,
	syncOnStart: true,
};

const RING_MODULE_ID = 'plugin-ring';

interface RingSettings {
	code?: unknown;
	deviceId?: unknown;
	deviceName?: unknown;
}

class VaultSyncModule extends ToolboxModule<VaultSyncSettings> {
	private running = false;
	private live?: LiveSession;
	/** The commit this device is known to hold, so the live loop knows what to wait past. */
	private seq = 0;

	override onload(): void {
		this.addRibbonIcon('refresh-cw', t('vaultSync.ribbon'), () => void this.sync());

		this.addCommand({
			id: 'sync-now',
			name: t('vaultSync.command.sync'),
			callback: () => void this.sync(),
		});
		this.addCommand({
			id: 'preview',
			name: t('vaultSync.command.preview'),
			callback: () => void this.preview(),
		});
		this.addCommand({
			id: 'forget-state',
			name: t('vaultSync.command.forget'),
			callback: () => void this.forget(),
		});

		// A timer is the fallback for people who would rather not hold a connection
		// open; live sync makes it redundant.
		if (this.settings.autoSyncMinutes > 0 && !this.settings.liveSync) {
			this.registerInterval(
				window.setInterval(
					() => void this.sync(true),
					this.settings.autoSyncMinutes * 60 * 1000
				)
			);
		}

		this.setUpLive();

		// The vault index is not ready during onload, so the first catch-up waits.
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStart) {
				void this.autoSync();
			}
			this.live?.start();
		});
	}

	/**
	 * Wires the live session to the two things that decide whether this device
	 * should be doing live work: whether the window is on screen, and whether the
	 * vault changed here.
	 */
	private setUpLive(): void {
		if (!this.settings.liveSync) {
			return;
		}

		const live = new LiveSession({
			currentSeq: () => this.seq,
			waitForRemote: async (since, seconds) => {
				const client = await this.client();
				if (!client) {
					throw new Error('Not configured.');
				}
				return (await client.head({ since, seconds })).seq;
			},
			sync: () => this.autoSync(),
			// `document.hidden` covers a minimised window and, more importantly, a
			// backgrounded app on a phone.
			isActive: () => !document.hidden,
			onError: (error) => {
				console.error('Toolbox: live sync paused after an error.', error);
			},
		});

		this.live = live;
		this.register(() => {
			live.stop();
		});

		// Coming back to the front is exactly when a device needs to catch up.
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (document.hidden) {
				live.stop();
				return;
			}
			if (this.settings.syncOnStart) {
				void this.autoSync();
			}
			live.start();
		});

		// Registered one by one because each event carries a different payload, and
		// a union of them does not satisfy the overloads.
		const touched = (): void => {
			live.noteLocalChange();
		};
		this.registerEvent(this.app.vault.on('create', touched));
		this.registerEvent(this.app.vault.on('modify', touched));
		this.registerEvent(this.app.vault.on('delete', touched));
		this.registerEvent(this.app.vault.on('rename', touched));
	}

	/** A sync nobody asked for: never prompts, and stays quiet when nothing happened. */
	private async autoSync(): Promise<void> {
		const deps = await this.deps(true);
		if (!deps) {
			return;
		}
		await this.execute(deps, true);
	}

	override displaySettings(containerEl: HTMLElement): void {
		const ring = this.ring();

		if (!ring) {
			containerEl.createEl('p', {
				cls: 'toolbox-sync__warning',
				text: t('vaultSync.settings.needsRing'),
			});
			return;
		}

		new Setting(containerEl)
			.setName(t('vaultSync.settings.status'))
			.setDesc(
				this.settings.registered
					? t('vaultSync.settings.statusReady')
					: t('vaultSync.settings.statusNotSetUp')
			);

		new Setting(containerEl)
			.setName(t('vaultSync.settings.server'))
			.setDesc(t('vaultSync.settings.serverDesc'))
			.addText((text) =>
				text
					.setPlaceholder('https://sync.example.com')
					.setValue(this.settings.serverUrl)
					.onChange(async (value) => {
						await this.patchSettings({ serverUrl: value.trim() });
					})
			);

		if (!this.settings.registered) {
			new Setting(containerEl)
				.setName(t('vaultSync.settings.registration'))
				.setDesc(t('vaultSync.settings.registrationDesc'))
				.addText((text) =>
					text.setValue(this.settings.registrationSecret).onChange(async (value) => {
						await this.patchSettings({ registrationSecret: value.trim() });
					})
				)
				.addButton((button) =>
					button
						.setButtonText(t('vaultSync.settings.setUp'))
						.setCta()
						.onClick(() => void this.setUp())
				);
		}

		new Setting(containerEl)
			.setName(t('vaultSync.settings.confirm'))
			.setDesc(t('vaultSync.settings.confirmDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.confirmLocalChanges).onChange(async (value) => {
					await this.patchSettings({ confirmLocalChanges: value });
				})
			);

		new Setting(containerEl)
			.setName(t('vaultSync.settings.live'))
			.setDesc(t('vaultSync.settings.liveDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.liveSync).onChange(async (value) => {
					await this.patchSettings({ liveSync: value });
					new Notice(t('vaultSync.notice.restartNeeded'));
				})
			);

		new Setting(containerEl)
			.setName(t('vaultSync.settings.syncOnStart'))
			.setDesc(t('vaultSync.settings.syncOnStartDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.syncOnStart).onChange(async (value) => {
					await this.patchSettings({ syncOnStart: value });
				})
			);

		new Setting(containerEl)
			.setName(t('vaultSync.settings.interval'))
			.setDesc(t('vaultSync.settings.intervalDesc'))
			.addText((text) =>
				text.setValue(String(this.settings.autoSyncMinutes)).onChange(async (value) => {
					const minutes = Number.parseInt(value, 10);
					await this.patchSettings({
						autoSyncMinutes: Number.isFinite(minutes) && minutes >= 0 ? minutes : 0,
					});
				})
			);

		new Setting(containerEl)
			.setName(t('vaultSync.settings.excluded'))
			.setDesc(t('vaultSync.settings.excludedDesc'))
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

		new Setting(containerEl)
			.setName(t('vaultSync.settings.actions'))
			.addButton((button) =>
				button
					.setButtonText(t('vaultSync.settings.test'))
					.onClick(() => void this.testConnection())
			)
			.addButton((button) =>
				button
					.setButtonText(t('vaultSync.command.preview'))
					.onClick(() => void this.preview())
			)
			.addButton((button) =>
				button
					.setButtonText(t('vaultSync.command.sync'))
					.setCta()
					.onClick(() => void this.sync())
			);

		containerEl.createEl('p', {
			cls: 'toolbox-sync__note',
			text: t('vaultSync.settings.codeWarning'),
		});
	}

	// --- actions ------------------------------------------------------------

	private async testConnection(): Promise<void> {
		const client = await this.client();
		if (!client) {
			return;
		}

		try {
			const health = await client.health();
			new Notice(t('vaultSync.notice.reachable', { protocol: health.protocol }));
		} catch (error) {
			new Notice(this.explain(error));
		}
	}

	private async setUp(): Promise<void> {
		const client = await this.client();
		const secret = this.secret();
		if (!client || !secret) {
			return;
		}
		if (!this.settings.registrationSecret) {
			new Notice(t('vaultSync.notice.needsRegistrationSecret'));
			return;
		}

		try {
			const outcome = await client.register(
				this.settings.registrationSecret,
				await hashAuthToken(await deriveAuthToken(secret))
			);
			// The registration secret is a one-off. Keeping it around would leave a
			// server-wide credential sitting in a settings file for no reason.
			await this.patchSettings({ registered: true, registrationSecret: '' });
			new Notice(
				outcome === 'created' ? t('vaultSync.notice.created') : t('vaultSync.notice.joined')
			);
		} catch (error) {
			new Notice(this.explain(error));
		}
	}

	private async preview(): Promise<void> {
		const deps = await this.deps();
		if (!deps) {
			return;
		}

		try {
			const plan = await planSync(deps);
			if (plan.actions.length === 0) {
				new Notice(t('vaultSync.result.upToDate'));
				return;
			}
			new SyncPlanModal(this.app, plan.actions, { firstRun: plan.firstRun }, () => {
				void this.sync();
			}).open();
		} catch (error) {
			new Notice(this.explain(error));
		}
	}

	private async sync(quiet = false): Promise<void> {
		if (this.running) {
			return;
		}

		const deps = await this.deps();
		if (!deps) {
			return;
		}

		this.running = true;
		try {
			if (this.settings.confirmLocalChanges) {
				const plan = await planSync(deps);
				const local = touchesLocalFiles(plan.actions);

				if (local.length > 0) {
					// Uploading needs no permission; changing files on this device does.
					this.running = false;
					new SyncPlanModal(this.app, plan.actions, { firstRun: plan.firstRun }, () => {
						void this.execute(deps);
					}).open();
					return;
				}
			}

			await this.execute(deps, quiet);
		} catch (error) {
			new Notice(this.explain(error));
		} finally {
			this.running = false;
		}
	}

	private async execute(deps: SyncDeps, quiet = false): Promise<void> {
		this.running = true;
		try {
			const { report, state } = await runSync(deps);
			await this.stateStore().save(state);
			this.seq = state.baseSeq;

			if (!quiet || !isQuiet(report)) {
				new Notice(describeReport(report));
			}
			for (const failure of report.failed) {
				console.error(`Toolbox: sync failed for ${failure.path}: ${failure.error}`);
			}
		} catch (error) {
			new Notice(this.explain(error));
		} finally {
			this.running = false;
		}
	}

	private async forget(): Promise<void> {
		const ring = this.ring();
		if (!ring) {
			return;
		}
		await this.stateStore().reset(ring.deviceId);
		// Without a base every difference becomes a conflict, which is noisy but
		// never destructive — the right way round for a recovery button.
		new Notice(t('vaultSync.notice.forgotten'));
	}

	// --- wiring -------------------------------------------------------------

	private ring(): { code: string; deviceId: string; deviceName: string } | undefined {
		const ring = this.plugin.settings.moduleSettings[RING_MODULE_ID] as
			RingSettings | undefined;
		if (typeof ring?.code !== 'string' || !ring.code || typeof ring.deviceId !== 'string') {
			return undefined;
		}

		return {
			code: ring.code,
			deviceId: ring.deviceId,
			deviceName:
				typeof ring.deviceName === 'string' && ring.deviceName.trim()
					? ring.deviceName.trim()
					: Platform.isMobile
						? t('ring.device.mobile')
						: t('ring.device.desktop'),
		};
	}

	private secret(quiet = false): Bytes | undefined {
		const ring = this.ring();
		if (!ring) {
			if (!quiet) {
				new Notice(t('vaultSync.notice.needsRing'));
			}
			return undefined;
		}
		try {
			return parseRingCode(ring.code);
		} catch {
			if (!quiet) {
				new Notice(t('ring.notice.invalidCode'));
			}
			return undefined;
		}
	}

	private stateStore(): SyncStateStore {
		return new SyncStateStore(this.app, this.plugin.manifest.id);
	}

	private async client(quiet = false): Promise<SyncClient | undefined> {
		const secret = this.secret(quiet);
		if (!secret) {
			return undefined;
		}
		if (!this.settings.serverUrl) {
			if (!quiet) {
				new Notice(t('vaultSync.notice.needsServer'));
			}
			return undefined;
		}

		return new SyncClient(
			this.settings.serverUrl,
			await deriveVaultId(secret),
			await deriveAuthToken(secret)
		);
	}

	private async deps(quiet = false): Promise<SyncDeps | undefined> {
		const ring = this.ring();
		const secret = this.secret(quiet);
		const client = await this.client(quiet);
		if (!ring || !secret || !client) {
			return undefined;
		}
		if (!this.settings.registered) {
			// A background run must not nag someone who has not set this up.
			if (!quiet) {
				new Notice(t('vaultSync.notice.notSetUp'));
			}
			return undefined;
		}

		return {
			app: this.app,
			client,
			secret,
			device: { id: ring.deviceId, name: ring.deviceName },
			excluded: this.settings.excludedFolders,
			state: await this.stateStore().load(ring.deviceId),
		};
	}

	private explain(error: unknown): string {
		if (error instanceof SyncServerError) {
			return `${t('vaultSync.notice.failed')} ${error.message}`;
		}
		return `${t('vaultSync.notice.failed')} ${error instanceof Error ? error.message : String(error)}`;
	}
}

export const vaultSyncModule: ModuleDescriptor<VaultSyncSettings> = {
	id: 'vault-sync',
	get name() {
		return t('vaultSync.name');
	},
	get description() {
		return t('vaultSync.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new VaultSyncModule(plugin, vaultSyncModule),
};
