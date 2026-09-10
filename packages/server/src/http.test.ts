// @vitest-environment node

import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	deriveAuthToken,
	deriveBlobId,
	deriveContentKey,
	deriveNameKey,
	deriveVaultId,
	generateRingSecret,
	hashAuthToken,
	hashContent,
	openBlob,
	openSnapshot,
	sealBlob,
	sealSnapshot,
} from '@signet/protocol';
import type { Bytes, VaultManifest } from '@signet/protocol';
import type { ServerConfig } from './config';
import { createSyncServer } from './http';
import { VaultStore } from './storage';

/**
 * The end-to-end check: a real client secret, real encryption, and the real
 * server over a real socket.
 *
 * This is where client and server actually have to agree. The unit tests either
 * side of the wire can both pass while the two disagree about the format, and
 * that disagreement is exactly what loses data.
 */

const REGISTRATION_SECRET = 'r'.repeat(32);

let dir: string;
let base: string;
let close: () => Promise<void>;

let secret: Bytes;
let vaultId: string;
let token: string;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'signet-http-'));

	const config: ServerConfig = {
		host: '127.0.0.1',
		port: 0,
		dataDir: dir,
		registrationSecret: REGISTRATION_SECRET,
		maxBlobBytes: 1024 * 1024,
		maxManifestBytes: 1024 * 1024,
	};

	const server = createSyncServer(config, new VaultStore(dir));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
	close = () => new Promise<void>((resolve) => server.close(() => resolve()));

	secret = generateRingSecret();
	vaultId = await deriveVaultId(secret);
	token = await deriveAuthToken(secret);
});

afterAll(async () => {
	await close();
	await rm(dir, { recursive: true, force: true });
});

function authed(extra: HeadersInit = {}): HeadersInit {
	return { authorization: `Bearer ${token}`, ...extra };
}

async function register(): Promise<Response> {
	return fetch(`${base}/v1/vaults/${vaultId}/register`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-registration-secret': REGISTRATION_SECRET,
		},
		body: JSON.stringify({ tokenHash: await hashAuthToken(token) }),
	});
}

function manifest(seq: number, files: VaultManifest['files']): VaultManifest {
	return {
		version: 1,
		seq,
		device: { id: 'device-a', name: 'Desktop' },
		updatedAt: new Date().toISOString(),
		files,
		deleted: [],
	};
}

async function push(seq: number, files: VaultManifest['files']): Promise<Response> {
	return fetch(`${base}/v1/vaults/${vaultId}/commits`, {
		method: 'POST',
		headers: authed({ 'content-type': 'application/json' }),
		body: JSON.stringify({
			baseSeq: seq - 1,
			manifest: await sealSnapshot(secret, manifest(seq, files)),
		}),
	});
}

describe('the server on its own', () => {
	it('answers health without a token', async () => {
		const response = await fetch(`${base}/v1/health`);
		await expect(response.json()).resolves.toMatchObject({ ok: true, protocol: 1 });
	});

	it('refuses to create a vault without the registration secret', async () => {
		const response = await fetch(`${base}/v1/vaults/${vaultId}/register`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-registration-secret': 'wrong' },
			body: JSON.stringify({ tokenHash: 'a'.repeat(64) }),
		});
		expect(response.status).toBe(403);
	});

	it('rejects a vault id that tries to climb out of the data directory', async () => {
		const response = await fetch(`${base}/v1/vaults/..%2F..%2Fetc/head`, { headers: authed() });
		expect([400, 404]).toContain(response.status);
	});
});

describe('a vault, end to end', () => {
	it('registers once', async () => {
		expect((await register()).status).toBe(201);
		// Registering again is not an error, but it must not re-key the vault.
		expect((await register()).status).toBe(200);
	});

	it('turns away a caller without the right token', async () => {
		const wrong = await deriveAuthToken(generateRingSecret());

		expect((await fetch(`${base}/v1/vaults/${vaultId}/head`)).status).toBe(401);
		expect(
			(
				await fetch(`${base}/v1/vaults/${vaultId}/head`, {
					headers: { authorization: `Bearer ${wrong}` },
				})
			).status
		).toBe(401);
	});

	it('starts at commit zero', async () => {
		const response = await fetch(`${base}/v1/vaults/${vaultId}/head`, { headers: authed() });
		await expect(response.json()).resolves.toEqual({ seq: 0, updatedAt: null });
	});

	it('carries a note there and back, encrypted the whole way', async () => {
		const plaintext = new TextEncoder().encode('# Aktueller Arbeit\n\nEtwas Vertrauliches.\n');

		const contentKey = await deriveContentKey(secret);
		const nameKey = await deriveNameKey(secret);
		const contentHash = await hashContent(plaintext);
		const blobId = await deriveBlobId(nameKey, contentHash);

		const put = await fetch(`${base}/v1/vaults/${vaultId}/blobs/${blobId}`, {
			method: 'PUT',
			headers: authed({ 'content-type': 'application/octet-stream' }),
			body: await sealBlob(contentKey, plaintext),
		});
		expect(put.status).toBe(201);

		const committed = await push(1, [
			{
				path: 'Arbeit/Aktueller Arbeit.md',
				hash: contentHash,
				blob: blobId,
				size: plaintext.byteLength,
				mtime: Date.now(),
			},
		]);
		expect(committed.status).toBe(201);
		await expect(committed.json()).resolves.toEqual({ seq: 1 });

		// Now read it back the way a second device would.
		const commit = await fetch(`${base}/v1/vaults/${vaultId}/commits/1`, { headers: authed() });
		const pulled = (await openSnapshot(secret, await commit.json())) as VaultManifest;
		expect(pulled.files[0]?.path).toBe('Arbeit/Aktueller Arbeit.md');

		const blob = await fetch(`${base}/v1/vaults/${vaultId}/blobs/${blobId}`, {
			headers: authed(),
		});
		const restored = await openBlob(contentKey, new Uint8Array(await blob.arrayBuffer()));
		expect(new TextDecoder().decode(restored)).toBe(new TextDecoder().decode(plaintext));
	});

	it('stores nothing the server could read', async () => {
		const commit = await fetch(`${base}/v1/vaults/${vaultId}/commits/1`, { headers: authed() });
		const stored = JSON.stringify(await commit.json());

		// The path is in the manifest, but the manifest is sealed. If this ever
		// fails, the encryption has stopped happening.
		expect(stored).not.toContain('Aktueller Arbeit');
		expect(stored).not.toContain('Vertrauliches');
	});

	it('refuses a push from a device that has not caught up', async () => {
		// Both devices think the head is 1; only the first may win.
		const stale = await push(2, []);
		expect(stale.status).toBe(201);

		const second = await fetch(`${base}/v1/vaults/${vaultId}/commits`, {
			method: 'POST',
			headers: authed({ 'content-type': 'application/json' }),
			body: JSON.stringify({
				baseSeq: 1,
				manifest: await sealSnapshot(secret, manifest(2, [])),
			}),
		});
		expect(second.status).toBe(409);
		await expect(second.json()).resolves.toMatchObject({ head: 2 });
	});

	it('keeps the earlier commit after the vault moves on', async () => {
		const first = await fetch(`${base}/v1/vaults/${vaultId}/commits/1`, { headers: authed() });
		expect(first.status).toBe(200);

		const pulled = (await openSnapshot(secret, await first.json())) as VaultManifest;
		expect(pulled.files).toHaveLength(1);
	});

	it('parks a request and wakes it the moment another device commits', async () => {
		const head = await (
			await fetch(`${base}/v1/vaults/${vaultId}/head`, { headers: authed() })
		).json();
		const at = (head as { seq: number }).seq;

		// One device settles in to wait...
		const parked = fetch(`${base}/v1/vaults/${vaultId}/head?since=${String(at)}&wait=20`, {
			headers: authed(),
		});

		// ...and only afterwards does another one commit.
		await new Promise((resolve) => setTimeout(resolve, 50));
		const committed = await push(at + 1, []);
		expect(committed.status).toBe(201);

		// The waiting device is told straight away rather than after its full wait.
		const woken = (await (await parked).json()) as { seq: number };
		expect(woken.seq).toBe(at + 1);
	}, 25_000);

	it('answers a parked request when the wait runs out, without an error', async () => {
		const head = await (
			await fetch(`${base}/v1/vaults/${vaultId}/head`, { headers: authed() })
		).json();
		const at = (head as { seq: number }).seq;

		const started = Date.now();
		const response = await fetch(
			`${base}/v1/vaults/${vaultId}/head?since=${String(at)}&wait=1`,
			{
				headers: authed(),
			}
		);

		// Nothing happened; that is an ordinary answer, not a failure.
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ seq: at });
		expect(Date.now() - started).toBeGreaterThanOrEqual(900);
	}, 10_000);

	it('rejects a manifest that is not a sealed envelope', async () => {
		const response = await fetch(`${base}/v1/vaults/${vaultId}/commits`, {
			method: 'POST',
			headers: authed({ 'content-type': 'application/json' }),
			body: JSON.stringify({ baseSeq: 2, manifest: { plain: 'text' } }),
		});
		expect(response.status).toBe(400);
	});
});
