/**
 * The ring code: what the user carries from one device to the next.
 *
 * 15 random bytes (120 bits) in Crockford base32 — 24 characters exactly, no
 * padding — grouped for typing on a phone:
 *
 *     TBX1-K3M9PQ-R7XZ2W-8HTVBN-4CDFG5
 *
 * Crockford's alphabet leaves out I, L, O and U, so there is nothing to confuse
 * with 1 and 0, and {@link parseRingCode} folds the lookalikes back in anyway.
 * The code is the whole secret: it derives the encryption key, and knowing it is
 * what authorises a device to read and write the ring.
 */

/**
 * Byte arrays backed by a plain ArrayBuffer. Web Crypto's `BufferSource` insists
 * on this over the wider `ArrayBufferLike`, so saying it once here keeps casts out
 * of every call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 15;
const CODE_CHARS = 24; // 15 bytes * 8 bits / 5 bits per char
const PREFIX = 'TBX1';
const GROUP = 6;

export class InvalidRingCodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidRingCodeError';
	}
}

function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';

	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += ALPHABET[(value >>> bits) & 31];
		}
	}

	if (bits > 0) {
		out += ALPHABET[(value << (5 - bits)) & 31];
	}
	return out;
}

function decodeBase32(text: string): Bytes {
	const bytes: number[] = [];
	let bits = 0;
	let value = 0;

	for (const char of text) {
		const index = ALPHABET.indexOf(char);
		if (index < 0) {
			throw new InvalidRingCodeError(`Not a valid character in a ring code: ${char}`);
		}
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((value >>> bits) & 255);
		}
	}

	return new Uint8Array(bytes);
}

/** Formats raw secret bytes as the code the user sees. */
export function formatRingCode(secret: Uint8Array): string {
	if (secret.length !== SECRET_BYTES) {
		throw new InvalidRingCodeError(`A ring secret is ${SECRET_BYTES} bytes`);
	}

	const encoded = encodeBase32(secret);
	const groups: string[] = [];
	for (let i = 0; i < encoded.length; i += GROUP) {
		groups.push(encoded.slice(i, i + GROUP));
	}
	return [PREFIX, ...groups].join('-');
}

/**
 * Parses a code the user typed or pasted. Tolerant about spacing, case, missing
 * dashes and the Crockford lookalikes; strict about everything else.
 */
export function parseRingCode(input: string): Bytes {
	const cleaned = input
		.toUpperCase()
		.replace(/[\s-]/g, '')
		.replace(/^TBX1/, '')
		.replace(/[IL]/g, '1')
		.replace(/O/g, '0');

	if (cleaned.length !== CODE_CHARS) {
		throw new InvalidRingCodeError(
			`A ring code has ${CODE_CHARS} characters after the prefix, this one has ${cleaned.length}`
		);
	}

	const bytes = decodeBase32(cleaned);
	// 24 base32 chars carry 120 bits exactly, so nothing should be left over.
	return bytes.slice(0, SECRET_BYTES);
}

/** A fresh random ring secret. */
export function generateRingSecret(): Bytes {
	const secret = new Uint8Array(SECRET_BYTES);
	globalThis.crypto.getRandomValues(secret);
	return secret;
}
