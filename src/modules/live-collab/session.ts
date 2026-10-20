import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { RoomSocket } from './room-socket';
import { colourSlot } from './authors';
import type { AuthorEntry } from './authors';
import type { RoomBase } from './base-store';
import { mergeText } from './text-merge';
import type { Bytes } from '@signet/protocol';

/**
 * One note being edited together.
 *
 * The Yjs document is the authority while a session is open. Everything anyone
 * types becomes an update that goes out sealed and comes back merged — and
 * because a CRDT merges by construction, two people typing in the same paragraph
 * produce one text rather than a conflict. That is the whole reason this exists
 * alongside the file sync, which can only ever keep both versions.
 *
 * Joining is the delicate part. A room with no history at all is new, and then
 * the file is all there is. A room with history has the others' work in it — and
 * the file may have work of this device's that the room never saw, written while
 * it was cut off. Neither may simply win: the two are merged against the text
 * this device last shared with the room (`text-merge.ts`), and what cannot be
 * merged is kept beside the note rather than dropped.
 *
 * Until the seeding has happened the document is not the note. It is empty, or
 * half of one, and an editor bound to it in that state is shown the difference as
 * an edit — which is how the text used to appear twice. So the moment seeding is
 * finished is a fact the module outside needs, and {@link CollabSession.whenSeeded}
 * is how it is told.
 */

export interface SessionOptions {
	path: string;
	serverUrl: string;
	vaultId: string;
	roomId: string;
	token: string;
	contentKey: CryptoKey;
	secret: Bytes;
	/** Shown to the others as the name beside their cursor. */
	deviceName: string;
	/**
	 * What tells this device's text apart from a namesake's. Names are chosen by
	 * people and two desktops are both called "Desktop"; the id is not. Falls
	 * back to the name where there is no id.
	 */
	deviceId?: string;
	/**
	 * The note as it stands right now, read when the room turns out to be empty.
	 *
	 * Deliberately not "read the file": somebody can type into an open note in the
	 * moment between opening it and the room answering, and the file on disk does
	 * not have those characters. Seeding from the buffer the user is looking at
	 * puts them into the room instead of losing them at the first sync.
	 */
	readCurrent: () => Promise<string>;
	/**
	 * What this device last shared with this room, if it remembers. See
	 * `base-store.ts`; without one, a note that differs from its room is kept
	 * beside it rather than merged.
	 */
	loadBase?: () => Promise<RoomBase | undefined>;
	/**
	 * This device's text could not be merged into the room without a person.
	 *
	 * The room's text goes into the note — it is what everybody else is looking
	 * at — and this is how the other version survives: the caller writes it next
	 * to the note as a conflicted copy.
	 */
	keepAside?: (text: string) => Promise<void>;
	/**
	 * The room has not answered in time. The note stays an ordinary note until it
	 * does, and is merged then; this is only so somebody can be told why nothing
	 * is shared yet.
	 */
	onWaiting?: () => void;
	onStatus: (connected: boolean, peers: number) => void;
	onError: (error: unknown) => void;
	/**
	 * The server will not serve this room, and retrying will not change that.
	 *
	 * The session stops here rather than falling back to the file: the fallback
	 * exists for a server that cannot be reached, and this is a server that was
	 * reached and said no.
	 */
	onUnavailable?: (reason: string) => void;
}

/** Past this many updates in a room, the next joiner offers a merged replacement. */
const COMPACT_AFTER = 200;

/**
 * How long the room has to answer before the wait is worth mentioning.
 *
 * Only mentioning. This used to seed the document from the note when it ran
 * out, so that a server that was down did not leave the note unbound — and that
 * seed is what broke text. It went into the document under the shared seed
 * identity, the room's own history arrived a moment later under the same one
 * with different text, and Yjs, which knows a character by who wrote it and
 * when, kept whichever it saw first. Everything the others did afterwards then
 * pointed at characters this device did not have: their typing landed in the
 * wrong place and their deletions took the wrong words. "Mitten im Text" was
 * that.
 *
 * So a note whose room is slow stays an ordinary note, saved by Obsidian as any
 * other, and is merged into the room when the room answers. Nothing typed in the
 * meantime is lost, because the merge is exactly the one a device that was
 * offline for a week goes through.
 */
const SEED_TIMEOUT_MS = 5_000;

export class CollabSession {
	readonly doc = new Y.Doc();
	readonly text: Y.Text;
	/** Which device each Yjs client id belongs to. See `authorship.ts`. */
	readonly authors: Y.Map<AuthorEntry>;
	readonly awareness: Awareness;
	/** What identifies this device among the authors. */
	readonly authorKey: string;

	private readonly socket: RoomSocket;
	private seeded = false;
	/** A join is under way; history that arrives meanwhile waits for it. */
	private joining = false;
	private pendingHistory: Uint8Array[] | undefined;
	/** Whether this session has put itself in {@link authors} yet. */
	private registered = false;
	/** Every client id this device has written under in this room. */
	private ownClients: number[];
	/** The server said this room cannot be served. Never seed over that. */
	private unavailable = false;
	/** Ended while a join was waiting on the note. Nothing may land after this. */
	private destroyed = false;
	/**
	 * How many log entries the document was built from.
	 *
	 * Sent with a compaction so the server can keep whatever arrived after that
	 * point. Without it the merge silently drops every update appended while it
	 * was being made.
	 */
	private covered = 0;
	private generation = 0;
	private seedTimer: number | undefined;
	private announceSeeded!: () => void;

	/**
	 * Resolves once this document holds the note.
	 *
	 * Nothing binds an editor before this, and a room that does not answer keeps
	 * it waiting: the note stays an ordinary note until there is a room to merge
	 * it into. Also resolved — never rejected — when the session is destroyed or
	 * the room turns out to be unavailable, so nothing waits on it forever; a
	 * caller checks {@link isSeeded} or whether the session is still current.
	 */
	readonly whenSeeded = new Promise<void>((resolve) => {
		this.announceSeeded = resolve;
	});

	constructor(private readonly options: SessionOptions) {
		this.text = this.doc.getText('content');
		this.authors = this.doc.getMap<AuthorEntry>('authors');
		this.authorKey = options.deviceId ?? options.deviceName;
		this.ownClients = [this.doc.clientID];
		this.awareness = new Awareness(this.doc);
		// The cursor in the same colour as the text this device wrote, and both
		// from Obsidian's palette, so they follow the theme instead of fighting it.
		const colour = colourSlot(this.authorKey);
		this.awareness.setLocalStateField('user', {
			name: options.deviceName,
			color: `var(--color-${colour})`,
			colorLight: `rgba(var(--color-${colour}-rgb), 0.2)`,
		});

		// Signed on the first keystroke rather than on joining: a session that only
		// read the note has written nothing to attribute, and every one that signed
		// on arrival would leave an entry in the room's history forever.
		this.text.observe((_event, transaction) => {
			if (transaction.local && !this.registered) {
				this.registered = true;
				// Not inside the observer: this transaction is still being cleaned up.
				void Promise.resolve().then(() => {
					this.authors.set(String(this.doc.clientID), {
						device: this.authorKey,
						name: options.deviceName,
					});
				});
			}
		});

		this.socket = new RoomSocket(
			{
				serverUrl: options.serverUrl,
				vaultId: options.vaultId,
				roomId: options.roomId,
				token: options.token,
				contentKey: options.contentKey,
				secret: options.secret,
			},
			{
				onHistory: (updates, generation) => {
					void this.seed(updates, generation);
				},
				onUpdate: (update) => {
					// `this` as origin marks it as remote, so it is not sent back out.
					Y.applyUpdate(this.doc, update, this);
				},
				onPresence: (update) => {
					applyAwarenessUpdate(this.awareness, update, this);
				},
				onStatus: (connected) => {
					options.onStatus(connected, this.awareness.getStates().size - 1);
				},
				onError: options.onError,
				onGeneration: (generation) => {
					// Just the number. Compacting against a stale one is refused, and
					// this is the only way a peer that did not compact ever learns it
					// moved.
					this.generation = generation;
				},
				onUnavailable: (reason) => {
					// Set before announcing, so anything the announcement wakes up
					// already sees that this room is not to be seeded from the file.
					this.unavailable = true;
					if (this.seedTimer !== undefined) {
						window.clearTimeout(this.seedTimer);
						this.seedTimer = undefined;
					}
					this.announceSeeded();
					options.onUnavailable?.(reason);
				},
			}
		);

		this.doc.on('update', (update: Uint8Array, origin: unknown) => {
			// Anything that arrived from the room must not be echoed back into it.
			if (origin !== this) {
				void this.socket.sendUpdate(update);
			}
		});

		this.awareness.on(
			'update',
			(
				changed: { added: number[]; updated: number[]; removed: number[] },
				origin: unknown
			) => {
				if (origin === this) {
					// Somebody new turned up. Nothing on the server remembers who is in a
					// room — presence is relayed and forgotten — so a device that was
					// already here has to say so again, or the newcomer would not see it
					// until it happened to move its cursor.
					if (changed.added.some((id) => id !== this.doc.clientID)) {
						this.announce();
					}
					options.onStatus(this.socket.connected, this.awareness.getStates().size - 1);
					return;
				}
				const ids = [...changed.added, ...changed.updated, ...changed.removed];
				void this.socket.sendPresence(encodeAwarenessUpdate(this.awareness, ids));
				options.onStatus(this.socket.connected, this.awareness.getStates().size - 1);
			}
		);
	}

	/**
	 * Opens the socket and starts the clock on seeding.
	 *
	 * The timer is armed *before* the socket, and that order is the whole point.
	 * `connect()` builds a `WebSocket`, which throws synchronously on an address
	 * that is not a valid URL — and with the timer armed afterwards, that throw
	 * left `whenSeeded` as a promise nothing could ever resolve. The session was
	 * already in the module's map and had already claimed the path, so every later
	 * attach waited on it forever and the file stayed excluded from the sync for
	 * as long as the vault was open.
	 */
	start(): void {
		this.seedTimer = window.setTimeout(() => {
			this.seedTimer = undefined;
			if (!this.seeded) {
				this.options.onWaiting?.();
			}
		}, SEED_TIMEOUT_MS);

		this.socket.connect();
	}

	/** Whether the document is the note yet. See {@link whenSeeded}. */
	get isSeeded(): boolean {
		return this.seeded;
	}

	/**
	 * Brings the document up to date with the room.
	 *
	 * The first time, that is a join: an empty room is seeded from the note, a
	 * room with history is merged with it (see {@link join}). Every time after,
	 * it is a reconnection, and the room's history is simply applied — the
	 * document already exists.
	 */
	private async seed(updates: Uint8Array[], generation: number): Promise<void> {
		this.generation = generation;

		if (this.unavailable && !this.seeded) {
			// The room exists and the server could not read it. Seeding from the file
			// would put this device's copy of the note into a room whose real history
			// is merely unreachable, and from there to everybody else.
			this.announceSeeded();
			return;
		}

		if (this.joining) {
			// The socket came back while a join was still reading the note. Applied
			// once the join is done, as the reconnection it is.
			this.pendingHistory = updates;
			return;
		}

		if (this.seeded) {
			this.reconnected(updates);
			return;
		}

		this.joining = true;
		if (this.seedTimer !== undefined) {
			window.clearTimeout(this.seedTimer);
			this.seedTimer = undefined;
		}

		let aside: string | undefined;
		try {
			if (updates.length === 0) {
				const contents = await this.options.readCurrent();
				if (this.destroyed) {
					return;
				}
				if (contents.length > 0) {
					// Not marked as remote: this is genuinely new content for the room.
					Y.applyUpdate(this.doc, seedUpdate(contents));
				}
			} else {
				aside = await this.join(updates);
			}
		} catch (error) {
			this.options.onError(error);
		} finally {
			// Whatever happened above, the document is as close to the note as it is
			// going to get. A reader that never hears this leaves the note unbound.
			// A session ended meanwhile holds no note, and must not say it does.
			this.seeded = !this.destroyed;
			this.joining = false;
			this.announceSeeded();
			this.announce();
		}

		if (aside !== undefined && this.options.keepAside) {
			// Only now, with the editor already told: writing the copy takes a moment,
			// and keystrokes in that moment would land in a buffer about to be
			// brought in line with the room.
			this.options.keepAside(aside).catch((error: unknown) => {
				this.options.onError(error);
			});
		}

		const pending = this.pendingHistory;
		this.pendingHistory = undefined;
		if (pending) {
			this.reconnected(pending);
		}
	}

	/**
	 * Joins a room that has history, without losing what this device has.
	 *
	 * Three texts meet here: the room's, the note as this device has it, and the
	 * base — what the two last agreed on. The merge puts this device's changes
	 * since the base into the room's text, and only a stretch both sides changed
	 * differently is left to a person, by way of a copy beside the note.
	 *
	 * Everything that waits happens first. From reading the note onwards the
	 * steps are synchronous, so nothing typed into the editor can fall between
	 * reading the note and the merge that is computed from it.
	 *
	 * Returns this device's text when it has to be kept beside the note.
	 */
	private async join(updates: Uint8Array[]): Promise<string | undefined> {
		const room = roomState(updates);
		const base = await this.usableBase(room.vector);
		const ours = await this.options.readCurrent();
		if (this.destroyed) {
			return undefined;
		}

		if (base) {
			// The document as this device left it, including anything it typed that
			// never reached the room — that is in `ours` and in the base text alike,
			// and the merge would otherwise read it as the room having deleted it.
			Y.applyUpdate(this.doc, base.update, this);
			this.ownClients = [...base.clients, this.doc.clientID];
		}
		for (const update of updates) {
			Y.applyUpdate(this.doc, update, this);
		}
		this.covered = updates.length;

		if (base && this.text.toJSON() !== room.text) {
			// What the base held that the room did not: this device's own edits from
			// a session whose socket was down. Only the difference, so the room's
			// log does not grow by a whole document on every open.
			void this.socket.sendUpdate(Y.encodeStateAsUpdate(this.doc, room.vector));
		}

		const theirs = this.text.toJSON();
		let aside: string | undefined;
		if (base) {
			const merged = mergeText(base.text, ours, theirs);
			if (merged.changes.length > 0) {
				// A local transaction, so it goes to the room like any typing does.
				this.doc.transact(() => {
					for (const change of [...merged.changes].reverse()) {
						if (change.to > change.from) {
							this.text.delete(change.from, change.to - change.from);
						}
						if (change.insert.length > 0) {
							this.text.insert(change.from, change.insert);
						}
					}
				});
			}
			if (merged.conflicted) {
				aside = ours;
			}
		} else if (ours !== theirs && ours.trim() !== '') {
			// Nothing to tell this device's changes from the room's by. Either text
			// could be the newer one, so the room — which everybody else is already
			// looking at — stays in the note, and this one is kept beside it.
			aside = ours;
		}

		if (updates.length > COMPACT_AFTER) {
			// The whole document as one update, offered in place of the log that
			// produced it. The server keeps the old generation regardless.
			void this.socket.sendCompacted(
				Y.encodeStateAsUpdate(this.doc),
				this.generation,
				this.covered
			);
		}
		return aside;
	}

	/**
	 * The stored base, if it is about the room that is actually there.
	 *
	 * A room that was reset — a wiped server, a restored backup — has none of the
	 * history the base was taken from. Applying the base to it would put the
	 * whole note in twice. The test is whether the room holds everything the base
	 * holds from other devices; what it may lack is only this device's own.
	 */
	private async usableBase(roomVector: Uint8Array): Promise<RoomBase | undefined> {
		const base = await this.options.loadBase?.();
		if (!base) {
			return undefined;
		}
		const room = Y.decodeStateVector(roomVector);
		const own = new Set(base.clients);
		const held = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(base.update));
		for (const [client, clock] of held) {
			if (!own.has(client) && (room.get(client) ?? 0) < clock) {
				return undefined;
			}
		}
		return base;
	}

	/**
	 * Catches a document that already exists up with the room.
	 *
	 * Anything typed while the socket was down never reached the room: a document
	 * announces each edit once, at the moment it happens, and the send was
	 * dropped. Offering what the room is missing closes that gap.
	 */
	private reconnected(updates: Uint8Array[]): void {
		const room = roomState(updates);
		for (const update of updates) {
			Y.applyUpdate(this.doc, update, this);
		}
		void this.socket.sendUpdate(Y.encodeStateAsUpdate(this.doc, room.vector));
		this.announce();
	}

	/**
	 * What to remember as the base, at a moment the caller has seen the file on
	 * disk hold exactly {@link contents}. See `base-store.ts`.
	 */
	snapshotBase(): RoomBase {
		return {
			text: this.contents(),
			update: Y.encodeStateAsUpdate(this.doc),
			clients: [...this.ownClients],
		};
	}

	/**
	 * Tells the room who is here.
	 *
	 * The local cursor state is set in the constructor, long before the socket is
	 * open, so that first announcement is dropped. Without repeating it here the
	 * others would not see this device until it happened to move its cursor.
	 */
	private announce(): void {
		void this.socket.sendPresence(encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
	}

	/** The document as text, for writing back to the file. */
	contents(): string {
		return this.text.toJSON();
	}

	get connected(): boolean {
		return this.socket.connected;
	}

	get peers(): number {
		return Math.max(0, this.awareness.getStates().size - 1);
	}

	destroy(): void {
		this.destroyed = true;
		if (this.seedTimer !== undefined) {
			window.clearTimeout(this.seedTimer);
			this.seedTimer = undefined;
		}
		// A note closed before the room answered must not leave anything waiting on
		// a promise that will now never be kept by the socket.
		this.announceSeeded();
		this.socket.close();
		this.awareness.destroy();
		this.doc.destroy();
	}
}

/**
 * The identity a seed is written under: a hash of the text being seeded.
 *
 * Two devices can open a note at the same moment and both find the room empty —
 * neither one's first update has reached the server yet. Each then seeds it.
 *
 * Yjs knows a character by the client that wrote it and a counter, and treats an
 * id it already has as the same character whatever the text says. With one fixed
 * id for every seed that was right for identical files and quietly destructive
 * for different ones: the second seed was dropped as a duplicate, and every edit
 * built on it pointed at characters the others did not have.
 *
 * Derived from the content, identical files still produce byte-identical seeds
 * that a CRDT applies once, and different files get different ids, so both
 * survive. Seeing a note twice is a visible problem with an obvious fix; losing
 * one of them is neither.
 */
export function seedClientId(contents: string): number {
	// FNV-1a over UTF-16 units. Synchronous, so the seed is not an await away
	// from the text it was computed from.
	let hash = 0x811c9dc5;
	for (let i = 0; i < contents.length; i += 1) {
		hash ^= contents.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Turns a file's contents into the same bytes on every device. */
export function seedUpdate(contents: string): Uint8Array {
	const doc = new Y.Doc();
	doc.clientID = seedClientId(contents);
	doc.getText('content').insert(0, contents);
	const update = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return update;
}

/** What a room's history adds up to, without touching the session's document. */
function roomState(updates: readonly Uint8Array[]): { vector: Uint8Array; text: string } {
	const doc = new Y.Doc();
	for (const update of updates) {
		Y.applyUpdate(doc, update);
	}
	const result = {
		vector: Y.encodeStateVector(doc),
		text: doc.getText('content').toJSON(),
	};
	doc.destroy();
	return result;
}
