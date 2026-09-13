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
} from '@signet/protocol';
import type { Bytes } from '@signet/protocol';
import { SignetModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import { advancedSection } from '../../core/settings-ui';
import type SignetPlugin from '../../main';
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

/** Whether the vault sync has a server that has answered for this vault. */
function isSyncRegistered(plugin: SignetPlugin): boolean {
	const sync = plugin.settings.moduleSettings[SYNC_MODULE_ID] as SyncSettings | undefined;
	return sync?.registered === true && typeof sync.serverUrl === 'string' && sync.serverUrl !== '';
}

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

class LiveCollabModule extends SignetModule<LiveCollabSettings> {
	/** One session per open note, keyed by vault path. */
	private readonly sessions = new Map<string, CollabSession>();
	/**
	 * Sessions being opened right now.
	 *
	 * Opening one awaits the key derivations, and `file-open`, `active-leaf-change`
	 * and the editor announcing itself all arrive within that window for the same
	 * note. Without this each of them started a session of its own: two sockets,
	 * two documents and two writers for one file, with only the last one findable.
	 */
	private readonly opening = new Map<string, Promise<CollabSession>>();
	/** Paths whose room has not answered yet, for what the panel says. */
	private readonly connecting = new Set<string>();
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

	/**
	 * What live editing is doing, for the shared panel.
	 *
	 * Joining a room takes a moment, and until it is done the note is an ordinary
	 * note — nobody else's cursor, nothing shared. That is a state rather than an
	 * event, so it is said here rather than in a notice, and it is what explains
	 * the pause between opening a note and the others appearing in it.
	 */
	override displayPanel(containerEl: HTMLElement): void {
		if (!this.settings.enabled) {
			return;
		}

		containerEl.createEl('h3', { text: t('collab.panel.title') });

		if (!this.ready()) {
			containerEl.createEl('p', {
				cls: 'signet-panel__state',
				text: t('collab.panel.needsSync'),
			});
			return;
		}

		if (this.connecting.size > 0) {
			containerEl.createEl('p', {
				cls: 'signet-panel__state',
				text: t('collab.panel.connecting', { count: this.connecting.size }),
			});
		}

		const joined = [...this.sessions].filter(([path]) => !this.connecting.has(path));
		if (joined.length === 0) {
			if (this.connecting.size === 0) {
				containerEl.createEl('p', {
					cls: 'signet-panel__state',
					text: t('collab.panel.idle'),
				});
			}
			return;
		}

		const list = containerEl.createDiv({ cls: 'signet-panel__list' });
		for (const [path, session] of joined) {
			const row = list.createDiv({ cls: 'signet-panel__row' });
			row.createSpan({ cls: 'signet-panel__name', text: path });
			row.createSpan({
				cls: 'signet-panel__meta',
				text: !session.connected
					? t('collab.panel.offline')
					: session.peers === 0
						? t('collab.panel.alone')
						: t('collab.panel.peers', { count: session.peers }),
			});
		}
	}

	// --- sessions -----------------------------------------------------------

	private async attachToActive(): Promise<void> {
		const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
		if (file) {
			await this.attachToPath(file.path);
		}
	}

	/**
	 * Opens a session for this note if it should have one, and binds its editor.
	 *
	 * Binding waits for the session to be seeded, and that wait is the whole point.
	 * An editor bound to a document that is not the note yet is shown the note
	 * arriving as an edit — the text appears twice and every remote change after it
	 * lands at the wrong place, until a write-back to disk hides the damage. So the
	 * order is: wait, correct the buffer, then bind.
	 */
	private async attachToPath(path: string): Promise<void> {
		if (!this.settings.enabled || !this.ready() || this.isExcluded(path)) {
			return;
		}

		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			return;
		}

		try {
			const session = this.sessions.get(path) ?? (await this.openOnce(file));
			if (!session.isSeeded) {
				this.connecting.add(path);
				this.refreshPanel();
				await session.whenSeeded;
				this.connecting.delete(path);
				this.refreshPanel();
			}

			// The session may have been ended while we were waiting — the note
			// closed, the module switched off — and binding to a destroyed document
			// would leave an editor following nothing.
			if (this.sessions.get(path) !== session) {
				return;
			}

			const text = session.contents();
			for (const [view, shown] of this.editors) {
				// `shown` is re-read now rather than before the wait: the user can have
				// moved on to another note in the meantime.
				if (shown !== path || this.binding.isBoundTo(view, session)) {
					continue;
				}
				this.binding.syncDoc(view, text);
				this.binding.bind(
					view,
					yCollab(session.text, session.awareness, { undoManager: false }),
					session
				);
			}
		} catch (error) {
			this.connecting.delete(path);
			console.error('Signet: could not start a collaborative session.', error);
			new Notice(t('collab.notice.failed'));
		}
	}

	/**
	 * {@link open}, but never twice at once for the same note.
	 *
	 * The entry is removed as soon as the session is in `sessions`, so this holds
	 * nothing between opens and a failed attempt can be retried.
	 */
	private async openOnce(file: TFile): Promise<CollabSession> {
		const pending = this.opening.get(file.path);
		if (pending) {
			return pending;
		}

		const started = this.open(file).finally(() => {
			this.opening.delete(file.path);
		});
		this.opening.set(file.path, started);
		return started;
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
			readCurrent: () => this.currentText(file),
			onStatus: () => {
				this.refreshPanel();
			},
			onError: (error) => {
				console.error('Signet: collaboration error.', error);
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

	/**
	 * The note as the user currently sees it.
	 *
	 * An editor showing this file is more current than the file: nothing has been
	 * written back yet for whatever was typed since it was opened, and seeding the
	 * room from disk would quietly drop those characters.
	 */
	private async currentText(file: TFile): Promise<string> {
		for (const [view, shown] of this.editors) {
			if (shown === file.path) {
				return view.state.doc.toString();
			}
		}
		return this.app.vault.read(file);
	}

	private end(path: string): void {
		this.connecting.delete(path);
		const session = this.sessions.get(path);
		if (!session) {
			return;
		}

		// Taken out of the map first, so that ending is done as far as anyone
		// asking is concerned. An attach still waiting for this session to be
		// seeded looks here to find out whether it is still the current one, and
		// the write-back below takes long enough for that to matter.
		this.sessions.delete(path);

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
			// Released only once the file has been written: until then the sync must
			// keep its hands off a note that is still being saved.
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
			// `process` rather than read-then-modify: it is the documented way to edit
			// a file nobody is looking at, and it closes the gap in which a sync could
			// land between the two halves of the old version.
			await this.app.vault.process(file, (data) => (data === contents ? data : contents));
		} catch (error) {
			console.error(`Signet: could not write ${path} back to disk.`, error);
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
	// It relays keystrokes through the sync server, so it is worth offering only
	// once this device has one that answers. Before that it could only explain
	// itself as unavailable, which is a worse thing to read than nothing.
	available: (plugin) => isSyncRegistered(plugin),
	enabledByDefault: false,
	enableWhenAvailable: true,
	get name() {
		return t('collab.name');
	},
	get description() {
		return t('collab.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: SignetPlugin) => new LiveCollabModule(plugin, liveCollabModule),
};
