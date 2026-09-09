import { bytesToHex, subtle } from './crypto';
import type { Bytes } from './code';

/**
 * How a file's bytes become something the server may hold.
 *
 * The order is compress, then encrypt — never the other way round. Ciphertext is
 * indistinguishable from noise and does not compress, so encrypting first would
 * throw the saving away.
 *
 * Wire format of a sealed blob:
 *
 *     [0]      format version
 *     [1]      flags, bit 0 = payload is gzip compressed
 *     [2..13]  AES-GCM initialisation vector
 *     [14..]   ciphertext including the authentication tag
 *
 * The server stores this opaquely. It cannot tell a note from an image, and
 * because AES-GCM authenticates, a server that altered a byte would be caught the
 * moment the client tried to open it.
 */

const FORMAT_VERSION = 1;
const FLAG_COMPRESSED = 1;
const IV_BYTES = 12;
const HEADER_BYTES = 2 + IV_BYTES;

/** Compression that pays for itself; below this, gzip's own header dominates. */
const MIN_COMPRESS_BYTES = 512;

export class BlobFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BlobFormatError';
	}
}

/** Content hash of the plaintext. Drives change detection and de-duplication. */
export async function hashContent(bytes: Uint8Array): Promise<string> {
	return bytesToHex(new Uint8Array(await subtle().digest('SHA-256', bytes as BufferSource)));
}

/**
 * Turns a content hash into the id the server files it under.
 *
 * Keyed with the vault's own name key, so two vaults holding an identical file
 * store it under different ids. Without this the server could tell that two
 * people have the same document.
 */
export async function deriveBlobId(nameKey: Bytes, contentHash: string): Promise<string> {
	const key = await subtle().importKey('raw', nameKey, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	const mac = await subtle().sign('HMAC', key, new TextEncoder().encode(contentHash));
	return bytesToHex(new Uint8Array(mac));
}

/**
 * The id a note's collaboration room is filed under.
 *
 * Keyed with the vault's own name key, exactly like a blob id, so the server can
 * route updates between the people editing one note without ever learning which
 * note that is — or that two vaults are editing a file of the same name.
 */
export async function deriveRoomId(nameKey: Bytes, path: string): Promise<string> {
	const key = await subtle().importKey('raw', nameKey, { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
	]);
	const mac = await subtle().sign('HMAC', key, new TextEncoder().encode(`room:${path}`));
	return bytesToHex(new Uint8Array(mac));
}

function canCompress(): boolean {
	return typeof CompressionStream !== 'undefined';
}

async function through(
	bytes: Uint8Array,
	stream: CompressionStream | DecompressionStream
): Promise<Bytes> {
	const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
	return new Uint8Array(await new Response(piped).arrayBuffer());
}

/** Seals plaintext for storage. Compresses only when it actually helps. */
export async function sealBlob(key: CryptoKey, plaintext: Uint8Array): Promise<Bytes> {
	let payload = plaintext;
	let flags = 0;

	if (canCompress() && plaintext.byteLength >= MIN_COMPRESS_BYTES) {
		const squeezed = await through(plaintext, new CompressionStream('gzip'));
		// Already-compressed files (images, archives) come out bigger.
		if (squeezed.byteLength < plaintext.byteLength) {
			payload = squeezed;
			flags |= FLAG_COMPRESSED;
		}
	}

	const iv = new Uint8Array(IV_BYTES);
	globalThis.crypto.getRandomValues(iv);

	const ciphertext = new Uint8Array(
		await subtle().encrypt({ name: 'AES-GCM', iv }, key, payload as BufferSource)
	);

	const sealed = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
	sealed[0] = FORMAT_VERSION;
	sealed[1] = flags;
	sealed.set(iv, 2);
	sealed.set(ciphertext, HEADER_BYTES);
	return sealed;
}

/** Reverses {@link sealBlob}. Throws if the bytes were altered or the key is wrong. */
export async function openBlob(key: CryptoKey, sealed: Uint8Array): Promise<Bytes> {
	if (sealed.byteLength <= HEADER_BYTES) {
		throw new BlobFormatError('Blob is too short to contain a header.');
	}
	if (sealed[0] !== FORMAT_VERSION) {
		throw new BlobFormatError(`Unknown blob format version: ${String(sealed[0])}`);
	}

	const flags = sealed[1] ?? 0;
	const iv = sealed.slice(2, HEADER_BYTES);

	let payload: Bytes;
	try {
		payload = new Uint8Array(
			await subtle().decrypt({ name: 'AES-GCM', iv }, key, sealed.slice(HEADER_BYTES))
		);
	} catch {
		throw new BlobFormatError('This blob does not belong to your vault, or it was altered.');
	}

	if ((flags & FLAG_COMPRESSED) === 0) {
		return payload;
	}
	if (typeof DecompressionStream === 'undefined') {
		throw new BlobFormatError('This blob is compressed but this device cannot decompress it.');
	}
	return through(payload, new DecompressionStream('gzip'));
}
