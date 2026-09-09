import { describe, expect, it } from 'vitest';
import { isUsableServerUrl, normaliseServerUrl, shouldAdopt } from './server-url';
import type { ServerUrlSource } from './server-url';

/**
 * Which address wins.
 *
 * The two failures this guards against pull in opposite directions: a ring that
 * overwrites an address someone chose on purpose, and a ring that can never
 * correct one it handed out itself. Both look like "sync stopped working" and
 * neither says anything on the way past.
 */

function device(serverUrl: string, serverUrlSource: ServerUrlSource = 'user') {
	return { serverUrl, serverUrlSource };
}

describe('shouldAdopt', () => {
	it('fills an empty slot', () => {
		expect(shouldAdopt(device(''), 'http://10.0.0.1:8787')).toBe('http://10.0.0.1:8787');
	});

	it('leaves an address the user typed alone', () => {
		// On a home network the host's address can be the one that is unreachable
		// here, so somebody who typed a different one meant it.
		expect(
			shouldAdopt(device('http://vpn.local:8787'), 'http://10.0.0.1:8787')
		).toBeUndefined();
	});

	it('replaces one that came from the ring', () => {
		// The other half: a server that moves is configured once on the host.
		expect(
			shouldAdopt(device('http://10.0.0.1:8787', 'ring'), 'https://sync.example.com')
		).toBe('https://sync.example.com');
	});

	it('says nothing when the address has not changed', () => {
		// The ring announces on every join and every snapshot read. Adopting the
		// same address again would repeat the notice and re-run the claim.
		expect(shouldAdopt(device('http://10.0.0.1:8787', 'ring'), 'http://10.0.0.1:8787/')).toBe(
			undefined
		);
	});

	it('refuses anything that is not a usable address', () => {
		for (const bad of ['', '  ', '10.0.0.1:8787', 'ftp://10.0.0.1', 'file:///etc/passwd']) {
			expect(shouldAdopt(device('', 'ring'), bad), bad).toBeUndefined();
		}
		expect(shouldAdopt(device(''), undefined)).toBeUndefined();
	});

	it('stores an address without its trailing slashes', () => {
		expect(shouldAdopt(device(''), 'http://10.0.0.1:8787//')).toBe('http://10.0.0.1:8787');
	});
});

describe('isUsableServerUrl', () => {
	it('takes the two schemes this speaks and nothing else', () => {
		expect(isUsableServerUrl('http://10.0.0.1:8787')).toBe(true);
		expect(isUsableServerUrl('https://sync.example.com')).toBe(true);
		expect(isUsableServerUrl('10.0.0.1:8787')).toBe(false);
		expect(isUsableServerUrl('ws://10.0.0.1:8787')).toBe(false);
	});
});

describe('normaliseServerUrl', () => {
	it('trims space and trailing slashes', () => {
		expect(normaliseServerUrl('  http://10.0.0.1:8787/  ')).toBe('http://10.0.0.1:8787');
	});
});
