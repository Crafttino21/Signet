// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSyncServer } from './http';
import { VaultStore } from './storage';

/**
 * The page at `/`, which exists for a person with a browser.
 *
 * It answers one question the rest of the server cannot: *is the name I just
 * pointed at this machine actually arriving here?* That makes two things worth
 * pinning down — that it reports the address as the **caller** sees it rather
 * than as the server is configured, since those differ by exactly the proxy hop
 * being tested; and that the `Host` header it echoes back cannot become markup,
 * because that header is chosen by whoever is calling.
 */

let dir: string;
let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'signet-status-'));
	const server = createSyncServer(
		{
			host: '127.0.0.1',
			port: 0,
			dataDir: dir,
			registrationSecret: 'r'.repeat(32),
			maxBlobBytes: 1024,
			maxManifestBytes: 1024,
			maxVaultBytes: 0,
		},
		new VaultStore(dir)
	);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
	close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});

afterAll(async () => {
	await close();
	await rm(dir, { recursive: true, force: true });
});

describe('the page at the root', () => {
	it('is a page rather than a protocol error', async () => {
		// It used to be `{"error":"No such endpoint."}`, which is correct and tells
		// somebody checking a new domain nothing at all.
		const response = await fetch(`${base}/`);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');
		expect(await response.text()).toContain('Signet sync server');
	});

	it('reports the address the caller reached it on, not the one it listens on', async () => {
		// The whole point: this server listens on 127.0.0.1 on a random port, and
		// the answer has to be the public name, because that is what goes into the
		// plugin and what the proxy hop is being checked for.
		const response = await fetch(`${base}/`, {
			headers: {
				'x-forwarded-proto': 'https',
				'x-forwarded-host': 'signet.example.com',
			},
		});
		const body = await response.text();

		expect(body).toContain('https://signet.example.com');
		expect(body).not.toContain('127.0.0.1');
	});

	it('warns when it was reached without TLS', async () => {
		const body = await (await fetch(`${base}/`)).text();

		// The notes are sealed either way; the access token is not.
		expect(body).toContain('plain HTTP');
	});

	it('does not warn when a proxy terminated TLS', async () => {
		const body = await (
			await fetch(`${base}/`, { headers: { 'x-forwarded-proto': 'https' } })
		).text();

		expect(body).not.toContain('plain HTTP');
	});

	it('cannot be made to serve markup through the host header', async () => {
		const body = await (
			await fetch(`${base}/`, {
				headers: { 'x-forwarded-host': 'a"><script>alert(1)</script>' },
			})
		).text();

		expect(body).not.toContain('<script>alert(1)</script>');
		expect(body).toContain('&lt;script&gt;');
	});

	it('says nothing a caller without credentials should not know', async () => {
		// Which vaults exist, and how many, is the thing `/v1/health` deliberately
		// leaves out. A page anybody can open must not put it back.
		await new VaultStore(dir).register('f'.repeat(32), 'a'.repeat(64));
		const body = await (await fetch(`${base}/`)).text();

		expect(body).not.toContain('f'.repeat(32));
		expect(body).not.toMatch(/\bvaults?\s*[:=]\s*\d/i);
	});

	it('leaves the protocol routes exactly as they were', async () => {
		const response = await fetch(`${base}/v1/health`);

		expect(response.headers.get('content-type')).toContain('application/json');
		expect(await response.json()).toEqual({ ok: true, protocol: 1 });
	});

	it('still refuses an endpoint that does not exist', async () => {
		const response = await fetch(`${base}/nope`);

		expect(response.status).toBe(404);
		expect(response.headers.get('content-type')).toContain('application/json');
	});
});
