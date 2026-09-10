import { Notice, Platform, Setting, TFile } from 'obsidian';
import { PluginApi } from '../../core/obsidian-internals';
import { ToolboxModule } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type { ModuleDescriptor } from '../../core/module';
import type { SetupStep } from '../../core/setup';
import type ToolboxPlugin from '../../main';
import { t } from '../../i18n';
import { applyPlans } from './apply';
import { CommunityCatalog } from './catalog';
import { installPlugin } from './installer';
import type { ApplyResult } from './apply';
import {
	addressFromUrl,
	addressToUrl,
	formatJoinCode,
	formatRingCode,
	generateRingSecret,
	parseJoinCode,
	parseRingCode,
	UnsupportedJoinCodeError,
} from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { deriveRingId, openSnapshot, RingDecryptionError, sealSnapshot } from '@toolbox/protocol';
import { computeDiff, planApply } from './diff';
import {
	ConfirmModal,
	JoinRingModal,
	RingDiffModal,
	RingFileConflictModal,
	ShowCodeModal,
} from './modals';
import type { MissingAddress } from './modals';
import { randomDeviceName } from '../../core/device-name';
import { buildRoster, DeviceRoster } from './devices';
import type { DeviceHealth } from './devices';
import { classifyRingFile, RingFile } from './ring-file';
import type { RingFileVerdict } from './ring-file';
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
	/** Devices this host has removed. Republished with every snapshot. */
	removedIds: string[];
	ringFilePath: string;
	/** Last sequence this host published — its half of the concurrency check. */
	lastPublishedSeq: number;
	/** Last sequence fully applied here. Only advances when nothing failed. */
	lastAppliedSeq: number;
	/** Plugins whose settings the host keeps to itself. */
	excludedIds: string[];
	/** Plugins this device never touches. */
	ignoredIds: string[];
	/** Fetch plugins the host has and this device does not. */
	installMissing: boolean;
};

/**
 * How long a device may be away before the roster says so.
 *
 * Short, because this is a list of who is here now rather than a report on the
 * last few days: with live sync a device that is running checks in every few
 * seconds, so a quarter of an hour of silence already means it is closed.
 */
const STALE_AFTER_MINUTES = 15;

/** How often this device writes itself into the roster. */
const BEAT_EVERY_MINUTES = 5;

const DEFAULT_SETTINGS: PluginRingSettings = {
	code: null,
	role: null,
	deviceId: '',
	deviceName: '',
	hostId: null,
	removedIds: [],
	ringFilePath: 'Toolbox/plugin-ring.json',
	lastPublishedSeq: 0,
	lastAppliedSeq: 0,
	excludedIds: [],
	ignoredIds: [],
	installMissing: true,
};

function parseIdList(value: string): string[] {
	return value
		.split(/[\s,]+/)
		.map((id) => id.trim())
		.filter((id) => id.length > 0);
}

class PluginRingModule extends ToolboxModule<PluginRingSettings> {
	private api?: PluginApi;
	private readonly catalog = new CommunityCatalog();

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

		// A client learns about a new snapshot the moment sync drops it in. Both
		// events matter: the very first snapshot to reach a device arrives as a
		// creation, and listening only for modifications missed exactly the case a
		// device waiting to join is waiting for.
		const noticed = (file: unknown): void => {
			if (
				file instanceof TFile &&
				file.path === this.ringFile().path &&
				this.settings.role === 'client'
			) {
				void this.notifyIfNewer();
			}
		};
		this.registerEvent(this.app.vault.on('create', noticed));
		this.registerEvent(this.app.vault.on('modify', noticed));
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && file.path === this.ringFile().path) {
					void this.refreshFileVerdict();
				}
			})
		);

		// Another module changed something the ring carries — the sync server's
		// address. Only the host writes snapshots, so everywhere else this is a
		// no-op rather than a decision anyone has to make.
		this.register(
			this.plugin.ringLink.onPublishRequest(() => {
				if (this.settings.role === 'host') {
					void this.publish();
				}
			})
		);

		// The file index is not populated yet during onload, so this has to wait for
		// the layout to settle or it would always find nothing.
		this.registerInterval(
			window.setInterval(() => void this.beat(), BEAT_EVERY_MINUTES * 60 * 1000)
		);

		this.app.workspace.onLayoutReady(() => {
			this.warnAboutConflictCopies();
			void this.refreshFileVerdict();
			void this.beat().then(() => this.refreshDevices());

			// A snapshot that arrived while this device was closed raises no vault
			// event: by the time Obsidian starts, the file is simply there and
			// unchanged. Without this read a device that missed one publish waits for
			// the next one — which, for a ring that rarely changes, can be days.
			if (this.settings.role === 'client') {
				void this.notifyIfNewer();
			}
		});
	}

	override setupStep(): SetupStep | undefined {
		if (!this.api) {
			return undefined;
		}

		return {
			title: t('ring.setup.title'),
			hint: t('ring.setup.hint'),
			satisfied: () => this.settings.role !== null,
			render: (containerEl, changed) => {
				new Setting(containerEl)
					.addButton((button) =>
						button
							.setButtonText(t('ring.settings.createRing'))
							.setCta()
							.onClick(() => {
								void this.createRing().then(changed);
							})
					)
					.addButton((button) =>
						button.setButtonText(t('ring.settings.joinWithCode')).onClick(() => {
							new JoinRingModal(this.app, async (code) => {
								await this.join(code);
								changed();
							}).open();
						})
					);
			},
		};
	}

	/**
	 * Re-reads what lies at the ring path, for the panel to show.
	 *
	 * The panel is drawn synchronously and often, so it reads this rather than the
	 * file. Every place that could change the answer calls it and then redraws:
	 * publishing, checking, joining, and the file arriving through a sync.
	 */
	private async refreshFileVerdict(): Promise<void> {
		const secret = this.secret();
		if (!secret) {
			this.fileVerdict = undefined;
			return;
		}

		try {
			this.fileVerdict = await classifyRingFile(await this.ringFile().read(), secret);
		} catch {
			this.fileVerdict = undefined;
		}
		this.refreshPanel();
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

		if (role === 'client' && this.settings.hostId === null) {
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state toolbox-panel__state--warn',
				text: t('ring.panel.waitingForHost'),
			});
		}

		if (role === 'host' && this.settings.lastPublishedSeq === 0) {
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state toolbox-panel__state--warn',
				text: t('ring.panel.nothingPublished'),
			});
		}

		// What is actually lying at the ring path, said plainly and with the path in
		// it. "There is no ring file" used to be reachable only by pressing a button
		// and reading a notice that vanished.
		if (role !== null && this.fileVerdict !== undefined && this.fileVerdict !== 'ours') {
			const path = this.ringFile().path;
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state toolbox-panel__state--warn',
				text:
					this.fileVerdict === 'free'
						? role === 'host'
							? t('ring.panel.noFileHost', { path })
							: t('ring.notice.noRingFileYet', { path })
						: this.fileVerdict === 'foreign'
							? t('ring.panel.foreignFile', { path })
							: t('ring.panel.corruptFile', { path }),
			});
		}

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
		button(t('ring.settings.leave'), () => void this.leave());

		this.renderDevices(containerEl);
	}

	/**
	 * Who is in this ring, and what can be done about them.
	 *
	 * The two actions are the host's, and both are cooperative: the other device
	 * finds out the next time it reads a snapshot. Neither is enforcement — the
	 * ring code is the key, and a device that keeps it can still read the ring —
	 * so the wording says removal rather than revocation, and the dialog spells
	 * out what actually revoking access takes.
	 */
	private renderDevices(containerEl: HTMLElement): void {
		containerEl.createEl('h4', { text: t('ring.panel.devices') });

		if (this.devices.length === 0) {
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state',
				text: t('ring.panel.noDevices'),
			});
			return;
		}

		const isHost = this.settings.role === 'host';
		const list = containerEl.createEl('ul', { cls: 'toolbox-ring__list' });

		for (const device of this.devices) {
			const row = list.createEl('li', { cls: 'toolbox-ring__row' });
			row.createSpan({ cls: 'toolbox-ring__name', text: device.deviceName });
			row.createSpan({
				cls:
					device.status === 'fresh' || device.isSelf
						? 'toolbox-ring__kind'
						: 'toolbox-ring__kind toolbox-panel__state--warn',
				text: describeSeen(device),
			});

			const tags: string[] = [];
			if (device.isSelf) {
				tags.push(t('ring.panel.thisDevice'));
			}
			if (device.isHost) {
				tags.push(t('ring.panel.isHost'));
			}
			if (device.version !== undefined) {
				tags.push(t('panel.version', { version: device.version }));
			}
			if (tags.length > 0) {
				row.createSpan({ cls: 'toolbox-ring__detail', text: tags.join(' · ') });
			}

			// Only the host can act, and never on itself: handing the ring to the
			// device already holding it does nothing, and removing yourself is what
			// "Leave" is for.
			if (!isHost || device.isSelf) {
				continue;
			}

			const actions = row.createDiv({ cls: 'toolbox-ring__actions' });
			actions
				.createEl('button', { text: t('ring.panel.makeHost') })
				.addEventListener('click', () => void this.handOver(device));
			actions
				.createEl('button', { text: t('ring.panel.remove') })
				.addEventListener('click', () => void this.removeDevice(device));
		}
	}

	/**
	 * Tells a device it is no longer part of the ring.
	 *
	 * A message, not a lock. It is published in the snapshot, the device reads it
	 * the next time it syncs, and it leaves. A device that never syncs again
	 * never finds out — and one that keeps the code can still read the ring,
	 * because the code is the key. Revoking access is a new ring and a new code,
	 * which the dialog says.
	 */
	private async removeDevice(device: DeviceHealth): Promise<void> {
		const confirmed = await ConfirmModal.ask(this.app, {
			title: t('ring.remove.title', { name: device.deviceName }),
			body: t('ring.remove.body'),
			confirm: t('ring.panel.remove'),
		});
		if (!confirmed) {
			return;
		}

		await this.patchSettings({
			removedIds: [...new Set([...this.settings.removedIds, device.deviceId])],
		});
		await this.roster().forget(device.deviceId);
		await this.publish();
		await this.refreshDevices();
	}

	/**
	 * Hands the ring to another device.
	 *
	 * Published first, demoted second: the snapshot naming the new host is what
	 * makes it one, and this device stepping down before that would leave a ring
	 * nobody is publishing. The new host picks it up when it next reads a
	 * snapshot, and continues the sequence from the file rather than from its own
	 * settings — which the publish path already works out for a host whose
	 * settings are behind its own file.
	 */
	private async handOver(device: DeviceHealth): Promise<void> {
		const confirmed = await ConfirmModal.ask(this.app, {
			title: t('ring.handOver.title', { name: device.deviceName }),
			body: t('ring.handOver.body', { name: device.deviceName }),
			confirm: t('ring.panel.makeHost'),
		});
		if (!confirmed) {
			return;
		}

		if (!(await this.publish({ id: device.deviceId, name: device.deviceName }))) {
			return;
		}

		await this.patchSettings({
			role: 'client',
			hostId: device.deviceId,
			lastAppliedSeq: this.settings.lastPublishedSeq,
		});
		this.lastSeen = undefined;
		await this.beat();
		this.refreshUi();
		await this.refreshDevices();
		new Notice(t('ring.notice.handedOver', { name: device.deviceName }));
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
					await this.patchSettings({ deviceName: value.trim() || randomDeviceName() });
					// Straight into the roster, so the other devices see the new name
					// at their next sync rather than at this one's next heartbeat.
					await this.beat();
					await this.refreshDevices();
				})
			);

		const installer = new Setting(containerEl)
			.setName(t('ring.settings.install'))
			.setDesc(t('ring.settings.installDesc'));

		if (this.api?.canInstall() === true) {
			installer.addToggle((toggle) =>
				toggle.setValue(this.settings.installMissing).onChange(async (value) => {
					await this.patchSettings({ installMissing: value });
				})
			);
		} else {
			installer.setDesc(t('ring.settings.installUnsupported'));
		}

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

		// Whatever lies at the ring path cannot belong to a ring this device is not
		// in yet, so it is a leftover. Asking now rather than at the first publish
		// keeps a host from being created into a state it can never publish from.
		if (!(await this.clearTheWay())) {
			return;
		}

		const code = formatRingCode(generateRingSecret());

		// Before anything is offered a server: a new code is a new vault, and an
		// old registration left standing against it is a device talking to a vault
		// whose key no longer exists.
		this.plugin.ringLink.ringChanged();

		// The server comes first, so that the very first code shown already carries
		// its address. A code handed out before the server exists carries none, and
		// every device that joins with it is stranded — which is not something the
		// person handing it out can see.
		const outcome = await this.plugin.ringLink.setUpServer(code);
		if (outcome === 'cancelled') {
			new Notice(t('ring.notice.createCancelled'));
			return;
		}

		await this.patchSettings({
			code,
			role: 'host',
			hostId: this.settings.deviceId,
			lastPublishedSeq: 0,
			lastAppliedSeq: 0,
		});

		await this.publish();
		this.refreshUi();
		this.showCode();
	}

	/**
	 * Offers to move a ring file this device cannot use out of the way.
	 *
	 * Returns true when the path is clear afterwards. The file goes to the trash
	 * rather than being overwritten: it is another ring's only copy of itself, and
	 * a device that has never been in that ring has no business destroying it.
	 */
	private async clearTheWay(kind: 'foreign' | 'corrupt' = 'foreign'): Promise<boolean> {
		const file = this.ringFile();
		if ((await file.read()).status === 'absent') {
			return true;
		}

		if (!(await RingFileConflictModal.ask(this.app, { path: file.path, kind }))) {
			return false;
		}

		if (!(await file.trashExisting())) {
			new Notice(t('ring.notice.ringFileBusy', { path: file.path }));
			return false;
		}

		new Notice(t('ring.notice.replacedRingFile', { path: file.path }));
		return true;
	}

	private promptJoin(): void {
		new JoinRingModal(this.app, (code) => this.join(code)).open();
	}

	private async join(rawCode: string): Promise<void> {
		let secret: Bytes;
		let address;
		try {
			({ secret, address } = parseJoinCode(rawCode));
		} catch (error) {
			new Notice(
				error instanceof UnsupportedJoinCodeError
					? t('ring.notice.newerCode')
					: t('ring.notice.invalidCode')
			);
			return;
		}

		// Announced only once the code is stored, never before: the sync module
		// answers an announcement by trying to reach the server, and the token it
		// needs for that is derived from the code it would not have yet.
		const announceAddress = (): void => {
			if (address) {
				this.plugin.ringLink.announce({ serverUrl: addressToUrl(address) });
			}
		};

		// A different code is a different vault, so anything this device thought it
		// had on the old one goes before the new one is adopted.
		this.plugin.ringLink.ringChanged();
		this.lastSeen = undefined;

		const state = await this.ringFile().read();

		if (state.status === 'unreadable') {
			new Notice(state.message);
			return;
		}

		if (state.status === 'absent') {
			// Joining must not depend on the sync having already run. The snapshot
			// travels through whatever sync the vault uses, and on a phone that is
			// routinely seconds or minutes behind — refusing to join until it lands
			// makes the ring look broken when it is merely waiting. So the code is
			// remembered now and checked against the snapshot the moment it arrives.
			await this.patchSettings({
				code: formatRingCode(secret),
				role: 'client',
				hostId: null,
				lastAppliedSeq: 0,
			});
			// This is the whole point of the address travelling in the code: there is
			// no snapshot here yet, and with the address there does not need to be.
			// The device reaches the server and pulls the vault, ring file included.
			announceAddress();
			void this.refreshFileVerdict();
			this.refreshUi();
			new Notice(
				address
					? t('ring.notice.joinedWithServer')
					: t('ring.notice.joinedWaiting', { path: this.ringFile().path })
			);
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
		// The snapshot wins when it has an address of its own; the code only fills
		// the gap left by a host that had no server when it last published. One
		// announcement either way, because each one sets a claim going.
		if (snapshot.sync?.serverUrl) {
			this.announce(snapshot);
		} else {
			announceAddress();
		}

		this.refreshUi();
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
		this.fileVerdict = undefined;
		this.lastSeen = undefined;
		// The vault id and every key came out of the code that just went away. A
		// sync still calling itself registered would be talking to a vault it can
		// no longer open, which arrives as an error about something else entirely.
		this.plugin.ringLink.ringChanged();
		this.refreshUi();
		new Notice(t('ring.notice.left'));
	}

	private showCode(): void {
		const ringCode = this.settings.code;
		if (!ringCode) {
			new Notice(t('ring.notice.notInRing'));
			return;
		}
		new ShowCodeModal(this.app, { ringCode, ...this.joinCode(ringCode) }).open();
	}

	/**
	 * The code to type on the next device: the ring code with the server address
	 * packed onto the end, when there is one that fits.
	 *
	 * The address is the one thing a joining device cannot work out for itself.
	 * Every key it needs comes from the secret, but where to send them lives in
	 * the snapshot — and the snapshot only arrives once something has synced.
	 * Carrying it here is what lets a phone reach the server before it holds a
	 * single file of the vault.
	 */
	private joinCode(ringCode: string): {
		joinCode: string;
		missing?: MissingAddress;
		url?: string;
	} {
		const url = this.plugin.ringLink.contribution().serverUrl;
		if (!url) {
			// Only a shortcoming if something was going to fill it in. A ring that
			// keeps plugins in step and wants no server is complete as it is.
			return this.plugin.ringLink.isServerExpected()
				? { joinCode: ringCode, missing: 'noServer' }
				: { joinCode: ringCode };
		}

		const address = addressFromUrl(url);
		if (!address) {
			return { joinCode: ringCode, missing: 'notEncodable', url };
		}

		try {
			return { joinCode: formatJoinCode(parseRingCode(ringCode), address) };
		} catch {
			return { joinCode: ringCode, missing: 'notEncodable', url };
		}
	}

	// --- host ---------------------------------------------------------------

	/**
	 * Writes the ring file. Returns whether it actually got written.
	 *
	 * Every failure here is reported. Silence would be the worst outcome: the ring
	 * exists in this device's settings either way, so a publish that threw would
	 * leave a host convinced it had a ring while the other devices find no file to
	 * join — which is exactly how it looks from the phone.
	 */
	private async publish(host?: { id: string; name: string }): Promise<boolean> {
		// Whatever happens below, the panel should end up describing the file as it
		// is now rather than as it was before the button was pressed.
		try {
			return await this.publishOnce(host);
		} finally {
			void this.refreshFileVerdict();
		}
	}

	private async publishOnce(hostOverride?: { id: string; name: string }): Promise<boolean> {
		const secret = this.secret();
		if (!secret || !this.api) {
			new Notice(t('ring.notice.notInRing'));
			return false;
		}
		if (this.settings.role !== 'host') {
			new Notice(t('ring.notice.notHost'));
			return false;
		}

		const file = this.ringFile();
		const state = await file.read();

		if (state.status === 'unreadable') {
			// Half-written files are ordinary: a sync client can easily be caught
			// mid-write. Waiting is the right answer, not a dialog.
			new Notice(t('ring.notice.retryLater', { message: state.message }));
			return false;
		}

		let base = this.settings.lastPublishedSeq;

		if (state.status === 'ok') {
			const verdict = await classifyRingFile(state, secret);

			// A file belonging to another ring, or one of ours that will not open, is
			// not a race — nobody is going to resolve it by waiting. Without a way
			// past it the host could never publish again, which is exactly how it
			// looks from the other devices: a ring that exists and has no file.
			if (verdict !== 'ours') {
				if (!(await this.clearTheWay(verdict === 'foreign' ? 'foreign' : 'corrupt'))) {
					return false;
				}
				base = 0;
			} else {
				const current = await this.decrypt(secret, state.envelope);
				if (!current) {
					return false;
				}

				// Optimistic concurrency: if the file moved on since we last wrote it,
				// another device has been publishing. Stop rather than overwrite it —
				// unless the snapshot names this device as the host, in which case the
				// file is our own work and the settings are what fell behind, after a
				// reinstall or a lost data.json.
				if (current.seq !== base) {
					if (current.host.id !== this.settings.deviceId) {
						new Notice(t('ring.notice.raced', { host: current.host.name }));
						return false;
					}
					base = current.seq;
				}
			}
		}

		const seq = base + 1;
		let count: number;
		try {
			const snapshot = await buildSnapshot(this.app, this.api, {
				selfId: this.plugin.manifest.id,
				excludedIds: this.settings.excludedIds,
				host: hostOverride ?? { id: this.settings.deviceId, name: this.deviceName() },
				seq,
				// Whatever the sync module has put in — the ring itself knows nothing
				// about servers, it only carries what it is given.
				sync: this.plugin.ringLink.contribution(),
				removed: this.settings.removedIds,
			});
			await file.write(await sealSnapshot(secret, snapshot));
			count = snapshot.plugins.length;
		} catch (error) {
			console.error('Toolbox: could not write the ring file.', error);
			new Notice(
				t('ring.notice.publishFailed', {
					path: file.path,
					message: error instanceof Error ? error.message : String(error),
				})
			);
			return false;
		}

		await this.patchSettings({ lastPublishedSeq: seq });
		this.refreshUi();
		new Notice(t('ring.notice.published', { count }));
		return true;
	}

	// --- client -------------------------------------------------------------

	/**
	 * What a client does when the ring file appears, changes, or is looked for.
	 *
	 * Everything here is reached without anybody pressing anything — at startup
	 * and on every write to that path — so the bar for saying something out loud
	 * is high. A file that has not arrived yet is the ordinary state of a device
	 * that joined a minute ago; the panel says so for as long as it is true, and
	 * a notice would say it again on every start and every write forever.
	 */
	private async notifyIfNewer(): Promise<void> {
		const state = await this.ringFile().read();
		void this.refreshFileVerdict();

		if (state.status !== 'ok') {
			return;
		}

		// The vault sync writes the ring file like any other file, and every write
		// raises an event that lands here. Without this, reading the file leads to
		// announcing it, which leads to a sync, which writes it again.
		if (state.envelope.data === this.lastSeen) {
			return;
		}
		this.lastSeen = state.envelope.data;

		const secret = this.secret();
		if (!secret) {
			return;
		}

		// The one outcome worth interrupting for: a code that does not match the
		// ring will never catch up on its own, and no amount of waiting fixes it.
		// Once per session, because it is a fact rather than an event.
		if (state.envelope.ring !== (await deriveRingId(secret))) {
			if (!this.warnedAboutMismatch) {
				this.warnedAboutMismatch = true;
				new Notice(t('ring.notice.codeMismatch'));
			}
			return;
		}

		const snapshot = await this.decrypt(secret, state.envelope, true);
		if (!snapshot) {
			return;
		}
		this.announce(snapshot);
		await this.applyMembership(snapshot);
		void this.refreshDevices();

		// Seeing the host's snapshot is what "waiting for the host" was waiting
		// for. It used to end only when a plugin change was applied, which for a
		// ring with nothing to change never happened — so the device went on
		// describing itself as waiting for something that had already arrived.
		if (this.settings.hostId === null) {
			await this.patchSettings({ hostId: snapshot.host.id });
		}

		if (snapshot.seq > this.settings.lastAppliedSeq) {
			new Notice(t('ring.notice.hasChanges'));
		}
		this.refreshUi();
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
			canInstall: this.canInstall(),
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
			return { applied: [], installed: [], failed: [], complete: false };
		}

		const selfId = this.plugin.manifest.id;
		const plans = planApply(items, snapshot, { selfId });
		const api = this.api;
		const result = await applyPlans(
			{
				app: this.app,
				api,
				selfId,
				install: this.canInstall()
					? (request) => installPlugin({ api, catalog: this.catalog }, request)
					: undefined,
			},
			plans
		);

		// Only a clean run counts as caught up. Recording it otherwise would hide
		// the remaining differences behind an empty diff.
		if (result.complete) {
			await this.patchSettings({ lastAppliedSeq: snapshot.seq, hostId: snapshot.host.id });
			this.refreshUi();
		}
		return result;
	}

	// --- helpers ------------------------------------------------------------

	/** Both the user's choice and whether this Obsidian can do it at all. */
	private canInstall(): boolean {
		return this.settings.installMissing && this.api?.canInstall() === true;
	}

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
				new Notice(
					state.status === 'absent'
						? t('ring.notice.noRingFile', { path: this.ringFile().path })
						: state.message
				);
			}
			return undefined;
		}

		// A file from a different ring is not a damaged file, and saying "altered"
		// about it sends the reader looking for tampering instead of for the
		// leftover it actually is. The ring id decides, and it is in the clear.
		if (state.envelope.ring !== (await deriveRingId(secret))) {
			if (!options.quiet) {
				new Notice(
					this.settings.role === 'host'
						? t('ring.notice.foreignFileHost', { path: this.ringFile().path })
						: t('ring.notice.codeMismatch')
				);
			}
			return undefined;
		}

		const snapshot = await this.decrypt(secret, state.envelope, options.quiet);
		if (snapshot) {
			this.announce(snapshot);
			await this.applyMembership(snapshot);
		}
		return snapshot;
	}

	/**
	 * Passes on what the snapshot says about the shared server.
	 *
	 * Only from snapshots a client reads. The host's own publish path decrypts the
	 * file too, to check nobody else has written it, and telling this device what
	 * it just said itself would be a small loop with nothing at the end of it.
	 */
	private announce(snapshot: RingSnapshot): void {
		this.plugin.ringLink.announce({ serverUrl: snapshot.sync?.serverUrl });
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

	private fileVerdict: RingFileVerdict | undefined;
	/** The roster, as last read. The panel draws from this rather than the disk. */
	private devices: DeviceHealth[] = [];
	/** The ciphertext last read, so an unchanged file is not read again. */
	private lastSeen: string | undefined;
	/** A mismatched code is a fact, not an event: worth saying once per session. */
	private warnedAboutMismatch = false;

	private ringFile(): RingFile {
		return new RingFile(this.app, this.settings.ringFilePath || DEFAULT_SETTINGS.ringFilePath);
	}

	private deviceName(): string {
		return (
			this.settings.deviceName.trim() ||
			(Platform.isMobile ? t('ring.device.mobile') : t('ring.device.desktop'))
		);
	}

	// --- the roster ---------------------------------------------------------

	private roster(): DeviceRoster {
		const path = this.ringFile().path;
		const slash = path.lastIndexOf('/');
		return new DeviceRoster(this.app, `${slash < 0 ? '' : path.slice(0, slash)}/devices`);
	}

	/** Writes this device into the roster. Its own file, so nothing can conflict. */
	private async beat(): Promise<void> {
		if (this.settings.role === null) {
			return;
		}
		try {
			await this.roster().write({
				deviceId: this.settings.deviceId,
				deviceName: this.deviceName(),
				updatedAt: new Date().toISOString(),
				role: this.settings.role,
				version: this.plugin.manifest.version,
			});
		} catch (error) {
			console.error('Toolbox: could not write this device into the ring roster.', error);
		}
	}

	/** Re-reads the roster for the panel. Cheap: a handful of small JSON files. */
	private async refreshDevices(): Promise<void> {
		if (this.settings.role === null) {
			this.devices = [];
			this.refreshPanel();
			return;
		}

		this.devices = buildRoster(await this.roster().readAll(), {
			now: new Date(),
			staleAfterMinutes: STALE_AFTER_MINUTES,
			selfId: this.settings.deviceId,
			hostId: this.settings.role === 'host' ? this.settings.deviceId : this.settings.hostId,
		});
		this.refreshPanel();
	}

	/**
	 * What a snapshot says about this device's own membership.
	 *
	 * Both answers are cooperative, and deliberately so. Removal is a message,
	 * not a lock: the ring code is the key, and a device that keeps it can still
	 * read everything. What it buys is a device that stops syncing when told to,
	 * which is the ordinary case — an old laptop, a phone that was replaced.
	 */
	private async applyMembership(snapshot: RingSnapshot): Promise<void> {
		if (snapshot.removed?.includes(this.settings.deviceId) === true) {
			await this.patchSettings({
				code: null,
				role: null,
				hostId: null,
				lastAppliedSeq: 0,
				lastPublishedSeq: 0,
			});
			this.lastSeen = undefined;
			this.plugin.ringLink.ringChanged();
			this.refreshUi();
			new Notice(t('ring.notice.removedFromRing', { host: snapshot.host.name }));
			return;
		}

		// The host handed the ring over. Only the named device may take it, and it
		// takes it by publishing next — the seq in the file is already ours to
		// continue from, which the publish path works out on its own.
		if (snapshot.host.id === this.settings.deviceId && this.settings.role !== 'host') {
			await this.patchSettings({ role: 'host', hostId: this.settings.deviceId });
			this.refreshUi();
			new Notice(t('ring.notice.becameHost'));
		}
	}

	private async ensureDeviceIdentity(): Promise<void> {
		const patch: Partial<PluginRingSettings> = {};
		if (!this.settings.deviceId) {
			patch.deviceId = crypto.randomUUID();
		}
		// A roster of three devices all called "Desktop" is a list nobody can act
		// on, and acting on it is what it is for.
		if (!this.settings.deviceName.trim()) {
			patch.deviceName = randomDeviceName();
		}
		if (Object.keys(patch).length > 0) {
			await this.patchSettings(patch);
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
	enabledByDefault: true,
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

/** How long ago a device was last here, in words. */
function describeSeen(device: DeviceHealth): string {
	if (device.isSelf) {
		return t('ring.device.now');
	}
	if (device.ageMinutes === undefined) {
		return t('ring.device.unknownTime');
	}
	if (device.ageMinutes < 2) {
		return t('ring.device.now');
	}
	if (device.ageMinutes < 60) {
		return t('ring.device.minutes', { count: device.ageMinutes });
	}
	const hours = Math.floor(device.ageMinutes / 60);
	return hours < 24
		? t('ring.device.hours', { count: hours })
		: t('ring.device.days', { count: Math.floor(hours / 24) });
}
