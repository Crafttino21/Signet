import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';

/**
 * What this device last shared with a room, one file per note.
 *
 * The merge in `text-merge.ts` needs a base: without one, a note that differs
 * from its room could have changed on either side, and the only safe answer is
 * to keep both copies. With the text this device and the room last agreed on,
 * the question is answerable — the same reason the vault sync keeps a manifest.
 *
 * The text alone is not enough. A device can type into a room while its socket
 * is down, close the note, and leave edits behind that only it holds. Those are
 * in the text it wrote to disk, so a merge would read them as "unchanged here,
 * missing there" — a deletion by the room. Keeping the document state as well
 * lets those edits go to the room as what they are.
 *
 * A base is written only at a moment when the file on disk and the document
 * were seen to be the same text. Anything else would be a base that disagrees
 * with the disk, which is what makes a merge invent changes.
 *
 * Like the vault sync's state, each file names the device and the vault it is
 * about. The plugin folder sits under the config folder, which some people sync,
 * and another device's base claims this one shared things it never did.
 */

export interface RoomBase {
	text: string;
	update: Uint8Array;
	/**
	 * The Yjs client ids this device has written under in this room.
	 *
	 * Every session picks a new one, so "is this text ours" has to remember the
	 * earlier ones. It also tells a room that was reset apart from one that is
	 * merely missing this device's unsent edits: the first lacks other devices'
	 * text the base has, the second lacks only ours.
	 */
	clients: number[];
}

/** Enough sessions to cover any realistic gap, without growing forever. */
const MAX_CLIENTS = 64;

interface StoredBase {
	deviceId: string;
	vaultId: string;
	text: string;
	update: string;
	clients: number[];
}

export class RoomBaseStore {
	constructor(
		private readonly app: App,
		private readonly pluginDir: string,
		private readonly deviceId: string,
		private readonly vaultId: string
	) {}

	private folder(): string {
		return normalizePath(`${this.pluginDir}/collab-base`);
	}

	private path(roomId: string): string {
		return normalizePath(`${this.folder()}/${roomId}.json`);
	}

	async load(roomId: string): Promise<RoomBase | undefined> {
		try {
			const adapter = this.app.vault.adapter;
			if (!(await adapter.exists(this.path(roomId)))) {
				return undefined;
			}
			const stored = JSON.parse(await adapter.read(this.path(roomId))) as Partial<StoredBase>;

			// Another device's or another ring's memory is worse than none.
			if (stored.deviceId !== this.deviceId || stored.vaultId !== this.vaultId) {
				return undefined;
			}
			if (typeof stored.text !== 'string' || typeof stored.update !== 'string') {
				return undefined;
			}
			return {
				text: stored.text,
				update: base64ToBytes(stored.update),
				clients: Array.isArray(stored.clients)
					? stored.clients.filter((id): id is number => typeof id === 'number')
					: [],
			};
		} catch {
			// Unreadable is the same as absent: the merge then keeps both copies,
			// which is noisy and never destructive.
			return undefined;
		}
	}

	async save(roomId: string, base: RoomBase): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.folder()))) {
			await adapter.mkdir(this.folder());
		}
		const stored: StoredBase = {
			deviceId: this.deviceId,
			vaultId: this.vaultId,
			text: base.text,
			update: bytesToBase64(base.update),
			clients: base.clients.slice(-MAX_CLIENTS),
		};
		await adapter.write(this.path(roomId), JSON.stringify(stored));
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
