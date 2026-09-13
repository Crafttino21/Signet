import { describe, expect, it } from 'vitest';
import {
	completeServerUrl,
	isInsecureRemote,
	isUsableServerUrl,
	normaliseServerUrl,
	shouldAdopt,
	withDefaultPort,
} from './server-url';
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

describe('completeServerUrl', () => {
	it('fills in the port for a server on this network', () => {
		// The bug this exists for: http://10.112.156.244 is a valid URL meaning port
		// 80, nothing is listening there, and the result is "connection refused" for
		// a server that is running perfectly well.
		expect(completeServerUrl('http://10.112.156.244')).toBe('http://10.112.156.244:8787');
		expect(completeServerUrl('http://localhost')).toBe('http://localhost:8787');
		expect(completeServerUrl('http://nas.local')).toBe('http://nas.local:8787');
	});

	it('leaves a port alone once there is one', () => {
		expect(completeServerUrl('http://10.0.0.1:9000')).toBe('http://10.0.0.1:9000');
		expect(completeServerUrl('http://10.0.0.1:80')).toBe('http://10.0.0.1:80');
	});

	it('does not guess for a public name or for https', () => {
		// A name resolved on the internet, or anything behind TLS, means a proxy is
		// in front of the server and 443 is the answer the user intended.
		expect(completeServerUrl('https://10.0.0.1')).toBe('https://10.0.0.1');
		expect(completeServerUrl('https://sync.example.com')).toBe('https://sync.example.com');
		expect(completeServerUrl('http://sync.example.com')).toBe('http://sync.example.com');
	});

	it('hands back anything it cannot read, for the caller to reject', () => {
		expect(completeServerUrl('  10.0.0.1:8787 ')).toBe('10.0.0.1:8787');
		expect(completeServerUrl('')).toBe('');
	});
});

describe('withDefaultPort', () => {
	it('offers the port the server actually listens on', () => {
		// The address that cost two evenings: a port was given, so nothing was
		// guessed, and port 80 refuses the connection.
		expect(withDefaultPort('http://10.112.156.244:80')).toBe('http://10.112.156.244:8787');
		expect(withDefaultPort('http://10.112.156.244')).toBe('http://10.112.156.244:8787');
		expect(withDefaultPort('https://sync.example.com')).toBe('https://sync.example.com:8787');
	});

	it('has nothing to offer when the port is already right', () => {
		expect(withDefaultPort('http://10.0.0.1:8787')).toBeUndefined();
	});

	it('gives up on anything it cannot read', () => {
		expect(withDefaultPort('10.0.0.1:80')).toBeUndefined();
		expect(withDefaultPort('ftp://10.0.0.1')).toBeUndefined();
		expect(withDefaultPort('')).toBeUndefined();
	});
});

describe('isInsecureRemote', () => {
	it('warns about plain http to a host outside your network', () => {
		// The notes are sealed before they leave; the token is not.
		expect(isInsecureRemote('http://sync.example.com')).toBe(true);
		expect(isInsecureRemote('http://sync.example.com:8787')).toBe(true);
		expect(isInsecureRemote('http://8.8.8.8:8787')).toBe(true);
	});

	it('says nothing about https, wherever it points', () => {
		expect(isInsecureRemote('https://sync.example.com')).toBe(false);
		expect(isInsecureRemote('https://192.168.1.10:8787')).toBe(false);
	});

	it('says nothing about your own network', () => {
		for (const url of [
			'http://localhost:8787',
			'http://127.0.0.1:8787',
			'http://10.0.0.5:8787',
			'http://172.16.4.1:8787',
			'http://172.31.255.1:8787',
			'http://192.168.1.10:8787',
			'http://nas.local:8787',
		]) {
			expect(isInsecureRemote(url)).toBe(false);
		}
	});

	it('is stricter than the port-guessing check it sits beside', () => {
		// `completeServerUrl` treats any dotted quad as local because it is deciding
		// which port to assume, and being wrong there costs nothing. Being wrong
		// about whether a network can be trusted costs the token.
		expect(completeServerUrl('http://8.8.8.8')).toBe('http://8.8.8.8:8787');
		expect(isInsecureRemote('http://8.8.8.8')).toBe(true);
	});

	it('says nothing about something that is not an address yet', () => {
		// Half-typed input is told about separately, and a warning that flickers
		// while somebody types is a warning they learn to ignore.
		expect(isInsecureRemote('')).toBe(false);
		expect(isInsecureRemote('sync.example.com')).toBe(false);
		expect(isInsecureRemote('http://')).toBe(false);
	});
});
