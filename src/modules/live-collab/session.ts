import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { RoomSocket } from './room-socket';
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
 * Seeding is the delicate part. A room that already has history is the truth; the
 * file on disk may be an older copy. A room with no history at all is new, and
 * then the file is all there is. Getting that backwards would either discard
 * everyone else's work or duplicate the file's contents into the document.
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
	/** Read when the room turns out to be empty and needs seeding. */
	readFile: () => Promise<string>;
	onStatus: (connected: boolean, peers: number) => void;
	onError: (error: unknown) => void;
}

/** Past this many updates in a room, the next joiner offers a merged replacement. */
const COMPACT_AFTER = 200;

export class CollabSession {
	readonly doc = new Y.Doc();
	readonly text: Y.Text;
	readonly awareness: Awareness;

	private readonly socket: RoomSocket;
	private seeded = false;
	private generation = 0;

	constructor(private readonly options: SessionOptions) {
		this.text = this.doc.getText('content');
		this.awareness = new Awareness(this.doc);
		this.awareness.setLocalStateField('user', {
			name: options.deviceName,
			// Derived from the name so the same device keeps its colour, and two
			// devices are unlikely to collide.
			color: colourFor(options.deviceName),
			colorLight: `${colourFor(options.deviceName)}33`,
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

	start(): void {
		this.socket.connect();
	}

	/**
	 * Brings the document up to date with the room, once.
	 *
	 * A room with history wins over the file: whatever is on disk here may be an
	 * older copy, and replacing the room with it would throw away everyone else's
	 * edits. Only an empty room is seeded from the file.
	 */
	private async seed(updates: Uint8Array[], generation: number): Promise<void> {
		this.generation = generation;

		if (this.seeded) {
			// A reconnection. The updates are merged rather than seeded, since the
			// document already exists.
			for (const update of updates) {
				Y.applyUpdate(this.doc, update, this);
			}
			// Anything typed while the socket was down never reached the room: a
			// document announces each edit once, at the moment it happens, and the
			// send was dropped. Offering the whole state closes that gap, and a CRDT
			// ignores the part it already has.
			void this.socket.sendUpdate(Y.encodeStateAsUpdate(this.doc));
			this.announce();
			return;
		}
		this.seeded = true;

		if (updates.length === 0) {
			const contents = await this.options.readFile();
			if (contents.length > 0) {
				// Not marked as remote: this is genuinely new content for the room.
				Y.applyUpdate(this.doc, seedUpdate(contents));
			}
			this.announce();
			return;
		}

		for (const update of updates) {
			Y.applyUpdate(this.doc, update, this);
		}

		if (updates.length > COMPACT_AFTER) {
			// The whole document as one update, offered in place of the log that
			// produced it. The server keeps the old generation regardless.
			void this.socket.sendCompacted(Y.encodeStateAsUpdate(this.doc), this.generation);
		}

		this.announce();
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
		this.socket.close();
		this.awareness.destroy();
		this.doc.destroy();
	}
}

/**
 * The identity every device seeds under.
 *
 * Fixed rather than random on purpose — see `seedUpdate`. A real client picking
 * the same number would have its own edits merged with the seed, which is
 * harmless: the seed is only ever the text both sides already had.
 */
const SEED_CLIENT_ID = 0;

/**
 * Turns a file's contents into the same bytes on every device.
 *
 * Two devices can open a note at the same moment and both find the room empty —
 * neither one's first update has reached the server yet. Inserting the text under
 * each device's own identity would leave the room holding the file twice, which
 * is exactly the kind of quiet damage this project exists to prevent. Built in a
 * throwaway document under one fixed identity, both devices produce byte-identical
 * updates, and a CRDT applies an item it already has exactly once.
 *
 * If the two files genuinely differ, the seeds differ too and both survive as a
 * merge. That is the right answer: nobody's text is thrown away.
 */
function seedUpdate(contents: string): Uint8Array {
	const doc = new Y.Doc();
	doc.clientID = SEED_CLIENT_ID;
	doc.getText('content').insert(0, contents);
	const update = Y.encodeStateAsUpdate(doc);
	doc.destroy();
	return update;
}

/** A stable colour per device name, so cursors stay recognisable. */
function colourFor(name: string): string {
	let hash = 0;
	for (const character of name) {
		hash = (hash * 31 + character.charCodeAt(0)) % 360;
	}
	return `hsl(${String(hash)}, 70%, 50%)`;
}
