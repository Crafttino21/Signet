import { Notice, Platform, Setting } from 'obsidian';
import { deriveAuthToken, deriveVaultId, hashAuthToken, parseRingCode } from '@signet/protocol';
import type { Bytes } from '@signet/protocol';
import { SignetModule } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type { ModuleDescriptor } from '../../core/module';
import type { ServerSetupOutcome } from '../../core/ring-link';
import type { SetupStep } from '../../core/setup';
import type SignetPlugin from '../../main';
import { t } from '../../i18n';
import { isSyncServerAt, SyncClient, SyncServerError } from './client';
import { ConnectServerModal } from './connect-modal';
import type { ConnectAttempt, ConnectResult } from './connect-modal';
import { isQuiet, planSync, runSync } from './engine';
import type { SyncDeps } from './engine';
import { LiveSession } from './live';
import { matchConflictName } from './patterns';
import { touchesLocalFiles } from './reconcile';
import { SyncIndicator } from './indicator';
import type { SyncState } from './indicator';
import {
	completeServerUrl,
	isUsableServerUrl,
	normaliseServerUrl,
	SERVER_PLACEHOLDER,
	shouldAdopt,
	withDefaultPort,
} from './server-url';
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
	/** Say what every unattended run did. Off: with live sync that is constant. */
	announceRuns: boolean;
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
	// Off. A sync nobody asked for reporting back is a notice every few seconds
	// on a vault being edited, and what it did is in the panel either way.
	announceRuns: false,
};

const RING_MODULE_ID = 'plugin-ring';

/** How long the address field must be quiet before the ring is told. */
const ADDRESS_SETTLE_MS = 2000;

/**
 * Whether this vault is in a ring at all.
 *
 * Read straight from the stored settings rather than through the ring module,
 * because the descriptor is asked this before any module is built — and because
 * the two modules deliberately do not import each other.
 */
function hasRing(plugin: SignetPlugin): boolean {
	const ring = plugin.settings.moduleSettings[RING_MODULE_ID] as RingSettings | undefined;
	return typeof ring?.code === 'string' && ring.code.length > 0;
}

interface RingSettings {
	code?: unknown;
	role?: unknown;
	deviceId?: unknown;
	deviceName?: unknown;
}

class VaultSyncModule extends SignetModule<VaultSyncSettings> {
	private running = false;
	private live?: LiveSession;
	/** The commit this device is known to hold, so the live loop knows what to wait past. */
	private seq = 0;
	private status?: HTMLElement;
	private indicator?: SyncIndicator;
	private addressSettling?: number;

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
		// Tells the ring that an address is coming, so a code handed out before the
		// server exists can say so instead of silently carrying nothing.
		this.register(this.plugin.ringLink.expectServer());
		this.register(() => {
			window.clearTimeout(this.addressSettling);
		});

		// The ring asks for a server before it hands out a code, so that the first
		// code shown already carries the address.
		this.register(
			this.plugin.ringLink.onServerSetup((ringCode) => this.connectForNewRing(ringCode))
		);

		// A different ring code is a different vault. Whatever this device knew
		// about the old one has to go, or it talks confidently to a vault that is
		// not there.
		this.register(
			this.plugin.ringLink.onRingChanged(() => {
				void this.forgetTheVault();
			})
		);

		this.status = this.addStatusBarItem();
		this.status?.addClass('signet-status');
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
				console.error('Signet: live sync paused after an error.', error);
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
	 * Moves the indicators.
	 *
	 * On mobile there is no status bar, so that element may be absent — the
	 * indicator in the note header is the surface that exists everywhere, which
	 * is why the panel no longer carries this at all.
	 */
	private setState(state: SyncState): void {
		if (this.status) {
			this.status.setText(t(`vaultSync.status.${state}`));
			this.status.setAttribute('aria-label', t('vaultSync.status.tooltip'));
			this.status.toggleClass('signet-status--error', state === 'error');
			this.status.toggleClass('signet-status--live', state === 'live');
		}
		this.indicator?.setState(state);
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
						cls: 'signet-setup__hint',
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
						.setPlaceholder(SERVER_PLACEHOLDER)
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

	/**
	 * What a device sees while it waits for the ring to tell it where the server is.
	 *
	 * There is deliberately nothing to fill in. Everything this device needs it
	 * already has — the ring code is the key, and the address is on its way. Asking
	 * for either again would be asking someone to re-enter what they have.
	 */
	private renderWaiting(containerEl: HTMLElement): void {
		// A device that joined with a code from before the server existed has
		// nothing coming: the address travels in the code or in a snapshot, and it
		// has neither. Telling it to wait is telling it to wait forever, so the
		// field it needs goes here rather than under Advanced.
		if (!this.settings.serverUrl) {
			new Setting(containerEl)
				.setName(t('vaultSync.settings.fromRing'))
				.setDesc(t('vaultSync.settings.strandedClient'));
			this.renderServerField(containerEl, t('vaultSync.settings.strandedServerDesc'));
			return;
		}

		new Setting(containerEl)
			.setName(t('vaultSync.settings.fromRing'))
			.setDesc(t('vaultSync.settings.fromRingWaiting', { url: this.settings.serverUrl }))
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
					.setPlaceholder(SERVER_PLACEHOLDER)
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

	/**
	 * The address field, in the two places it belongs: under Advanced once this
	 * device is set up, and again while it is not, because a wrong address is the
	 * likeliest reason it is not.
	 */
	private renderServerField(containerEl: HTMLElement, description?: string): void {
		const setting = new Setting(containerEl)
			.setName(t('vaultSync.settings.server'))
			.setDesc(description ?? t('vaultSync.settings.serverDesc'))
			.addText((text) =>
				text
					.setPlaceholder(SERVER_PLACEHOLDER)
					.setValue(this.settings.serverUrl)
					.onChange(async (value) => {
						await this.setServerUrl(value);
					})
			);

		// Only while there is something to find out. Once this device is set up the
		// same button sits under Run, and two of them read as two different checks.
		if (!this.settings.registered) {
			setting.addButton((button) =>
				button
					.setButtonText(t('vaultSync.settings.test'))
					.onClick(() => void this.testConnection())
			);
		}
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

		// Conflicted copies are this module's own doing — it keeps both versions
		// rather than merging when both sides changed — so it is the one that has
		// to surface them. Left uncounted they pile up in folders nobody opens,
		// and a copy nobody looks at is the same as a lost edit.
		const conflicts = this.app.vault
			.getFiles()
			.filter((file) => matchConflictName(file.path) !== undefined).length;
		if (conflicts > 0) {
			containerEl.createEl('p', {
				cls: 'signet-ring__warning',
				text: t('vaultSync.settings.conflicts', { count: conflicts }),
			});
		}

		if (!ring) {
			containerEl.createEl('p', {
				cls: 'signet-ring__warning',
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

		// Until the server has answered for this vault there is exactly one thing to
		// do here, and everything else would be a choice about a sync that does not
		// run yet. Showing it anyway is how a settings page ends up unable to say
		// which of its twelve controls is the one standing in the way.
		if (!this.settings.registered) {
			if (ring.role === 'client') {
				this.renderWaiting(containerEl);
			} else {
				this.renderConnect(containerEl);
			}

			containerEl.createEl('p', {
				cls: 'signet-ring__hint',
				text: t('vaultSync.settings.moreAfterSetup'),
			});
			// Not repeated for a client that has no address: it just got the field
			// above, and offering it twice reads as two different settings.
			if (this.settings.serverUrl || ring.role !== 'client') {
				this.renderServerField(advancedSection(containerEl));
			}
			return;
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

		this.renderServerField(advanced);

		new Setting(advanced)
			.setName(t('vaultSync.settings.announce'))
			.setDesc(t('vaultSync.settings.announceDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.announceRuns).onChange(async (value) => {
					await this.patchSettings({ announceRuns: value });
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
			cls: 'signet-sync__note',
			text: t('vaultSync.settings.codeWarning'),
		});
	}

	// --- actions ------------------------------------------------------------

	/**
	 * Checks the address before it is used, and fills in a missing port.
	 *
	 * Both at the moment of use rather than at every keystroke: half of a URL is
	 * not an error while it is still being typed, and a port appended mid-word
	 * would fight the person typing.
	 */
	private async readyToConnect(): Promise<boolean> {
		const completed = completeServerUrl(this.settings.serverUrl);
		if (completed !== this.settings.serverUrl) {
			await this.patchSettings({ serverUrl: completed, serverUrlSource: 'user' });
			this.plugin.ringLink.contribute({ serverUrl: completed });
			new Notice(t('vaultSync.notice.portAdded', { url: completed }));
			this.refreshUi();
		}

		// An address without a scheme reaches nothing, and published into the ring it
		// is silently discarded by every other device — a failure with nowhere to see
		// it happen.
		if (!isUsableServerUrl(this.settings.serverUrl)) {
			new Notice(t('vaultSync.notice.badServerUrl'));
			return false;
		}
		return true;
	}

	private async testConnection(): Promise<void> {
		if (!(await this.readyToConnect())) {
			return;
		}

		const client = await this.client();
		if (!client) {
			return;
		}

		try {
			const health = await client.health();
			new Notice(t('vaultSync.notice.reachable', { protocol: health.protocol }));
		} catch (error) {
			new Notice(await this.diagnose(error));
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

		// The field fires per keystroke and publishing must not, so the ring hears
		// about it once the typing has stopped.
		window.clearTimeout(this.addressSettling);
		this.addressSettling = window.setTimeout(
			() => void this.offerAddressToRing(),
			ADDRESS_SETTLE_MS
		);
	}

	/**
	 * Hands a changed address to the other devices, once it is worth handing over.
	 *
	 * Moving the server — a name instead of an IP, TLS in front of it — used to
	 * reach nobody: the address was contributed to the ring but nothing published
	 * it, so the other devices went on using the old one until some unrelated
	 * change happened to trigger a publish.
	 *
	 * It is checked first, and against the vault rather than merely for a reply.
	 * Every client that took its address from the ring will follow this one, so
	 * publishing an address that does not serve this vault would take working
	 * devices offline — the opposite of what moving a server is meant to do.
	 */
	private async offerAddressToRing(): Promise<void> {
		if (this.ring()?.role !== 'host' || !isUsableServerUrl(this.settings.serverUrl)) {
			return;
		}

		const client = await this.client(true);
		if (!client) {
			return;
		}
		try {
			if (!(await client.belongs())) {
				return;
			}
		} catch {
			// Unreachable from here is not an answer about the address, only about
			// this moment. Saying nothing beats telling every device to move.
			return;
		}

		this.plugin.ringLink.contribute({ serverUrl: this.settings.serverUrl });
		this.plugin.ringLink.requestPublish();
		new Notice(t('vaultSync.notice.addressPublished', { url: this.settings.serverUrl }));
	}

	/**
	 * Connects a server for a ring that is still being created.
	 *
	 * The ring code exists but is not stored yet, so nothing here may read it
	 * from the settings — it arrives as an argument, and every key needed to
	 * register a vault comes out of it.
	 */
	private async connectForNewRing(ringCode: string): Promise<ServerSetupOutcome> {
		let secret: Bytes;
		try {
			secret = parseRingCode(ringCode);
		} catch {
			return 'cancelled';
		}

		return ConnectServerModal.ask(this.app, (attempt) => this.register_(secret, attempt));
	}

	/** One attempt at creating the vault, reported rather than thrown. */
	private async register_(secret: Bytes, attempt: ConnectAttempt): Promise<ConnectResult> {
		const url = completeServerUrl(attempt.serverUrl);
		if (!isUsableServerUrl(url)) {
			return { ok: false, message: t('vaultSync.notice.badServerUrl') };
		}
		if (!attempt.registrationSecret.trim()) {
			return { ok: false, message: t('vaultSync.notice.needsRegistrationSecret') };
		}

		const client = new SyncClient(
			url,
			await deriveVaultId(secret),
			await deriveAuthToken(secret)
		);
		try {
			await client.register(
				attempt.registrationSecret.trim(),
				await hashAuthToken(await deriveAuthToken(secret))
			);
		} catch (error) {
			// The registration secret never reaches the settings on this path: it is
			// used here and forgotten with the modal.
			return { ok: false, message: await this.diagnose(error, url) };
		}

		await this.patchSettings({
			serverUrl: url,
			serverUrlSource: 'user',
			registered: true,
			registrationSecret: '',
		});
		this.plugin.ringLink.contribute({ serverUrl: url });
		this.setState('idle');
		this.refreshUi();
		return { ok: true };
	}

	/**
	 * Forgets a vault this device can no longer open.
	 *
	 * Everything the sync uses is derived from the ring code, so a code that
	 * changed or went away leaves `registered` pointing at a vault whose key is
	 * gone. The address stays — it is the same machine, and the next ring will
	 * very likely live on it too.
	 */
	private async forgetTheVault(): Promise<void> {
		if (!this.settings.registered) {
			return;
		}
		await this.patchSettings({ registered: false });
		this.seq = 0;
		this.setState('off');
		this.refreshUi();
	}

	private async setUp(): Promise<void> {
		if (!(await this.readyToConnect())) {
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
			new Notice(await this.diagnose(error));
		}
	}

	/**
	 * The failure, plus the one thing worth checking before anything else.
	 *
	 * "Connection refused" means nothing answered on that port. It does not say
	 * whether the machine is wrong, the network is wrong, or only the port is —
	 * and the port is by far the likeliest, because a bare IP invites the reader
	 * to leave it out or to guess 80. So the usual port is tried once, and if a
	 * sync server answers there the message says so and names the address.
	 *
	 * Only for a transport failure. A server that answered and said no is a
	 * different problem, and probing elsewhere would be answering a question
	 * nobody asked.
	 */
	private async diagnose(error: unknown, url = this.settings.serverUrl): Promise<string> {
		const explained = this.explain(error, url);
		if (error instanceof SyncServerError) {
			return explained;
		}

		const candidate = withDefaultPort(url);
		if (candidate && (await isSyncServerAt(candidate))) {
			return `${explained} ${t('vaultSync.notice.foundOnDefaultPort', { url: candidate })}`;
		}
		return explained;
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

		// The catch-up walks every file in the vault, and this is reachable well
		// before there is a list to walk: pasting a join code has the ring announce
		// an address, which lands here during the sync module's own onload, when
		// Obsidian's file index is not populated yet. A first sync against a vault
		// that looks empty is not destructive — a device with no base never reads
		// its own emptiness as a deletion — but it would upload nothing and then
		// upload everything on the next run. `onLayoutReady` fires immediately
		// once the index is there, so nothing is delayed that need not be.
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.syncOnStart) {
				void this.autoSync();
			}
			this.live?.start();
		});
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
			// A run somebody asked for always reports back — a button that does its
			// work in silence reads as a button that did nothing. A run that started
			// on its own says nothing unless it went wrong, because with live sync on
			// it happens every few seconds. Either way the panel and the indicator in
			// the note header carry the result.
			if (
				!quiet ||
				report.failed.length > 0 ||
				(this.settings.announceRuns && !isQuiet(report))
			) {
				new Notice(summary);
			}
			for (const failure of report.failed) {
				console.error(`Signet: sync failed for ${failure.path}: ${failure.error}`);
			}

			// A run that could not finish everything is not a clean run, and the
			// indicator should not pretend otherwise.
			this.setState(
				report.failed.length > 0
					? 'error'
					: this.settings.liveSync && this.live?.isRunning
						? 'live'
						: 'idle'
			);
		} catch (error) {
			this.setState('error');
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
		return new SyncStateStore(this.app, this.plugin.folder());
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

	/**
	 * What went wrong, with the address in it.
	 *
	 * A server that answers and says no is a different problem from one that was
	 * never reached, and only the second one is usually a typo in the address. The
	 * message names the address for that reason: "connection refused" says nothing
	 * about which of the two it is until you can see what was dialled.
	 */
	private explain(error: unknown, url = this.settings.serverUrl): string {
		if (error instanceof SyncServerError) {
			return `${t('vaultSync.notice.failed')} ${error.message}`;
		}
		return t('vaultSync.notice.unreachable', {
			url: url || '—',
			message: error instanceof Error ? error.message : String(error),
		});
	}
}

export const vaultSyncModule: ModuleDescriptor<VaultSyncSettings> = {
	id: 'vault-sync',
	// A vault sync before there is a ring has no key, no vault id and nothing to
	// say. It appears the moment a ring does, switched off, as a thing to turn on.
	available: (plugin) => hasRing(plugin),
	enabledByDefault: false,
	// Joining a ring is asking for the sync. Having pasted the code, nobody
	// should then have to find a switch to make it do anything.
	enableWhenAvailable: true,
	get name() {
		return t('vaultSync.name');
	},
	get description() {
		return t('vaultSync.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: SignetPlugin) => new VaultSyncModule(plugin, vaultSyncModule),
};
