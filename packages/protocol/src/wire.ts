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

/** Both sides build their URLs from here, so a typo cannot go unnoticed. */
export const routes = {
	register: (vaultId: string) => `/v1/vaults/${vaultId}/register`,
	head: (vaultId: string) => `/v1/vaults/${vaultId}/head`,
	commit: (vaultId: string, seq: number) => `/v1/vaults/${vaultId}/commits/${String(seq)}`,
	push: (vaultId: string) => `/v1/vaults/${vaultId}/commits`,
	blob: (vaultId: string, blobId: string) => `/v1/vaults/${vaultId}/blobs/${blobId}`,
	health: () => '/v1/health',
} as const;

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
		Array.isArray(candidate.deleted)
	);
}

/** Vault ids and blob ids are hex, and both end up in a filesystem path. */
export function isSafeId(value: string): boolean {
	return /^[0-9a-f]{16,128}$/.test(value);
}
