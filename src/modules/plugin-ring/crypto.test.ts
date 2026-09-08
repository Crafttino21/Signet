// @vitest-environment node
// jsdom does not provide crypto.subtle, so these run on Node's Web Crypto.

import { describe, expect, it } from 'vitest';
import { formatRingCode, generateRingSecret, parseRingCode, InvalidRingCodeError } from './code';
import {
	deriveRingId,
	isRingEnvelope,
	openSnapshot,
	RingDecryptionError,
	sealSnapshot,
} from './crypto';

const snapshot = { version: 1, seq: 3, host: { id: 'a', name: 'Desktop' }, plugins: [] };

describe('ring code', () => {
	it('survives a round trip through the printed form', () => {
		const secret = generateRingSecret();
		expect(parseRingCode(formatRingCode(secret))).toEqual(secret);
	});

	it('looks like a code a person can type', () => {
		const code = formatRingCode(generateRingSecret());
		expect(code).toMatch(/^TBX1(-[0-9A-HJKMNP-TV-Z]{6}){4}$/);
	});

	it('accepts sloppy input', () => {
		const secret = generateRingSecret();
		const code = formatRingCode(secret);

		expect(parseRingCode(code.toLowerCase())).toEqual(secret);
		expect(parseRingCode(code.replace(/-/g, ''))).toEqual(secret);
		expect(parseRingCode(`  ${code}  `)).toEqual(secret);
	});

	it('folds the characters Crockford leaves out onto their lookalikes', () => {
		// A code containing 1 and 0 must also parse when typed with I, L and O.
		const typed = 'TBX1-10ABCD-EFGHJK-MNPQRS-TVWXYZ';
		const lookalikes = 'TBX1-IOABCD-EFGHJK-MNPQRS-TVWXYZ';
		expect(parseRingCode(lookalikes)).toEqual(parseRingCode(typed));
	});

	it('rejects a code of the wrong length', () => {
		expect(() => parseRingCode('TBX1-ABC')).toThrow(InvalidRingCodeError);
	});
});

describe('snapshot encryption', () => {
	it('round trips a snapshot', async () => {
		const secret = generateRingSecret();
		const envelope = await sealSnapshot(secret, snapshot);

		expect(isRingEnvelope(envelope)).toBe(true);
		await expect(openSnapshot(secret, envelope)).resolves.toEqual(snapshot);
	});

	it('uses a fresh IV every time', async () => {
		const secret = generateRingSecret();
		const first = await sealSnapshot(secret, snapshot);
		const second = await sealSnapshot(secret, snapshot);

		// Reusing an IV with the same key would break AES-GCM outright, so this is
		// a correctness requirement rather than a nicety.
		expect(first.iv).not.toBe(second.iv);
		expect(first.data).not.toBe(second.data);
	});

	it('refuses a snapshot sealed with a different secret', async () => {
		const envelope = await sealSnapshot(generateRingSecret(), snapshot);
		await expect(openSnapshot(generateRingSecret(), envelope)).rejects.toThrow(
			RingDecryptionError
		);
	});

	it('refuses a snapshot whose ciphertext was altered', async () => {
		const secret = generateRingSecret();
		const envelope = await sealSnapshot(secret, snapshot);
		const flipped = envelope.data.startsWith('A')
			? `B${envelope.data.slice(1)}`
			: `A${envelope.data.slice(1)}`;

		await expect(openSnapshot(secret, { ...envelope, data: flipped })).rejects.toThrow(
			RingDecryptionError
		);
	});

	it('derives a stable ring id that differs per secret', async () => {
		const secret = generateRingSecret();
		const id = await deriveRingId(secret);

		expect(id).toMatch(/^[0-9a-f]{16}$/);
		await expect(deriveRingId(secret)).resolves.toBe(id);
		await expect(deriveRingId(generateRingSecret())).resolves.not.toBe(id);
	});

	it('puts the ring id in the clear so a device can recognise its own ring', async () => {
		const secret = generateRingSecret();
		const envelope = await sealSnapshot(secret, snapshot);
		await expect(deriveRingId(secret)).resolves.toBe(envelope.ring);
	});

	it('rejects anything that is not an envelope', () => {
		expect(isRingEnvelope(null)).toBe(false);
		expect(isRingEnvelope({ v: 2, ring: 'a', iv: 'b', data: 'c' })).toBe(false);
		expect(isRingEnvelope({ v: 1, ring: 'a' })).toBe(false);
	});
});
