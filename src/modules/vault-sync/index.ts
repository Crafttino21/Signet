import { Notice, Platform, Setting } from 'obsidian';
import { deriveAuthToken, deriveVaultId, hashAuthToken, parseRingCode } from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { ToolboxModule } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type { ModuleDescriptor } from '../../core/module';
import type { SetupStep } from '../../core/setup';
import type ToolboxPlugin from '../../main';
import { t } from '../../i18n';
import { SyncClient, SyncServerError } from './client';
import { isQuiet, planSync, runSync } from './engine';
import type { SyncDeps } from './engine';
import { LiveSession } from './live';
import { touchesLocalFiles } from './reconcile';
import { SyncIndicator } from './indicator';
import type { SyncState } from './indicator';
import { isUsableServerUrl, normaliseServerUrl, shouldAdopt } from './server-url';
import type { ServerUrlSource } from './server-url';
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
	/** Who put {@link serverUrl} there. The ring never replaces a user's answer. */
	serverUrlSource: ServerUrlSource;
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
	// 'user' is the safe reading of an address already in a settings file: there is
	// no record of where it came from, and guessing 'ring' is the guess that throws
	// away something somebody typed.
	serverUrlSource: 'user',
	registrationSecret: '',
	registered: false,
	excludedFolders: [],
	autoSyncMinutes: 0,
	confirmLocalChanges: true,
	// On, because keeping open devices in step is the point of having a server at
	// all. It only runs while Obsidian is on screen and costs one parked request.
	liveSync: true,
	syncOnStart: true,
};

const RING_MODULE_ID = 'plugin-ring';

interface RingSettings {
	code?: unknown;
	role?: unknown;
	deviceId?: unknown;
	deviceName?: unknown;
}

class VaultSyncModule extends ToolboxModule<VaultSyncSettings> {
	private running = false;
	private live?: LiveSession;
	/** The commit this device is known to hold, so the live loop knows what to wait past. */
	private seq = 0;
	private state: SyncState = 'off';
	private lastSummary: string | undefined;
	private status?: HTMLElement;
	private indicator?: SyncIndicator;

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

		// Whatever the host published about the server, this device adopts. This is
		// what makes joining a ring the only thing anyone has to do: the address
		// arrives with the snapshot, and the key was the ring code all along.
		this.register(
			this.plugin.ringLink.onAnnounce((info) => {
				void this.adopt(info.serverUrl);
			})
		);
		if (this.settings.serverUrl) {
			this.plugin.ringLink.contribute({ serverUrl: this.settings.serverUrl });
		}

		this.status = this.addStatusBarItem();
		this.status?.addClass('toolbox-status');
		this.status?.addEventListener('click', () => void this.plugin.openPanel());

		// The status bar does not exist on mobile, so the note header carries the
		// same answer on every platform. Notes open and close all the time, hence
		// the two events rather than a one-off pass at startup.
		const indicator = new SyncIndicator(this.app.workspace, {
			isLive: (path) => this.plugin.liveEditing.isLive(path),
			onClick: () => void this.plugin.openPanel(),
		});
		this.indicator = indicator;
		this.register(() => {
			indicator.dispose();
		});
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => indicator.refresh()));
		this.registerEvent(this.app.workspace.on('layout-change', () => indicator.refresh()));
		this.register(
			this.plugin.liveEditing.onChange(() => {
				indicator.refresh();
			})
		);

		this.setState(this.settings.registered ? 'idle' : 'off');

		this.setUpLive();

		// The vault index is not ready during onload, so the first catch-up waits.
		this.app.workspace.onLayoutReady(() => {
			// The host may have registered the vault after this device joined, so a
			// device that is waiting asks again every time Obsidian starts.
			void this.claim().then(() => {
				if (this.settings.syncOnStart) {
					void this.autoSync();
				}
				this.live?.start();
			});
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

	/**
	 * Moves the indicators and redraws the panel.
	 *
	 * On mobile there is no status bar, so that element may be absent. The note
	 * header and the panel are the surfaces that exist everywhere, and they carry
	 * the same information.
	 */
	private setState(state: SyncState, summary?: string): void {
		this.state = state;
		if (summary !== undefined) {
			this.lastSummary = summary;
		}

		if (this.status) {
			this.status.setText(t(`vaultSync.status.${state}`));
			this.status.setAttribute('aria-label', t('vaultSync.status.tooltip'));
			this.status.toggleClass('toolbox-status--error', state === 'error');
			this.status.toggleClass('toolbox-status--live', state === 'live');
		}
		this.indicator?.setState(state);
		this.refreshPanel();
	}

	override setupStep(): SetupStep | undefined {
		return {
			title: t('vaultSync.setup.title'),
			hint: t('vaultSync.setup.hint'),
			// A ring has to exist first, so this step reports itself finished until
			// there is one — otherwise the wizard would ask for a server address
			// before the thing that encrypts what goes to it.
			satisfied: () => this.ring() === undefined || this.settings.registered,
			render: (containerEl, changed) => {
				if (this.ring()?.role === 'client') {
					// A client is not supposed to configure anything: the address comes
					// from the host and the key is the ring code it already typed.
					containerEl.createEl('p', {
						cls: 'toolbox-setup__hint',
						text: this.settings.serverUrl
							? t('vaultSync.setup.waitingForServer', {
									url: this.settings.serverUrl,
								})
							: t('vaultSync.setup.waitingForHost'),
					});
					new Setting(containerEl).addButton((button) =>
						button
							.setButtonText(t('vaultSync.setup.checkAgain'))
							.setCta()
							.onClick(() => {
								void this.claim(false).then(changed);
							})
					);
					return;
				}

				new Setting(containerEl).setName(t('vaultSync.settings.server')).addText((text) =>
					text
						.setPlaceholder('https://sync.example.com')
						.setValue(this.settings.serverUrl)
						.onChange(async (value) => {
							await this.setServerUrl(value);
						})
				);

				new Setting(containerEl)
					.setName(t('vaultSync.settings.registration'))
					.addText((text) =>
						text.setValue(this.settings.registrationSecret).onChange(async (value) => {
							await this.patchSettings({ registrationSecret: value.trim() });
						})
					)
					.addButton((button) =>
						button
							.setButtonText(t('vaultSync.setup.connect'))
							.setCta()
							.onClick(() => {
								void this.setUp().then(changed);
							})
					);
			},
		};
	}

	override displayPanel(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: t('vaultSync.panel.title') });

		const ready = this.settings.registered;
		containerEl.createEl('p', {
			cls: 'toolbox-panel__state',
			text: ready
				? t('vaultSync.panel.ready', { seq: this.seq })
				: this.ring()?.role === 'client'
					? // Not something to fix — something that is on its way.
						t('vaultSync.panel.waitingForRing')
					: t('vaultSync.panel.notSetUp'),
		});
		containerEl.createEl('p', {
			cls:
				this.state === 'error'
					? 'toolbox-panel__state toolbox-panel__state--warn'
					: 'toolbox-panel__state',
			text:
				this.lastSummary === undefined
					? t('vaultSync.panel.never')
					: t('vaultSync.panel.lastRun', { summary: this.lastSummary }),
		});

		// Which server, and whether this device was told or chose. Without it the
		// commonest failure — a device pointed at an address nothing answers on —
		// looks exactly like a device that is simply idle.
		if (this.settings.serverUrl) {
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state',
				text:
					this.settings.serverUrlSource === 'ring'
						? t('vaultSync.panel.serverFromRing', { url: this.settings.serverUrl })
						: t('vaultSync.panel.serverManual', { url: this.settings.serverUrl }),
			});
		}

		if (!ready) {
			if (this.settings.serverUrl) {
				const waiting = containerEl.createDiv({ cls: 'toolbox-panel__buttons' });
				waiting
					.createEl('button', { text: t('vaultSync.settings.test') })
					.addEventListener('click', () => void this.testConnection());
				waiting
					.createEl('button', { text: t('vaultSync.setup.checkAgain') })
					.addEventListener('click', () => void this.claim(false));
			}
			return;
		}

		const buttons = containerEl.createDiv({ cls: 'toolbox-panel__buttons' });
		buttons
			.createEl('button', { text: t('vaultSync.command.sync'), cls: 'mod-cta' })
			.addEventListener('click', () => void this.sync());
		buttons
			.createEl('button', { text: t('vaultSync.command.preview') })
			.addEventListener('click', () => void this.preview());
		buttons
			.createEl('button', {
				text: this.settings.liveSync
					? t('vaultSync.panel.live')
					: t('vaultSync.panel.liveOff'),
			})
			.addEventListener('click', () => {
				void this.patchSettings({ liveSync: !this.settings.liveSync }).then(() => {
					new Notice(t('vaultSync.notice.restartNeeded'));
					this.refreshPanel();
				});
			});
	}

	/**
	 * What a device sees while it waits for the ring to tell it where the server is.
	 *
	 * There is deliberately nothing to fill in. Everything this device needs it
	 * already has — the ring code is the key, and the address is on its way. Asking
	 * for either again would be asking someone to re-enter what they have.
	 */
	private renderWaiting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('vaultSync.settings.fromRing'))
			.setDesc(
				this.settings.serverUrl
					? t('vaultSync.settings.fromRingWaiting', { url: this.settings.serverUrl })
					: t('vaultSync.settings.fromRingNoServer')
			)
			.addButton((button) =>
				button
					.setButtonText(t('vaultSync.setup.checkAgain'))
					.setCta()
					.onClick(() => void this.claimAndCatchUp(false))
			);
	}

	/**
	 * The one device that has to be told where the server is, once.
	 *
	 * Someone has to say where it lives and prove they may create a vault on it.
	 * That is this device and this moment; the registration secret is server-wide,
	 * is cleared straight after use, and never travels to another device.
	 */
	private renderConnect(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('vaultSync.settings.connect')).setHeading();

		new Setting(containerEl)
			.setName(t('vaultSync.settings.server'))
			.setDesc(t('vaultSync.settings.connectDesc'))
			.addText((text) =>
				text
					.setPlaceholder('https://sync.example.com')
					.setValue(this.settings.serverUrl)
					.onChange(async (value) => {
						await this.setServerUrl(value);
					})
			);

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
				cls: 'toolbox-ring__warning',
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

		// Nothing about the server is shown once this device is set up: the address
		// came from the ring, and there is no reason to invite anyone to change it.
		// It stays reachable under Advanced for the case where it is genuinely
		// different here.
		if (!this.settings.registered) {
			if (ring.role === 'client') {
				this.renderWaiting(containerEl);
			} else {
				this.renderConnect(containerEl);
			}
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

		const advanced = advancedSection(containerEl);

		new Setting(advanced)
			.setName(t('vaultSync.settings.server'))
			.setDesc(t('vaultSync.settings.serverDesc'))
			.addText((text) =>
				text
					.setPlaceholder('https://sync.example.com')
					.setValue(this.settings.serverUrl)
					.onChange(async (value) => {
						await this.setServerUrl(value);
					})
			);

		new Setting(advanced)
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

		new Setting(advanced)
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

	/**
	 * Records an address a person typed, and offers it to the ring.
	 *
	 * Marked as theirs, so a snapshot from the host will not replace it later. An
	 * address that is still being typed is stored as it stands — half of a URL is
	 * not an error yet — and only checked when it is about to be used.
	 */
	private async setServerUrl(value: string): Promise<void> {
		const url = normaliseServerUrl(value);
		await this.patchSettings({ serverUrl: url, serverUrlSource: 'user' });
		this.plugin.ringLink.contribute({ serverUrl: url });
	}

	private async setUp(): Promise<void> {
		// Checked here rather than at every keystroke: an address without a scheme
		// reaches nothing, and published into the ring it is silently discarded by
		// every other device — a failure with nowhere to see it.
		if (!isUsableServerUrl(this.settings.serverUrl)) {
			new Notice(t('vaultSync.notice.badServerUrl'));
			return;
		}

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
			// Hand the address to the ring and have the host publish it, so the other
			// devices need nothing but the code they already have.
			this.plugin.ringLink.contribute({ serverUrl: this.settings.serverUrl });
			this.plugin.ringLink.requestPublish();
			// The settings still show the registration field until they are redrawn,
			// which reads as if the button had done nothing.
			this.refreshUi();
			new Notice(
				outcome === 'created' ? t('vaultSync.notice.created') : t('vaultSync.notice.joined')
			);
		} catch (error) {
			new Notice(this.explain(error));
		}
	}

	/**
	 * Takes the server address the host published.
	 *
	 * An address someone typed on this device is left alone — on a home network the
	 * host's address can be the one that is unreachable from here. Anything this
	 * device itself adopted from the ring is replaced, which is what lets the server
	 * move without a visit to every device. {@link shouldAdopt} holds that rule.
	 *
	 * `registered` cannot survive a change of address: it means the vault exists on
	 * *that* server, and the claim below establishes it again for the new one.
	 */
	private async adopt(serverUrl: string | undefined): Promise<void> {
		const url = shouldAdopt(this.settings, serverUrl);

		if (url) {
			await this.patchSettings({
				serverUrl: url,
				serverUrlSource: 'ring',
				registered: false,
			});
			// Passed on, so this device's own join code carries it to a third one.
			this.plugin.ringLink.contribute({ serverUrl: url });
			new Notice(t('vaultSync.notice.serverFromRing', { url }));
			this.refreshUi();
		}

		await this.claimAndCatchUp();
	}

	/**
	 * Finds out whether this device can already use the vault.
	 *
	 * There is nothing to negotiate: every device in the ring derives the same
	 * token from the same code, so the only question is whether the host has
	 * created the vault on the server yet. Until it has, this stays quiet and is
	 * asked again — at the next start, at the next snapshot, or by hand.
	 */
	private async claim(quiet = true): Promise<boolean> {
		if (this.settings.registered || !this.settings.serverUrl) {
			return false;
		}

		const client = await this.client(quiet);
		if (!client) {
			return false;
		}

		try {
			if (!(await client.belongs())) {
				if (!quiet) {
					new Notice(t('vaultSync.notice.notOnServerYet'));
				}
				return false;
			}
		} catch (error) {
			// Unreachable is not "not ours" — a phone off the home network gets here
			// every time, and must not be told its ring is wrong.
			if (!quiet) {
				new Notice(this.explain(error));
			}
			return false;
		}

		await this.patchSettings({ registered: true });
		this.setState('idle');
		this.refreshUi();
		new Notice(t('vaultSync.notice.readyFromRing'));
		return true;
	}

	/**
	 * Claims the vault and, if that just worked, fetches what is on it.
	 *
	 * Being set up and holding none of the notes is not what anyone means by set
	 * up. It is the same catch-up that runs when Obsidian opens and follows the
	 * same preference, rather than inventing one for this moment.
	 */
	private async claimAndCatchUp(quiet = true): Promise<void> {
		if (!(await this.claim(quiet))) {
			return;
		}
		if (this.settings.syncOnStart) {
			await this.autoSync();
			this.live?.start();
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
		this.setState('syncing');
		try {
			const { report, state } = await runSync(deps);
			await this.stateStore().save(state);
			this.seq = state.baseSeq;

			const summary = describeReport(report);
			if (!quiet || !isQuiet(report)) {
				new Notice(summary);
			}
			for (const failure of report.failed) {
				console.error(`Toolbox: sync failed for ${failure.path}: ${failure.error}`);
			}

			// A run that could not finish everything is not a clean run, and the
			// indicator should not pretend otherwise.
			this.setState(
				report.failed.length > 0
					? 'error'
					: this.settings.liveSync && this.live?.isRunning
						? 'live'
						: 'idle',
				summary
			);
		} catch (error) {
			this.setState('error', this.explain(error));
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

	private ring():
		| { code: string; role: 'host' | 'client' | null; deviceId: string; deviceName: string }
		| undefined {
		const ring = this.plugin.settings.moduleSettings[RING_MODULE_ID] as
			RingSettings | undefined;
		if (typeof ring?.code !== 'string' || !ring.code || typeof ring.deviceId !== 'string') {
			return undefined;
		}

		return {
			code: ring.code,
			role: ring.role === 'host' || ring.role === 'client' ? ring.role : null,
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
			// A note being edited live belongs to its session until it closes.
			// Syncing it as a whole file at the same time would have the two writing
			// over each other, which is the failure this whole project exists to stop.
			excluded: [...this.settings.excludedFolders, ...this.plugin.liveEditing.list()],
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
	enabledByDefault: true,
	get name() {
		return t('vaultSync.name');
	},
	get description() {
		return t('vaultSync.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new VaultSyncModule(plugin, vaultSyncModule),
};
