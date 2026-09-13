import type { RingEnvelope } from './crypto';

/**
 * The contract between plugin and server.
 *
 * The server's whole job is to hold opaque bytes and order the commits. It never
 * learns a path or a filename: the manifest listing them is itself encrypted, and
 * blobs are filed under keyed ids. What the server does know is how many blobs
 * there are and roughly how big they are — unavoidable for something that stores
 * them, and the reason this is honest end-to-end encryption rather than a promise.
 */

export const PROTOCOL_VERSION = 1;

/** One file as of a particular commit. */
export interface FileEntry {
	path: string;
	/** SHA-256 of the plaintext. Drives change detection. */
	hash: string;
	/** Id the sealed bytes are stored under. */
	blob: string;
	size: number;
	/** Last modification time, milliseconds since the epoch. */
	mtime: number;
}

/**
 * A deletion. Kept rather than simply dropping the entry, because "absent from
 * the manifest" is ambiguous — it could equally mean a device never had the file.
 */
export interface Tombstone {
	path: string;
	deletedAt: number;
}

/** The full state of a vault at one commit. Encrypted before it reaches the server. */
export interface VaultManifest {
	version: number;
	seq: number;
	device: { id: string; name: string };
	updatedAt: string;
	files: FileEntry[];
	deleted: Tombstone[];
}

export interface HeadResponse {
	/** 0 when the vault exists but nothing has been pushed yet. */
	seq: number;
	updatedAt: string | null;
}

export interface RegisterRequest {
	/** SHA-256 of the auth token. The token itself never reaches the server. */
	tokenHash: string;
}

export interface PushRequest {
	/**
	 * The commit this push was built on. The server refuses the push when it is no
	 * longer the head, so a device that has not caught up cannot overwrite one that
	 * has — the same optimistic check the plugin ring uses.
	 */
	baseSeq: number;
	manifest: RingEnvelope;
}

export interface PushResponse {
	seq: number;
}

export interface ErrorResponse {
	error: string;
}

/**
 * Frames on the collaboration socket.
 *
 * The server routes these without being able to read them: `payload` is a sealed
 * blob, so an update, a presence ping and a whole document history all look the
 * same to it. It knows how many bytes moved between which connections, and that
 * is all.
 */
export type RoomFrame =
	/** Everything the room has so far, sent once when a client joins. */
	| { type: 'history'; updates: string[]; generation: number }
	/** One document change, relayed to everyone else and appended to the log. */
	| { type: 'update'; payload: string }
	/** Who is editing and where their cursor is. Never stored. */
	| { type: 'presence'; payload: string }
	/**
	 * A merged replacement for the log so far.
	 *
	 * A room's history grows with every keystroke, so a client that has just
	 * rebuilt the whole document offers it back compacted. The old generation is
	 * kept rather than deleted, in keeping with the rest of the server.
	 */
	| { type: 'compact'; payload: string; generation: number }
	| { type: 'error'; message: string };

/**
 * A payload is base64 of a sealed blob, and the server writes it to a log file
 * one entry per line.
 *
 * So the two things worth refusing are a newline — which would forge extra
 * entries in that log — and anything that is not a string, which would be
 * stringified into `undefined` or `[object Object]` and handed to the next client
 * that joins as though it were an update. Neither can happen by accident: real
 * payloads are base64. Both were possible on purpose.
 */
const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024;

function isPayload(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_PAYLOAD_CHARS &&
		!value.includes('\n') &&
		!value.includes('\r')
	);
}

/**
 * Whether a frame off the socket is one this server will act on.
 *
 * This used to check `type` and nothing else, which made the union above a
 * statement about what a well-behaved client sends rather than about what arrives.
 * `payload` reached the room log untyped; `generation` reached a filename.
 */
export function isRoomFrame(value: unknown): value is RoomFrame {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { type?: unknown; payload?: unknown; generation?: unknown };

	switch (candidate.type) {
		case 'update':
		case 'presence':
			return isPayload(candidate.payload);
		case 'compact':
			return isPayload(candidate.payload) && isGeneration(candidate.generation);
		case 'history': {
			// Every entry, because they are read back out of a log file and one
			// unusable line should be visible as such rather than arriving at the
			// base64 decoder as `undefined`.
			const { updates } = candidate as { updates?: unknown };
			return (
				Array.isArray(updates) &&
				updates.every(isPayload) &&
				isGeneration(candidate.generation)
			);
		}
		case 'error':
			return typeof (candidate as { message?: unknown }).message === 'string';
		default:
			return false;
	}
}

/** A generation ends up in a filename, so it is a whole number and a small one. */
function isGeneration(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1e9;
}

/** One file as of a particular commit, as it arrives rather than as it is declared. */
export function isFileEntry(value: unknown): value is FileEntry {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<FileEntry>;
	return (
		typeof candidate.path === 'string' &&
		candidate.path !== '' &&
		candidate.path.length <= MAX_PATH_CHARS &&
		typeof candidate.hash === 'string' &&
		typeof candidate.blob === 'string' &&
		typeof candidate.size === 'number' &&
		typeof candidate.mtime === 'number'
	);
}

export function isTombstone(value: unknown): value is Tombstone {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<Tombstone>;
	return (
		typeof candidate.path === 'string' &&
		candidate.path !== '' &&
		candidate.path.length <= MAX_PATH_CHARS &&
		typeof candidate.deletedAt === 'number'
	);
}

/** Longer than any real vault path, short enough that a hostile one is refused. */
const MAX_PATH_CHARS = 1024;

/** More files than any vault has, and few enough to reconcile without stalling. */
const MAX_FILES = 500_000;

/**
 * Whether a decrypted manifest is one this version can work with.
 *
 * Every element is checked, not just the shape around them. Decryption proves the
 * manifest was sealed by somebody holding the ring secret; it proves nothing at
 * all about what is inside, and `files[].path` goes on to become a path on this
 * disk. A device with the ring code is trusted to sync notes — it is not a reason
 * to stop reading what it sent.
 */
export function isVaultManifest(value: unknown): value is VaultManifest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<VaultManifest>;
	return (
		typeof candidate.version === 'number' &&
		typeof candidate.seq === 'number' &&
		typeof candidate.updatedAt === 'string' &&
		Array.isArray(candidate.files) &&
		candidate.files.length <= MAX_FILES &&
		candidate.files.every(isFileEntry) &&
		Array.isArray(candidate.deleted) &&
		candidate.deleted.length <= MAX_FILES &&
		candidate.deleted.every(isTombstone)
	);
}

/** Both sides build their URLs from here, so a typo cannot go unnoticed. */
/**
 * The subprotocol a room socket names alongside its token.
 *
 * A browser WebSocket cannot set request headers, so the token travels as a
 * subprotocol — which keeps it out of the query string, and out of the proxy logs
 * and browser history that query strings end up in.
 *
 * It does not keep it out of the *response*: a server that agrees to a
 * subprotocol repeats it in the 101, and `ws` agrees to the first one offered
 * unless told otherwise. So the token was in a response header too, which the
 * other half of a proxy's log configuration captures.
 *
 * Hence a second name with nothing secret in it. The client offers the token
 * first and this after it; the server agrees to this one when it is there. The
 * order matters for nothing but compatibility: a server that predates this picks
 * the first thing offered, which is still the token, and goes on working.
 */
export const ROOM_SUBPROTOCOL = 'signet.v1';

export const routes = {
	register: (vaultId: string) => `/v1/vaults/${vaultId}/register`,
	head: (vaultId: string) => `/v1/vaults/${vaultId}/head`,
	commit: (vaultId: string, seq: number) => `/v1/vaults/${vaultId}/commits/${String(seq)}`,
	push: (vaultId: string) => `/v1/vaults/${vaultId}/commits`,
	blob: (vaultId: string, blobId: string) => `/v1/vaults/${vaultId}/blobs/${blobId}`,
	health: () => '/v1/health',
	room: (vaultId: string, roomId: string) => `/v1/vaults/${vaultId}/rooms/${roomId}`,
} as const;

/** Vault ids and blob ids are hex, and both end up in a filesystem path. */
export function isSafeId(value: string): boolean {
	return /^[0-9a-f]{16,128}$/.test(value);
}
