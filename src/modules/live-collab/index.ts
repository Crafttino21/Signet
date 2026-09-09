import type { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import { MarkdownView, Notice, Platform, Setting } from 'obsidian';
import type { TFile } from 'obsidian';
import { CollabEditorBinding } from './editor-binding';
import {
	deriveAuthToken,
	deriveContentKey,
	deriveNameKey,
	deriveRoomId,
	deriveVaultId,
	parseRingCode,
} from '@toolbox/protocol';
import type { Bytes } from '@toolbox/protocol';
import { ToolboxModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type ToolboxPlugin from '../../main';
import { t } from '../../i18n';
import { CollabSession } from './session';

/**
 * Editing the same note at the same time as someone else.
 *
 * The file sync can only ever keep both versions when two people change one note;
 * a CRDT merges them into one text instead. That is the whole difference, and it
 * is why this exists beside the sync rather than replacing it — most notes are
 * only ever touched by one device, and moving whole files is far cheaper.
 *
 * A session lives for as long as a note is open. Finding the editor showing a
 * note goes through `editor-binding.ts`, which uses only what Obsidian exports —
 * no internal properties.
 */

type LiveCollabSettings = {
	/** Off by default: it holds a socket open and changes how a note is saved. */
	enabled: boolean;
	/** Notes matching these folders are never collaborated on. */
	excludedFolders: string[];
};

const DEFAULT_SETTINGS: LiveCollabSettings = {
	enabled: true,
	excludedFolders: [],
};

const RING_MODULE_ID = 'plugin-ring';
const SYNC_MODULE_ID = 'vault-sync';

/** How long after the last keystroke the document is written back to the file. */
const FLUSH_MS = 2_000;

interface RingSettings {
	code?: unknown;
	deviceName?: unknown;
}

interface SyncSettings {
	serverUrl?: unknown;
	registered?: unknown;
}

class LiveCollabModule extends ToolboxModule<LiveCollabSettings> {
	/** One session per open note, keyed by vault path. */
	private readonly sessions = new Map<string, CollabSession>();
	/** Editors currently on screen, so a session can find the one to bind. */
	private readonly editors = new Map<EditorView, string>();
	private readonly binding = new CollabEditorBinding({
		attach: (path, view) => {
			this.editors.set(view, path);
			void this.attachToPath(path);
		},
		detach: (view) => {
			this.editors.delete(view);
		},
	});
	private flushTimer: number | undefined;

	override onload(): void {
		// The extension starts empty and is reconfigured per editor once a session
		// exists for the note it is showing.
		this.plugin.registerEditorExtension(this.binding.extension());

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				void this.attachToActive();
			})
		);
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				void this.attachToActive();
			})
		);

		// A session that outlives its note would keep writing to a file nobody has
		// open, so closing the last view holding a note ends it.
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.endOrphanedSessions();
			})
		);

		this.register(() => {
			this.endAll();
		});

		this.app.workspace.onLayoutReady(() => void this.attachToActive());
	}

	override onDisable(): void {
		this.endAll();
	}

	// --- panel and settings -------------------------------------------------

	override displayPanel(containerEl: HTMLElement): void {
		containerEl.createEl('h3', { text: t('collab.panel.title') });

		if (!this.ready()) {
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state',
				text: t('collab.panel.needsSync'),
			});
			return;
		}

		const live = [...this.sessions.entries()];
		if (live.length === 0) {
			containerEl.createEl('p', {
				cls: 'toolbox-panel__state',
				text: t('collab.panel.idle'),
			});
			return;
		}

		const list = containerEl.createEl('ul', { cls: 'toolbox-sync__list' });
		for (const [path, session] of live) {
			const row = list.createEl('li', { cls: 'toolbox-sync__row' });
			row.createSpan({ cls: 'toolbox-sync__name', text: path });
			row.createSpan({
				cls: session.connected ? 'toolbox-sync__meta' : 'toolbox-sync__warn',
				text: session.connected
					? session.peers === 0
						? t('collab.panel.alone')
						: t('collab.panel.peers', { count: session.peers })
					: t('collab.panel.offline'),
			});
		}
	}

	override displaySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('collab.settings.enabled'))
			.setDesc(t('collab.settings.enabledDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.enabled).onChange(async (value) => {
					await this.patchSettings({ enabled: value });
					if (!value) {
						this.endAll();
					} else {
						void this.attachToActive();
					}
					this.refreshPanel();
				})
			);

		const advanced = advancedSection(containerEl);
		new Setting(advanced)
			.setName(t('collab.settings.excluded'))
			.setDesc(t('collab.settings.excludedDesc'))
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
	}

	// --- sessions -----------------------------------------------------------

	private async attachToActive(): Promise<void> {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (file) {
			await this.attachToPath(file.path);
		}
	}

	/** Opens a session for this note if it should have one, and binds its editor. */
	private async attachToPath(path: string): Promise<void> {
		if (!this.settings.enabled || !this.ready() || this.isExcluded(path)) {
			return;
		}

		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			return;
		}

		try {
			const session = this.sessions.get(path) ?? (await this.open(file));
			for (const [view, shown] of this.editors) {
				if (shown === path) {
					this.binding.bind(
						view,
						yCollab(session.text, session.awareness, { undoManager: false })
					);
				}
			}
		} catch (error) {
			console.error('Toolbox: could not start a collaborative session.', error);
			new Notice(t('collab.notice.failed'));
		}
	}

	private async open(file: TFile): Promise<CollabSession> {
		const context = await this.context();
		if (!context) {
			throw new Error('Not configured.');
		}

		const session = new CollabSession({
			path: file.path,
			serverUrl: context.serverUrl,
			vaultId: context.vaultId,
			roomId: await deriveRoomId(context.nameKey, file.path),
			token: context.token,
			contentKey: context.contentKey,
			secret: context.secret,
			deviceName: context.deviceName,
			readFile: () => this.app.vault.read(file),
			onStatus: () => {
				this.refreshPanel();
			},
			onError: (error) => {
				console.error('Toolbox: collaboration error.', error);
			},
		});

		this.sessions.set(file.path, session);
		// From here the session owns the file, and the vault sync leaves it alone.
		this.plugin.liveEditing.claim(file.path);
		session.start();

		session.doc.on('update', () => {
			this.scheduleFlush();
		});

		this.refreshPanel();
		return session;
	}

	private endOrphanedSessions(): void {
		const open = new Set<string>();
		this.app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) {
				open.add(view.file.path);
			}
		});

		for (const path of [...this.sessions.keys()]) {
			if (!open.has(path)) {
				this.end(path);
			}
		}
	}

	private end(path: string): void {
		const session = this.sessions.get(path);
		if (!session) {
			return;
		}

		// Write what the room produced back to the file before letting go, so the
		// note on disk is the merged text rather than whatever this device last
		// typed on its own.
		for (const [view, shown] of this.editors) {
			if (shown === path) {
				this.binding.unbind(view);
			}
		}

		void this.flushOne(path, session).finally(() => {
			session.destroy();
			this.sessions.delete(path);
			this.plugin.liveEditing.release(path);
			this.refreshPanel();
		});
	}

	private endAll(): void {
		for (const path of [...this.sessions.keys()]) {
			this.end(path);
		}
	}

	// --- writing back -------------------------------------------------------

	private scheduleFlush(): void {
		if (this.flushTimer !== undefined) {
			window.clearTimeout(this.flushTimer);
		}
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = undefined;
			void this.flushAll();
		}, FLUSH_MS);
	}

	private async flushAll(): Promise<void> {
		for (const [path, session] of this.sessions) {
			await this.flushOne(path, session);
		}
	}

	/**
	 * Writes a session's text to its file.
	 *
	 * Only when it actually differs: an identical write would still bump the
	 * modification time, which the sync reads as a change and would turn every
	 * keystroke into a commit.
	 */
	private async flushOne(path: string, session: CollabSession): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			return;
		}

		try {
			const contents = session.contents();
			if ((await this.app.vault.read(file)) !== contents) {
				await this.app.vault.modify(file, contents);
			}
		} catch (error) {
			console.error(`Toolbox: could not write ${path} back to disk.`, error);
		}
	}

	// --- wiring -------------------------------------------------------------

	private isExcluded(path: string): boolean {
		return this.settings.excludedFolders.some(
			(folder) => folder !== '' && (path === folder || path.startsWith(`${folder}/`))
		);
	}

	private ring(): { code: string; deviceName: string } | undefined {
		const ring = this.plugin.settings.moduleSettings[RING_MODULE_ID] as
			RingSettings | undefined;
		if (typeof ring?.code !== 'string' || !ring.code) {
			return undefined;
		}
		return {
			code: ring.code,
			deviceName:
				typeof ring.deviceName === 'string' && ring.deviceName.trim()
					? ring.deviceName.trim()
					: Platform.isMobile
						? t('ring.device.mobile')
						: t('ring.device.desktop'),
		};
	}

	private sync(): { serverUrl: string } | undefined {
		const sync = this.plugin.settings.moduleSettings[SYNC_MODULE_ID] as
			SyncSettings | undefined;
		if (typeof sync?.serverUrl !== 'string' || !sync.serverUrl || sync.registered !== true) {
			return undefined;
		}
		return { serverUrl: sync.serverUrl };
	}

	/** Collaboration rides on the same ring and the same server as the sync. */
	private ready(): boolean {
		return this.ring() !== undefined && this.sync() !== undefined;
	}

	private async context(): Promise<
		| {
				serverUrl: string;
				vaultId: string;
				token: string;
				contentKey: CryptoKey;
				nameKey: Bytes;
				secret: Bytes;
				deviceName: string;
		  }
		| undefined
	> {
		const ring = this.ring();
		const sync = this.sync();
		if (!ring || !sync) {
			return undefined;
		}

		const secret = parseRingCode(ring.code);
		return {
			serverUrl: sync.serverUrl,
			vaultId: await deriveVaultId(secret),
			token: await deriveAuthToken(secret),
			contentKey: await deriveContentKey(secret),
			nameKey: await deriveNameKey(secret),
			secret,
			deviceName: ring.deviceName,
		};
	}
}

export const liveCollabModule: ModuleDescriptor<LiveCollabSettings> = {
	id: 'live-collab',
	get name() {
		return t('collab.name');
	},
	get description() {
		return t('collab.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new LiveCollabModule(plugin, liveCollabModule),
};
