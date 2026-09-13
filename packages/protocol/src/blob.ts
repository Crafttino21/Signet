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
 * The header travels in the clear, and from version 2 it is also **authenticated**:
 * those fourteen bytes are passed to AES-GCM as additional data, so altering any
 * of them makes decryption fail.
 *
 * Version 1 did not do that, and the gap was not academic. The flags byte tells the
 * reader whether to gunzip what comes out, and it sat outside the authentication
 * while being acted upon. A server — the one party this design declares untrusted —
 * could clear bit 0 on a stored blob, the tag would still verify, no error would be
 * raised anywhere, and the client would hand Obsidian a gzip stream as if it were
 * the note's text. The next commit would then write that back as the file's
 * contents. Silent corruption, by the party explicitly not trusted, needing nothing
 * but one flipped bit.
 *
 * The IV never needed this: AES-GCM binds it cryptographically, so a changed IV
 * fails the tag on its own. It is covered anyway because covering the whole header
 * is one expression and leaves nothing to reason about later.
 */

/** What new blobs are written as: the header is authenticated. */
const FORMAT_VERSION = 2;

/**
 * The first format, whose header was not authenticated.
 *
 * Still read, because every blob already on a server is one of these and they are
 * not rewritten — nothing in this design ever rewrites a blob. Still opened rather
 * than refused, because refusing would be a worse outcome than the weakness: a
 * vault that will not sync is certain damage, where a server willing to flip bits
 * in it is a possibility. New blobs are never written in this format.
 */
const LEGACY_FORMAT_VERSION = 1;

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

	// The header is built before the encryption rather than after it, because it
	// is an input to it: these are the bytes AES-GCM authenticates alongside the
	// ciphertext, and the tag has to cover the flags the reader will act on.
	const header = new Uint8Array(HEADER_BYTES);
	header[0] = FORMAT_VERSION;
	header[1] = flags;
	header.set(iv, 2);

	const ciphertext = new Uint8Array(
		await subtle().encrypt(
			{ name: 'AES-GCM', iv, additionalData: header as BufferSource },
			key,
			payload as BufferSource
		)
	);

	const sealed = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
	sealed.set(header, 0);
	sealed.set(ciphertext, HEADER_BYTES);
	return sealed;
}

/** Reverses {@link sealBlob}. Throws if the bytes were altered or the key is wrong. */
export async function openBlob(key: CryptoKey, sealed: Uint8Array): Promise<Bytes> {
	if (sealed.byteLength <= HEADER_BYTES) {
		throw new BlobFormatError('Blob is too short to contain a header.');
	}

	const version = sealed[0];
	if (version !== FORMAT_VERSION && version !== LEGACY_FORMAT_VERSION) {
		throw new BlobFormatError(`Unknown blob format version: ${String(version)}`);
	}

	const flags = sealed[1] ?? 0;
	const iv = sealed.slice(2, HEADER_BYTES);

	let payload: Bytes;
	try {
		payload = new Uint8Array(
			await subtle().decrypt(
				{
					name: 'AES-GCM',
					iv,
					// Version 1 sealed nothing alongside the ciphertext, so asking for
					// the header back would fail every blob written before this change.
					...(version === FORMAT_VERSION
						? { additionalData: sealed.slice(0, HEADER_BYTES) as BufferSource }
						: {}),
				},
				key,
				sealed.slice(HEADER_BYTES)
			)
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
