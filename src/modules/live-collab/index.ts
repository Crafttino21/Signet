import type { EditorView } from '@codemirror/view';
import { yCollab } from 'y-codemirror.next';
import { MarkdownView, Notice, normalizePath, Platform, Setting } from 'obsidian';
import type { TFile } from 'obsidian';
import type { Extension } from '@codemirror/state';
import { CollabEditorBinding } from './editor-binding';
import { authorship } from './authorship';
import { otherAuthors } from './authors';
import { RoomBaseStore } from './base-store';
import type { RoomBase } from './base-store';
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
import { isUsableServerUrl } from '../../core/server-url';
import { conflictPath } from '../../core/conflict-path';
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
	/** Tint the text other devices wrote in their colour. */
	showAuthors: boolean;
};

const DEFAULT_SETTINGS: LiveCollabSettings = {
	enabled: true,
	excludedFolders: [],
	showAuthors: true,
};

const RING_MODULE_ID = 'plugin-ring';
const SYNC_MODULE_ID = 'vault-sync';

/** Whether the vault sync has a server that has answered for this vault. */
function isSyncRegistered(plugin: SignetPlugin): boolean {
	const sync = plugin.settings.moduleSettings[SYNC_MODULE_ID] as SyncSettings | undefined;
	return sync?.registered === true && typeof sync.serverUrl === 'string' && sync.serverUrl !== '';
}

/** How long after the last keystroke the document is written back to the file. */
/**
 * How long the same failure stays said.
 *
 * Long enough that switching between tabs does not repeat it, short enough
 * that somebody fixing the address finds out whether it worked.
 */
const REPORT_EVERY_MS = 30_000;

const FLUSH_MS = 2_000;

interface RingSettings {
	code?: unknown;
	deviceId?: unknown;
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
	/**
	 * Paths whose room has not answered for long enough to say so. The note is an
	 * ordinary note meanwhile and is merged once the room is there.
	 */
	private readonly waiting = new Set<string>();
	/** Where each session's base is remembered, when this device can have one. */
	private readonly baseStores = new WeakMap<
		CollabSession,
		{ store: RoomBaseStore; roomId: string }
	>();
	/** Editors currently on screen, so a session can find the one to bind. */
	private readonly editors = new Map<EditorView, string>();
	private readonly binding = new CollabEditorBinding({
		attach: (path, view) => {
			this.editors.set(view, path);
			this.detach(this.attachToPath(path));
		},
		detach: (view) => {
			this.editors.delete(view);
		},
	});
	private flushTimer: number | undefined;

	/**
	 * Starts an attach nobody is waiting on.
	 *
	 * `attachToPath` reports its own failures, so the rejection carries nothing
	 * new by the time it gets here — but left as a bare `void` it is an unhandled
	 * rejection on a path that runs on every note anybody opens.
	 */
	private detach(run: Promise<void>): void {
		void run.catch(() => undefined);
	}

	override onload(): void {
		// The extension starts empty and is reconfigured per editor once a session
		// exists for the note it is showing.
		//
		// Into a slot that outlives this module rather than registered here:
		// `registerEditorExtension` cannot be undone, so registering on every
		// `onload` leaves one behind per switch-off, each still holding the
		// callbacks of an instance that has been torn down. Filling and emptying a
		// stable array is what `obsidian.d.ts` names as the supported way to change
		// an editor extension at runtime.
		const slot = this.plugin.editorExtensionSlot('live-collab');
		slot.length = 0;
		slot.push(this.binding.extension());

		// Applied to editors that are already open. Without this the extension
		// reaches nothing until every note is reopened: switching the module on by
		// hand looked like it had worked, opened sessions and claimed paths, while
		// binding no editor at all and taking those notes out of the file sync.
		this.app.workspace.updateOptions();
		this.register(() => {
			slot.length = 0;
			this.app.workspace.updateOptions();
		});

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.detach(this.attachToActive());
			})
		);
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				this.detach(this.attachToActive());
			})
		);

		// A session that outlives its note would keep writing to a file nobody has
		// open, so closing the last view holding a note ends it.
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.endOrphanedSessions();
			})
		);

		// A rename moves the note out from under its session: the room id is
		// derived from the path, the session is keyed by it, and the claim is held
		// under it. Left alone, the editor stays bound to a document that is about
		// to be destroyed and the claim is never given back.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!this.sessions.has(oldPath)) {
					return;
				}
				this.end(oldPath);
				for (const [view, shown] of this.editors) {
					if (shown === oldPath) {
						this.editors.set(view, file.path);
					}
				}
				this.detach(this.attachToPath(file.path));
			})
		);

		this.register(() => {
			// The timer is a raw `setTimeout`, so without this it survives the module
			// and fires against a map that has just been emptied.
			this.cancelFlush();
			this.endAll();
		});

		this.addCommand({
			id: 'toggle-authors',
			name: t('collab.command.toggleAuthors'),
			callback: () => {
				void this.setShowAuthors(!this.settings.showAuthors);
			},
		});

		this.app.workspace.onLayoutReady(() => this.detach(this.attachToActive()));
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
						this.detach(this.attachToActive());
					}
					this.refreshPanel();
				})
			);

		new Setting(containerEl)
			.setName(t('collab.settings.showAuthors'))
			.setDesc(t('collab.settings.showAuthorsDesc'))
			.addToggle((toggle) =>
				toggle.setValue(this.settings.showAuthors).onChange(async (value) => {
					await this.setShowAuthors(value);
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
		if (this.waiting.size > 0) {
			containerEl.createEl('p', {
				cls: 'signet-panel__state',
				text: t('collab.panel.waiting', { count: this.waiting.size }),
			});
		}

		const joined = [...this.sessions].filter(
			([path]) => !this.connecting.has(path) && !this.waiting.has(path)
		);
		if (joined.length === 0) {
			if (this.connecting.size === 0 && this.waiting.size === 0) {
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

			// Who the colours in the note are. Only what the panel can answer: the
			// note shows the colours, and nothing there says whose they are.
			const others = this.settings.showAuthors
				? otherAuthors(session.authors, session.authorKey)
				: [];
			if (others.length > 0) {
				const legend = list.createDiv({ cls: 'signet-panel__authors' });
				legend.createSpan({ cls: 'signet-panel__meta', text: t('collab.panel.authors') });
				for (const author of others) {
					const entry = legend.createSpan({ cls: 'signet-panel__author' });
					entry.createSpan({
						cls: `signet-author-dot signet-author-dot--${author.slot}`,
					});
					entry.createSpan({ text: author.name });
				}
			}
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
	/** When a failure that keeps happening is worth saying again. */
	private readonly reported = new Map<string, number>();

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
				this.waiting.delete(path);
				this.refreshPanel();
			}

			if (!session.isSeeded) {
				// Ended or refused while waiting. There is no document to show.
				return;
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
					session,
					this.authorsFor(session)
				);
			}
		} catch (error) {
			this.connecting.delete(path);
			this.waiting.delete(path);
			this.refreshPanel();
			console.error('Signet: could not start a collaborative session.', error);
			this.report(path, error);
		}
	}

	/**
	 * Says a start failed, once.
	 *
	 * Opening a note raises `file-open`, `active-leaf-change` and the editor's own
	 * announcement, and all three come through here. One broken address therefore
	 * produced three identical notices per note and three more on every tab
	 * switch — which is what "haufenweise Fehler" looks like from the outside.
	 *
	 * Keyed by what went wrong rather than by the note, because the cause is
	 * almost always the configuration rather than the file, and hearing it once
	 * per note is barely better than hearing it three times.
	 */
	private report(path: string, error: unknown): void {
		const reason = error instanceof Error ? error.message : String(error);
		const last = this.reported.get(reason);
		const now = Date.now();

		if (last !== undefined && now - last < REPORT_EVERY_MS) {
			return;
		}
		this.reported.set(reason, now);
		new Notice(t('collab.notice.failed', { path, reason }));
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

		const roomId = await deriveRoomId(context.nameKey, file.path);
		const store =
			context.deviceId === undefined
				? undefined
				: new RoomBaseStore(
						this.app,
						this.plugin.folder(),
						context.deviceId,
						context.vaultId
					);

		const session = new CollabSession({
			path: file.path,
			serverUrl: context.serverUrl,
			vaultId: context.vaultId,
			roomId,
			token: context.token,
			contentKey: context.contentKey,
			secret: context.secret,
			deviceName: context.deviceName,
			deviceId: context.deviceId,
			readCurrent: () => this.currentText(file),
			loadBase: store ? () => store.load(roomId) : undefined,
			keepAside: (text) => this.keepAside(file, text),
			onWaiting: () => {
				// Only if somebody is actually waiting on it; a session can time out
				// after its attach has already given up.
				if (this.connecting.delete(file.path)) {
					this.waiting.add(file.path);
					this.refreshPanel();
				}
			},
			onStatus: () => {
				this.refreshPanel();
			},
			onError: (error) => {
				console.error('Signet: collaboration error.', error);
				// Deduplicated by cause, so a server that is refusing every note says
				// it once rather than once per note per reconnect.
				this.report(file.path, error);
			},
			onUnavailable: (reason) => {
				// The note goes back to being an ordinary file, which the vault sync
				// then looks after as usual. Staying open would mean a session that
				// is bound to an editor and connected to nothing.
				console.error(`Signet: the room for ${file.path} is unavailable.`, reason);
				this.end(file.path);
				this.report(file.path, new Error(reason));
			},
		});

		this.sessions.set(file.path, session);
		if (store) {
			this.baseStores.set(session, { store, roomId });
		}
		// From here the session owns the file, and the vault sync leaves it alone.
		this.plugin.liveEditing.claim(file.path, session);

		// The legend in the panel names whoever has written here.
		session.authors.observe(() => {
			this.refreshPanel();
		});

		// Registered before starting, not after. The room's history can arrive
		// immediately, and a seed that lands before this listener exists leaves the
		// new text sitting in the document with nothing scheduled to write it to
		// disk — until somebody happens to type.
		session.doc.on('update', () => {
			this.scheduleFlush();
		});

		try {
			session.start();
		} catch (error) {
			// `start` reaches `new WebSocket`, which throws on an address that is not
			// a valid URL. Leaving the session in the map would be the worst of both
			// outcomes: it can never seed, so every later attach waits on it forever,
			// and the path stays claimed — which takes the note out of the file sync
			// for as long as the vault is open.
			this.sessions.delete(file.path);
			this.plugin.liveEditing.release(file.path, session);
			session.destroy();
			this.refreshPanel();
			throw error;
		}

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
		this.waiting.delete(path);
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
			// keep its hands off a note that is still being saved. Passing the session
			// means a note reopened while this was running keeps the claim its own
			// session made, rather than losing it to this one letting go.
			this.plugin.liveEditing.release(path, session);
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

	/** Stops a pending write-back, for a module that is going away. */
	private cancelFlush(): void {
		if (this.flushTimer !== undefined) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = undefined;
		}
	}

	private async flushAll(): Promise<void> {
		for (const [path, session] of this.sessions) {
			await this.flushOne(path, session);
		}
	}

	/**
	 * Gets a session's text onto disk, and remembers it as the base once it is.
	 *
	 * There must only ever be one writer per note, and which one depends on
	 * whether an editor is showing the session.
	 *
	 * **Bound to an editor:** Obsidian is the writer. The editor already holds the
	 * document's text — remote changes included — and Obsidian saves it like any
	 * other note. Writing the same note from here as well meant two writers racing:
	 * a write prepared a moment earlier landed after Obsidian's newer one, Obsidian
	 * saw a file changed underneath it and reloaded the editor from it, and the
	 * last few characters vanished with the cursor jumping somewhere else. So here
	 * this only asks the view to save now and then reads what landed.
	 *
	 * **Not bound** — the note is closing, or nobody is showing it: this writes,
	 * and reads the text inside `process`, at the moment of writing rather than
	 * before it.
	 *
	 * Only when the text actually differs: an identical write would still bump the
	 * modification time, which the sync reads as a change.
	 *
	 * And never from a session that has not been seeded, or one that reports no
	 * text at all for a note that has some. A session's text is empty until it
	 * holds the note, and it can be ended inside that window by a layout change, a
	 * switched-off module, or a plugin unload; writing then replaces the note with
	 * nothing.
	 */
	private async flushOne(path: string, session: CollabSession): Promise<void> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			return;
		}

		if (!session.isSeeded) {
			// It never held the note's text, so it has nothing to say about it.
			return;
		}

		try {
			// Filled in from inside callbacks, which is why it is an object: a plain
			// `let` would be narrowed to its first value and never read again.
			const result: { base?: RoomBase; refused: boolean } = { refused: false };

			if (this.isBound(path, session)) {
				for (const view of this.viewsOf(path)) {
					await view.save();
				}
				const onDisk = await this.app.vault.read(file);
				if (onDisk === session.contents()) {
					result.base = session.snapshotBase();
				}
			} else {
				// `process` rather than read-then-modify: it is the documented way to
				// edit a file nobody is looking at, and it closes the gap in which a
				// sync could land between the two halves.
				await this.app.vault.process(file, (data) => {
					const contents = session.contents();
					if (contents === '' && data !== '') {
						// Emptying a note is a thing somebody can genuinely do, and this is
						// not how it would reach us: a seeded session that reports nothing
						// is a document that failed to load, not a note somebody cleared.
						result.refused = true;
						return data;
					}
					result.base = session.snapshotBase();
					return data === contents ? data : contents;
				});
				if (result.refused) {
					console.error(
						`Signet: refused to empty ${path} from a session that holds no text.`
					);
				}
			}

			const where = this.baseStores.get(session);
			if (result.base && where) {
				await where.store.save(where.roomId, result.base);
			}
		} catch (error) {
			console.error(`Signet: could not write ${path} back to disk.`, error);
		}
	}

	/** Whether an editor on screen is following this session. */
	private isBound(path: string, session: CollabSession): boolean {
		for (const [view, shown] of this.editors) {
			if (shown === path && this.binding.isBoundTo(view, session)) {
				return true;
			}
		}
		return false;
	}

	private viewsOf(path: string): MarkdownView[] {
		const views: MarkdownView[] = [];
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView && leaf.view.file?.path === path) {
				views.push(leaf.view);
			}
		});
		return views;
	}

	/**
	 * Keeps this device's version of a note that could not be merged.
	 *
	 * Beside the note, named the way `patterns.ts` recognises, so the panel counts
	 * it with every other conflicted copy. Said once, because it just happened and
	 * somebody has a decision to make about it.
	 */
	private async keepAside(file: TFile, text: string): Promise<void> {
		const target = normalizePath(conflictPath(file.path, new Date()));
		await this.app.vault.create(target, text);
		new Notice(t('collab.notice.keptAside', { path: file.path, copy: target }));
	}

	// --- who wrote what -----------------------------------------------------

	private authorsFor(session: CollabSession): Extension {
		return this.settings.showAuthors
			? authorship(session.text, session.authors, session.authorKey)
			: [];
	}

	private async setShowAuthors(value: boolean): Promise<void> {
		await this.patchSettings({ showAuthors: value });
		for (const [view, path] of this.editors) {
			const session = this.sessions.get(path);
			if (session && this.binding.isBoundTo(view, session)) {
				this.binding.setAuthors(view, this.authorsFor(session));
			}
		}
		this.refreshPanel();
	}

	// --- wiring -------------------------------------------------------------

	private isExcluded(path: string): boolean {
		return this.settings.excludedFolders.some(
			(folder) => folder !== '' && (path === folder || path.startsWith(`${folder}/`))
		);
	}

	private ring(): { code: string; deviceId?: string; deviceName: string } | undefined {
		const ring = this.plugin.settings.moduleSettings[RING_MODULE_ID] as
			RingSettings | undefined;
		if (typeof ring?.code !== 'string' || !ring.code) {
			return undefined;
		}
		return {
			code: ring.code,
			deviceId:
				typeof ring.deviceId === 'string' && ring.deviceId ? ring.deviceId : undefined,
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
		// Asked here rather than discovered inside `new WebSocket`. An address
		// that cannot be turned into a socket is a reason for this module not to
		// be ready, which the panel can say plainly — not an exception thrown
		// from the middle of starting a session on every note anybody opens.
		if (!isUsableServerUrl(sync.serverUrl)) {
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
				deviceId?: string;
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
			deviceId: ring.deviceId,
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
