/**
 * Encryption for the ring file.
 *
 * The ring file sits in the vault as a normal file, so anything that can read the
 * vault can read it — including whatever cloud service carries the sync. It holds
 * other plugins' `data.json`, which routinely contains API keys in plain text, so
 * the payload is encrypted rather than merely signed.
 *
 * AES-GCM is authenticated encryption: decryption fails unless the ciphertext was
 * produced with the same key. That doubles as the ring's authorisation check —
 * write access to the vault alone is not enough to push a snapshot at the ring,
 * because a snapshot only counts if it decrypts with the ring secret.
 *
 * The secret is 15 random bytes, so it is already full-entropy key material. HKDF
 * is the right derivation here; PBKDF2 exists to stretch weak human passwords and
 * would only cost time. The two derivations use different `info` strings so the
 * ring id and the encryption key are cryptographically unrelated.
 */

import type { Bytes } from './code';

const KEY_INFO = 'toolbox:plugin-ring:aes-key:v1';
const RING_ID_INFO = 'toolbox:plugin-ring:ring-id:v1';
const IV_BYTES = 12; // The size AES-GCM is specified for.
const RING_ID_BITS = 64;

export interface RingEnvelope {
	v: 1;
	/** Ring id in the clear, so a device can tell "is this my ring?" without the key. */
	ring: string;
	iv: string;
	data: string;
}

export class RingDecryptionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RingDecryptionError';
	}
}

function subtle(): SubtleCrypto {
	const available = globalThis.crypto?.subtle;
	if (!available) {
		throw new Error('Web Crypto is unavailable, so the plugin ring cannot be used here.');
	}
	return available;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Bytes {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	let hex = '';
	for (const byte of bytes) {
		hex += byte.toString(16).padStart(2, '0');
	}
	return hex;
}

export { bytesToBase64, base64ToBytes, bytesToHex, subtle };

function hkdfParams(info: string): HkdfParams {
	return {
		name: 'HKDF',
		hash: 'SHA-256',
		salt: new Uint8Array(0),
		info: new TextEncoder().encode(info),
	};
}

/**
 * Raw key material from the ring secret, for a purpose named by `info`.
 *
 * Every distinct use gets its own `info` string, so the values are
 * cryptographically unrelated: learning the vault id tells you nothing about the
 * encryption key or the auth token.
 */
export async function hkdfBits(secret: Bytes, info: string, bits: number): Promise<Uint8Array> {
	const derived = await subtle().deriveBits(hkdfParams(info), await importSecret(secret), bits);
	return new Uint8Array(derived);
}

/** An AES-GCM key for the purpose named by `info`. */
export async function hkdfAesKey(secret: Bytes, info: string): Promise<CryptoKey> {
	return subtle().deriveKey(
		hkdfParams(info),
		await importSecret(secret),
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

async function importSecret(secret: Bytes): Promise<CryptoKey> {
	return subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

async function deriveKey(secret: Bytes): Promise<CryptoKey> {
	return subtle().deriveKey(
		hkdfParams(KEY_INFO),
		await importSecret(secret),
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Public identifier of a ring. Derived from the secret but not reversible, so
 * publishing it in the clear reveals nothing about the key.
 */
export async function deriveRingId(secret: Bytes): Promise<string> {
	const bits = await subtle().deriveBits(
		hkdfParams(RING_ID_INFO),
		await importSecret(secret),
		RING_ID_BITS
	);
	return bytesToHex(new Uint8Array(bits));
}

/**
 * Encrypts a snapshot into an envelope ready to be written to the vault.
 *
 * A fresh random IV on every call is not optional: reusing one with the same key
 * breaks AES-GCM's confidentiality *and* its authenticity outright.
 */
export async function sealSnapshot(secret: Bytes, snapshot: unknown): Promise<RingEnvelope> {
	const iv = new Uint8Array(IV_BYTES);
	globalThis.crypto.getRandomValues(iv);

	const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
	const ciphertext = await subtle().encrypt(
		{ name: 'AES-GCM', iv: iv },
		await deriveKey(secret),
		plaintext
	);

	return {
		v: 1,
		ring: await deriveRingId(secret),
		iv: bytesToBase64(iv),
		data: bytesToBase64(new Uint8Array(ciphertext)),
	};
}

/** Reverses {@link sealSnapshot}. Throws when the secret is wrong or the data was altered. */
export async function openSnapshot(secret: Bytes, envelope: RingEnvelope): Promise<unknown> {
	let plaintext: ArrayBuffer;
	try {
		plaintext = await subtle().decrypt(
			{ name: 'AES-GCM', iv: base64ToBytes(envelope.iv) },
			await deriveKey(secret),
			base64ToBytes(envelope.data)
		);
	} catch {
		throw new RingDecryptionError(
			'This snapshot does not belong to your ring, or it was altered.'
		);
	}

	try {
		return JSON.parse(new TextDecoder().decode(plaintext));
	} catch {
		throw new RingDecryptionError('The snapshot decrypted but is not valid JSON.');
	}
}

/** Validates the outer, unencrypted structure of a ring file. */
export function isRingEnvelope(value: unknown): value is RingEnvelope {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<RingEnvelope>;
	return (
		candidate.v === 1 &&
		typeof candidate.ring === 'string' &&
		typeof candidate.iv === 'string' &&
		typeof candidate.data === 'string'
	);
}
