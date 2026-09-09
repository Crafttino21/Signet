import { hkdfAesKey, hkdfBits, bytesToHex } from './crypto';
import type { Bytes } from './code';

/**
 * Everything the sync needs is derived from the one ring secret the user carries
 * between devices. Each purpose uses its own HKDF label, so the values are
 * cryptographically unrelated to one another.
 *
 * That separation is what lets the server do its job while staying blind:
 *
 * - it is told the **vault id**, so it knows which shelf to use,
 * - it is told the **auth token**, so it knows the caller is a member,
 * - it is never told the **content key**, so it cannot read a single note,
 * - it never sees the **name key**, so identical content in two different vaults
 *   lands under different blob ids and cannot be correlated.
 */

const VAULT_ID_INFO = 'toolbox:vault-sync:vault-id:v1';
const AUTH_TOKEN_INFO = 'toolbox:vault-sync:auth-token:v1';
const CONTENT_KEY_INFO = 'toolbox:vault-sync:content-key:v1';
const NAME_KEY_INFO = 'toolbox:vault-sync:blob-name-key:v1';

/** Public identifier of a vault on the server. Reveals nothing about the secret. */
export async function deriveVaultId(secret: Bytes): Promise<string> {
	return bytesToHex(await hkdfBits(secret, VAULT_ID_INFO, 128));
}

/**
 * Bearer token proving membership. The server only ever stores its hash, so a
 * copy of the server's data does not let anyone write to a vault.
 */
export async function deriveAuthToken(secret: Bytes): Promise<string> {
	return bytesToHex(await hkdfBits(secret, AUTH_TOKEN_INFO, 256));
}

/** The key note contents are encrypted with. Never leaves the device. */
export async function deriveContentKey(secret: Bytes): Promise<CryptoKey> {
	return hkdfAesKey(secret, CONTENT_KEY_INFO);
}

/** Keys a content hash into an opaque blob id, so the server cannot correlate. */
export async function deriveNameKey(secret: Bytes): Promise<Bytes> {
	return (await hkdfBits(secret, NAME_KEY_INFO, 256)) as Bytes;
}

/** What the server stores to recognise a member later. */
export async function hashAuthToken(token: string): Promise<string> {
	const digest = await globalThis.crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(token)
	);
	return bytesToHex(new Uint8Array(digest));
}
