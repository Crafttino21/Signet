import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { isRingEnvelope, isSafeId, PROTOCOL_VERSION } from '@toolbox/protocol';
import type { ErrorResponse, HeadResponse, PushResponse, RegisterRequest } from '@toolbox/protocol';
import type { ServerConfig } from './config';
import { secretsMatch, sha256Hex } from './storage';
import type { VaultStore } from './storage';

/**
 * The HTTP surface. Deliberately tiny and dependency-free: the whole server is
 * `node:http` plus the filesystem, so there is no framework to keep patched on a
 * machine that holds someone's notes.
 *
 * Every route needs a bearer token derived from the ring code, except health and
 * registration. The server only ever compares hashes, so its own disk never holds
 * anything that would let an attacker write to a vault.
 */

interface Context {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
	params: string[];
	config: ServerConfig;
	store: VaultStore;
}

interface Route {
	method: string;
	pattern: RegExp;
	handler: (ctx: Context) => Promise<void>;
}

/** Long enough to be worth parking, short enough that proxies do not cut it off. */
const MAX_WAIT_SECONDS = 55;

class RequestTooLarge extends Error {
	constructor(readonly limit: number) {
		super(`Body exceeds ${String(limit)} bytes`);
		this.name = 'RequestTooLarge';
	}
}

function send(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		'content-type': 'application/json',
		'content-length': Buffer.byteLength(payload),
	});
	res.end(payload);
}

function fail(res: ServerResponse, status: number, message: string): void {
	send(res, status, { error: message } satisfies ErrorResponse);
}

function sendBytes(res: ServerResponse, contentType: string, body: Buffer): void {
	res.writeHead(200, { 'content-type': contentType, 'content-length': body.byteLength });
	res.end(body);
}

/** Reads a body, refusing anything over the limit rather than buffering it all. */
async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let total = 0;

	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		total += buffer.byteLength;
		if (total > limit) {
			throw new RequestTooLarge(limit);
		}
		chunks.push(buffer);
	}

	return Buffer.concat(chunks);
}

function bearer(req: IncomingMessage): string | undefined {
	const header = req.headers.authorization;
	if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
		return undefined;
	}
	return header.slice('Bearer '.length).trim();
}

/** Proves the caller belongs to the vault, or answers the request itself. */
async function authorise(ctx: Context, vaultId: string): Promise<boolean> {
	if (!isSafeId(vaultId)) {
		fail(ctx.res, 400, 'Malformed vault id.');
		return false;
	}

	const auth = await ctx.store.readAuth(vaultId);
	const token = bearer(ctx.req);

	// One answer for every failure: a caller without a valid token must not be
	// able to learn which vaults exist on this server.
	if (!auth || !token || !secretsMatch(sha256Hex(token), auth.tokenHash)) {
		fail(ctx.res, 401, 'Unauthorised.');
		return false;
	}
	return true;
}

const routes: Route[] = [
	{
		method: 'GET',
		pattern: /^\/v1\/health$/,
		handler: async (ctx) => {
			send(ctx.res, 200, {
				ok: true,
				protocol: PROTOCOL_VERSION,
				...(await ctx.store.stats()),
			});
		},
	},

	{
		method: 'POST',
		pattern: /^\/v1\/vaults\/([^/]+)\/register$/,
		handler: async (ctx) => {
			const vaultId = ctx.params[0] ?? '';
			if (!isSafeId(vaultId)) {
				fail(ctx.res, 400, 'Malformed vault id.');
				return;
			}

			const offered = ctx.req.headers['x-registration-secret'];
			if (
				typeof offered !== 'string' ||
				!secretsMatch(offered, ctx.config.registrationSecret)
			) {
				fail(ctx.res, 403, 'Registration secret is wrong.');
				return;
			}

			const body = JSON.parse(
				(await readBody(ctx.req, 4096)).toString('utf8')
			) as RegisterRequest;
			if (typeof body.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(body.tokenHash)) {
				fail(ctx.res, 400, 'tokenHash must be a SHA-256 hex digest.');
				return;
			}

			const outcome = await ctx.store.register(vaultId, body.tokenHash);
			send(ctx.res, outcome === 'created' ? 201 : 200, { status: outcome });
		},
	},

	{
		method: 'GET',
		pattern: /^\/v1\/vaults\/([^/]+)\/head$/,
		handler: async (ctx) => {
			const vaultId = ctx.params[0] ?? '';
			if (!(await authorise(ctx, vaultId))) {
				return;
			}

			// `?since=N&wait=S` parks the request until the vault moves past N. That
			// is what lets an open app react within a second of another device
			// committing, without polling in a loop.
			const wait = Number(ctx.url.searchParams.get('wait') ?? '0');
			const since = Number(ctx.url.searchParams.get('since') ?? '-1');

			if (Number.isFinite(wait) && wait > 0 && Number.isFinite(since) && since >= 0) {
				const seconds = Math.min(wait, MAX_WAIT_SECONDS);
				send(
					ctx.res,
					200,
					(await ctx.store.waitForChange(
						vaultId,
						since,
						seconds * 1000
					)) satisfies HeadResponse
				);
				return;
			}

			send(ctx.res, 200, (await ctx.store.readHead(vaultId)) satisfies HeadResponse);
		},
	},

	{
		method: 'GET',
		pattern: /^\/v1\/vaults\/([^/]+)\/commits\/(\d{1,12})$/,
		handler: async (ctx) => {
			const vaultId = ctx.params[0] ?? '';
			if (!(await authorise(ctx, vaultId))) {
				return;
			}

			const commit = await ctx.store.readCommit(vaultId, Number(ctx.params[1]));
			if (!commit) {
				fail(ctx.res, 404, 'No such commit.');
				return;
			}
			sendBytes(ctx.res, 'application/json', commit);
		},
	},

	{
		method: 'POST',
		pattern: /^\/v1\/vaults\/([^/]+)\/commits$/,
		handler: async (ctx) => {
			const vaultId = ctx.params[0] ?? '';
			if (!(await authorise(ctx, vaultId))) {
				return;
			}

			const raw = await readBody(ctx.req, ctx.config.maxManifestBytes);
			const body = JSON.parse(raw.toString('utf8')) as {
				baseSeq?: unknown;
				manifest?: unknown;
			};

			if (
				typeof body.baseSeq !== 'number' ||
				!Number.isInteger(body.baseSeq) ||
				body.baseSeq < 0
			) {
				fail(ctx.res, 400, 'baseSeq must be a non-negative integer.');
				return;
			}
			// The server cannot read the manifest, but it can insist that what it
			// stores is a well-formed sealed envelope rather than arbitrary bytes.
			if (!isRingEnvelope(body.manifest)) {
				fail(ctx.res, 400, 'manifest must be a sealed envelope.');
				return;
			}

			const result = await ctx.store.appendCommit(
				vaultId,
				body.baseSeq,
				Buffer.from(JSON.stringify(body.manifest))
			);

			if (!result.ok) {
				// 409 tells the client to pull, reconcile and try again. It is an
				// expected outcome of two devices working at once, not a failure.
				send(ctx.res, 409, { error: 'Vault moved on.', head: result.head });
				return;
			}
			send(ctx.res, 201, { seq: result.seq } satisfies PushResponse);
		},
	},

	{
		method: 'GET',
		pattern: /^\/v1\/vaults\/([^/]+)\/blobs\/([^/]+)$/,
		handler: async (ctx) => {
			const vaultId = ctx.params[0] ?? '';
			const blobId = ctx.params[1] ?? '';
			if (!(await authorise(ctx, vaultId))) {
				return;
			}
			if (!isSafeId(blobId)) {
				fail(ctx.res, 400, 'Malformed blob id.');
				return;
			}

			const blob = await ctx.store.readBlob(vaultId, blobId);
			if (!blob) {
				fail(ctx.res, 404, 'No such blob.');
				return;
			}
			sendBytes(ctx.res, 'application/octet-stream', blob);
		},
	},

	{
		method: 'PUT',
		pattern: /^\/v1\/vaults\/([^/]+)\/blobs\/([^/]+)$/,
		handler: async (ctx) => {
			const vaultId = ctx.params[0] ?? '';
			const blobId = ctx.params[1] ?? '';
			if (!(await authorise(ctx, vaultId))) {
				return;
			}
			if (!isSafeId(blobId)) {
				fail(ctx.res, 400, 'Malformed blob id.');
				return;
			}

			await ctx.store.writeBlob(
				vaultId,
				blobId,
				await readBody(ctx.req, ctx.config.maxBlobBytes)
			);
			send(ctx.res, 201, { stored: blobId });
		},
	},
];

async function handle(
	req: IncomingMessage,
	res: ServerResponse,
	config: ServerConfig,
	store: VaultStore
): Promise<void> {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const path = url.pathname;

	// Several routes share a pattern and differ only by method — blobs are both
	// read and written at the same address — so the method has to be part of
	// choosing the route, not a check applied to whichever one matched first.
	const candidates = routes.filter((route) => route.pattern.test(path));
	if (candidates.length === 0) {
		fail(res, 404, 'No such endpoint.');
		return;
	}

	const route = candidates.find((candidate) => candidate.method === req.method);
	if (!route) {
		fail(res, 405, 'Method not allowed.');
		return;
	}

	{
		const match = route.pattern.exec(path);
		if (!match) {
			fail(res, 404, 'No such endpoint.');
			return;
		}

		try {
			await route.handler({ req, res, url, params: match.slice(1), config, store });
		} catch (error) {
			if (error instanceof RequestTooLarge) {
				fail(res, 413, `Body exceeds the ${String(error.limit)} byte limit.`);
				return;
			}
			if (error instanceof SyntaxError) {
				fail(res, 400, 'Body is not valid JSON.');
				return;
			}
			// Logged for the operator; the client learns nothing about internals.
			console.error('Request failed:', path, error);
			if (!res.headersSent) {
				fail(res, 500, 'Internal error.');
			}
		}
	}
}

export function createSyncServer(config: ServerConfig, store: VaultStore): Server {
	return createServer((req, res) => {
		void handle(req, res, config, store);
	});
}
