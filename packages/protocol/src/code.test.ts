// @vitest-environment node
// jsdom does not provide crypto.subtle, so these run on Node's Web Crypto.

import { describe, expect, it } from 'vitest';
import {
	InvalidRingCodeError,
	UnsupportedJoinCodeError,
	addressFromUrl,
	addressToUrl,
	formatJoinCode,
	formatRingCode,
	generateRingSecret,
	parseJoinCode,
	parseRingCode,
} from './code';
import type { JoinAddress } from './code';

const SHAPE = /^TBX1(-[0-9A-HJKMNP-TV-Z]{1,6})+$/;

function body(code: string): string {
	return code.replace(/^TBX1-/, '').replace(/-/g, '');
}

describe('join code', () => {
	it('is character for character the ring code when there is no address', () => {
		const secret = generateRingSecret();
		expect(formatJoinCode(secret)).toBe(formatRingCode(secret));
		expect(parseJoinCode(formatRingCode(secret))).toEqual({ secret });
	});

	it('costs eight characters for a server on the home network', () => {
		const secret = generateRingSecret();
		const address = addressFromUrl('http://10.112.156.244:8787');
		const code = formatJoinCode(secret, address);

		expect(body(code)).toHaveLength(body(formatRingCode(secret)).length + 8);
		expect(code).toMatch(SHAPE);
		// Pinned, because people compare these by eye across two screens.
		expect(body(code).slice(24)).toBe('019R9SX0');
	});

	it('round trips every kind of address, port and all', () => {
		const secret = generateRingSecret();
		// Written with the port throughout, because that is what comes back out:
		// an address travelling between devices carries its port explicitly.
		const urls = [
			'http://10.112.156.244:8787',
			'https://10.112.156.244:8787',
			'http://192.168.1.10:9000',
			'https://sync.example.com:443',
			'http://nas.local:8787',
			'https://sync.example.com:8443',
			'http://localhost:3000',
		];

		for (const url of urls) {
			const address = addressFromUrl(url);
			expect(address, url).toBeDefined();
			const parsed = parseJoinCode(formatJoinCode(secret, address));
			expect(parsed.secret, url).toEqual(secret);
			expect(parsed.address, url).toEqual(address);
			expect(addressToUrl(parsed.address as JoinAddress), url).toBe(url);
		}
	});

	it('keeps a port that happens to be the scheme default', () => {
		// The bug this pins: :80 printed as no port at all, and a local address
		// with no port is precisely what gets 8787 filled in on the next device.
		// The port someone typed became a different one, one hop later.
		const secret = generateRingSecret();
		for (const url of ['http://10.0.0.1:80', 'https://10.0.0.1:443']) {
			const parsed = parseJoinCode(formatJoinCode(secret, addressFromUrl(url)));
			expect(addressToUrl(parsed.address as JoinAddress), url).toBe(url);
		}
	});

	it('carries the ports worth naming for free', () => {
		const secret = generateRingSecret();
		const length = (url: string): number =>
			body(formatJoinCode(secret, addressFromUrl(url))).length - 24;

		expect(length('http://10.0.0.1:8787')).toBe(8);
		expect(length('https://10.0.0.1')).toBe(8); // 443
		expect(length('http://10.0.0.1')).toBe(8); // 80
		expect(length('http://10.0.0.1:9000')).toBe(11);
	});

	it('is deterministic', () => {
		const secret = generateRingSecret();
		const address = addressFromUrl('https://sync.example.com:8443');
		expect(formatJoinCode(secret, address)).toBe(formatJoinCode(secret, address));
	});

	it('still parses when typed with the Crockford lookalikes', () => {
		const secret = generateRingSecret();
		const code = formatJoinCode(secret, addressFromUrl('http://10.112.156.244:8787'));
		const typed = code.toLowerCase().replace(/1/g, 'I').replace(/0/g, 'O');

		expect(parseJoinCode(typed)).toEqual(parseJoinCode(code));
	});

	it('accepts sloppy input around the address too', () => {
		const secret = generateRingSecret();
		const code = formatJoinCode(secret, addressFromUrl('http://10.112.156.244:8787'));

		expect(parseJoinCode(code.replace(/-/g, ''))).toEqual(parseJoinCode(code));
		expect(parseJoinCode(`  ${code.toLowerCase()}  `)).toEqual(parseJoinCode(code));
	});

	it('parses a body that happens to start with the prefix', () => {
		// The prefix is only stripped when what is left still reads as a code, so a
		// secret whose own text begins TBX1 does not lose four characters.
		const secret = parseRingCode('TBX1-TBX111-111111-111111-111111');
		const code = formatRingCode(secret);
		expect(body(code).startsWith('TBX1')).toBe(true);
		expect(parseRingCode(code)).toEqual(secret);
		expect(parseRingCode(body(code))).toEqual(secret);
	});

	it('refuses a suffix that does not add up', () => {
		const secret = generateRingSecret();
		const code = formatJoinCode(secret, addressFromUrl('http://10.112.156.244:8787'));

		// One character short, one too many, and a last character carrying bits the
		// writer would have left at zero.
		expect(() => parseJoinCode(code.slice(0, -1))).toThrow(InvalidRingCodeError);
		expect(() => parseJoinCode(`${code}Z`)).toThrow(InvalidRingCodeError);
		expect(() => parseJoinCode(`${code.slice(0, -1)}Z`)).toThrow(InvalidRingCodeError);
	});

	it('says so when a code comes from a newer version', () => {
		// The reserved bit is the top bit of the first suffix character, so 'G' (16)
		// is the smallest suffix that claims a format this version does not know.
		const code = `${formatRingCode(generateRingSecret())}-G`;
		expect(() => parseJoinCode(code)).toThrow(UnsupportedJoinCodeError);
		expect(() => parseJoinCode(code)).toThrow(InvalidRingCodeError);
	});

	it('rejects a code of the wrong length', () => {
		expect(() => parseJoinCode('TBX1-ABC')).toThrow(InvalidRingCodeError);
	});
});

describe('addressFromUrl', () => {
	it('reads what it can', () => {
		expect(addressFromUrl('http://10.112.156.244:8787')).toEqual({
			scheme: 'http',
			host: '10.112.156.244',
			port: 8787,
		});
		expect(addressFromUrl('https://Sync.Example.com/')).toEqual({
			scheme: 'https',
			host: 'sync.example.com',
			port: 443,
		});
	});

	it('gives up quietly on anything that would not fit', () => {
		// Each of these leaves the join code short and the address typed by hand,
		// which is a better answer than refusing to show a code at all.
		expect(addressFromUrl('ftp://10.0.0.1')).toBeUndefined();
		expect(addressFromUrl('http://[::1]:8787')).toBeUndefined();
		expect(addressFromUrl('http://10.0.0.1/sync')).toBeUndefined();
		expect(addressFromUrl('http://user:pw@10.0.0.1')).toBeUndefined();
		expect(addressFromUrl('http://10.0.0.1?x=1')).toBeUndefined();
		expect(addressFromUrl(`https://${'a'.repeat(64)}.com`)).toBeUndefined();
		expect(addressFromUrl('not a url')).toBeUndefined();
	});

	it('falls back to the bare code rather than throwing', () => {
		const secret = generateRingSecret();
		expect(formatJoinCode(secret, addressFromUrl('ftp://10.0.0.1'))).toBe(
			formatRingCode(secret)
		);
	});
});
