// @vitest-environment node
// jsdom does not provide crypto.subtle, so these run on Node's Web Crypto.

import { describe, expect, it } from 'vitest';
import { generateRingSecret } from './code';
import { deriveContentKey } from './keys';
import { BlobFormatError, hashContent, openBlob, sealBlob } from './blob';

/**
 * The bug this file exists for: the blob header used to travel unauthenticated.
 *
 * Byte 1 tells the reader whether to gunzip what comes out of the decryption, and
 * it sat outside what AES-GCM covers while being acted upon. A server — the one
 * party this design declares untrusted — could clear bit 0, the tag would still
 * verify, nothing would raise an error, and the client would hand Obsidian a gzip
 * stream as the note's text. The next commit would write that back as the file.
 *
 * So the tests below are mostly about bytes that are *not* the ciphertext.
 */

const HEADER_BYTES = 14;

async function key(): Promise<CryptoKey> {
	return deriveContentKey(generateRingSecret());
}

/** Text long enough to be worth compressing, so the flag is actually set. */
function compressible(): Uint8Array {
	return new TextEncoder().encode('# Notes\n\n'.repeat(400));
}

function flipped(sealed: Uint8Array, at: number, mask = 1): Uint8Array {
	const copy = sealed.slice();
	copy[at] = (copy[at] ?? 0) ^ mask;
	return copy;
}

describe('sealBlob and openBlob', () => {
	it('round-trips content too short to compress', async () => {
		const k = await key();
		const plaintext = new TextEncoder().encode('short note');
		expect(await openBlob(k, await sealBlob(k, plaintext))).toEqual(plaintext);
	});

	it('round-trips content that does compress', async () => {
		const k = await key();
		const plaintext = compressible();
		const sealed = await sealBlob(k, plaintext);

		// Worth asserting, or the compression tests below silently test nothing.
		expect(sealed[1]).toBe(1);
		expect(sealed.byteLength).toBeLessThan(plaintext.byteLength);
		expect(await openBlob(k, sealed)).toEqual(plaintext);
	});

	it('writes the authenticated format', async () => {
		const k = await key();
		expect((await sealBlob(k, new TextEncoder().encode('x')))[0]).toBe(2);
	});

	it('refuses a blob sealed for another vault', async () => {
		const sealed = await sealBlob(await key(), new TextEncoder().encode('x'));
		await expect(openBlob(await key(), sealed)).rejects.toThrow(BlobFormatError);
	});

	it('refuses a flipped compression flag instead of returning gzip as text', async () => {
		// The finding, exactly. Before the header was authenticated this call
		// succeeded and returned the gzip stream as if it were the note.
		const k = await key();
		const sealed = await sealBlob(k, compressible());
		expect(sealed[1]).toBe(1);

		await expect(openBlob(k, flipped(sealed, 1))).rejects.toThrow(BlobFormatError);
	});

	it('refuses a compression flag set on something that is not compressed', async () => {
		const k = await key();
		const sealed = await sealBlob(k, new TextEncoder().encode('short note'));
		expect(sealed[1]).toBe(0);

		await expect(openBlob(k, flipped(sealed, 1))).rejects.toThrow(BlobFormatError);
	});

	it('refuses a flipped version byte', async () => {
		const k = await key();
		const sealed = await sealBlob(k, new TextEncoder().encode('x'));
		// 2 -> 3 is an unknown version and is refused on sight; 2 -> 1 claims the
		// old format, which is known, and has to fail on the tag instead.
		await expect(openBlob(k, flipped(sealed, 0, 1))).rejects.toThrow(BlobFormatError);
		await expect(openBlob(k, flipped(sealed, 0, 3))).rejects.toThrow(BlobFormatError);
	});

	it('refuses a flipped IV', async () => {
		const k = await key();
		const sealed = await sealBlob(k, new TextEncoder().encode('x'));
		await expect(openBlob(k, flipped(sealed, 5))).rejects.toThrow(BlobFormatError);
	});

	it('refuses a flipped ciphertext byte', async () => {
		const k = await key();
		const sealed = await sealBlob(k, new TextEncoder().encode('x'));
		await expect(openBlob(k, flipped(sealed, HEADER_BYTES))).rejects.toThrow(BlobFormatError);
	});

	it('refuses something too short to hold a header', async () => {
		await expect(openBlob(await key(), new Uint8Array(HEADER_BYTES))).rejects.toThrow(
			BlobFormatError
		);
	});

	it('still opens a blob written in the old format', async () => {
		// Every blob already on a server is a version 1, and nothing rewrites a
		// blob — so refusing them would break a vault that has been syncing for
		// months. They are opened; they are simply never written again.
		const k = await key();
		const plaintext = new TextEncoder().encode('written before the fix');
		const legacy = await sealLegacyBlob(k, plaintext);

		expect(legacy[0]).toBe(1);
		expect(await openBlob(k, legacy)).toEqual(plaintext);
	});
});

describe('hashContent', () => {
	it('is stable and content-addressed', async () => {
		const a = new TextEncoder().encode('same');
		const b = new TextEncoder().encode('same');
		expect(await hashContent(a)).toBe(await hashContent(b));
		expect(await hashContent(a)).not.toBe(await hashContent(new TextEncoder().encode('other')));
	});
});

/**
 * Version 1 as it was written, so the compatibility path is tested against the
 * real thing rather than against a hand-built approximation of it.
 *
 * Uncompressed on purpose: the flag is what version 1 failed to protect, and a
 * legacy blob that needs gunzipping is the one whose flag we still cannot trust.
 * Keeping this simple keeps the test about the version byte.
 */
async function sealLegacyBlob(k: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
	const iv = new Uint8Array(12);
	crypto.getRandomValues(iv);

	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, plaintext as BufferSource)
	);

	const sealed = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
	sealed[0] = 1;
	sealed[1] = 0;
	sealed.set(iv, 2);
	sealed.set(ciphertext, HEADER_BYTES);
	return sealed;
}
