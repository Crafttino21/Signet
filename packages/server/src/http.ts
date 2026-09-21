import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { isRingEnvelope, isSafeId, PROTOCOL_VERSION } from '@signet/protocol';
import type { ErrorResponse, HeadResponse, PushResponse, RegisterRequest } from '@signet/protocol';
import type { ServerConfig } from './config';
import { secretsMatch, sha256Hex } from './storage';
import type { VaultStore } from './storage';

/**
 * The HTTP surface. Deliberately tiny: `node:http` plus the filesystem, with no
 * framework to keep patched on a machine that holds someone's notes. The one
 * dependency in the whole server is `ws`, for the collaboration relay — hand
 * rolling WebSocket framing would have been fiddly bit manipulation in exactly
 * the place where a mistake is a security bug.
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

/**
 * Anything from a request header that ends up inside the status page.
 *
 * `Host` is chosen by whoever is calling, which makes it attacker-controlled
 * input being written into a document the browser will parse. It is echoed back
 * because it is the single most useful thing on that page — and that is exactly
 * why it is escaped rather than trusted.
 */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function sendHtml(res: ServerResponse, status: number, body: string): void {
	res.writeHead(status, {
		'content-type': 'text/html; charset=utf-8',
		'content-length': Buffer.byteLength(body),
		'x-content-type-options': 'nosniff',
		// The page loads nothing and runs nothing. Saying so means a bug that got a
		// script in there still could not do anything with it.
		'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
		'referrer-policy': 'no-referrer',
	});
	res.end(body);
}

/** One header value, when a header may legitimately arrive more than once. */
function header(req: IncomingMessage, name: string): string | undefined {
	const value = req.headers[name];
	const first = Array.isArray(value) ? value[0] : value;
	return typeof first === 'string' && first.length > 0 && first.length <= 400
		? first.split(',')[0]?.trim()
		: undefined;
}

/**
 * The address a person should type into Signet, worked out from the request.
 *
 * The server cannot know its own public address — it sits behind a proxy, on a
 * port that is not the one anybody dials, under a name it was never told. What
 * it does know is what the browser asked for, which is the same thing the plugin
 * will have to ask for. So the answer is reconstructed from the request rather
 * than from the configuration, and that is the whole point of the page: seeing
 * it means the name, the TLS and the forwarding to this port all work.
 */
function reachedAt(req: IncomingMessage): { url: string; proxied: boolean } {
	const forwardedProto = header(req, 'x-forwarded-proto');
	const forwardedHost = header(req, 'x-forwarded-host');
	const host = forwardedHost ?? header(req, 'host') ?? 'localhost';
	const scheme = forwardedProto ?? 'http';

	return {
		url: `${scheme}://${host}`,
		proxied: forwardedProto !== undefined || forwardedHost !== undefined,
	};
}

/**
 * A page for a person with a browser, and for nobody else.
 *
 * Signet itself never asks for `/` — the plugin speaks only to `/v1/`, and this
 * route cannot affect it. It exists for the question that is otherwise
 * surprisingly hard to answer: *is the name I just set up actually reaching this
 * server?* Until now the answer at `/` was `{"error":"No such endpoint."}`,
 * which is correct and tells a person nothing.
 *
 * It deliberately holds nothing that needs a credential to see: no vault list,
 * no counts, no configuration. It says the server is here, which protocol it
 * speaks, and what to type into the plugin.
 */
function statusPage(req: IncomingMessage): string {
	const { url, proxied } = reachedAt(req);
	const insecure = url.startsWith('http://');
	const safeUrl = escapeHtml(url);

	const warning = insecure
		? `<p class="warn">This page was reached over plain HTTP. Signet seals your notes before they leave the device, so nobody can read them \u2014 but the access token travels in the clear on this connection. Put a reverse proxy holding TLS in front of this server.</p>`
		: '';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Signet sync server</title>
<style>
:root { color-scheme: light dark; --fg: #1a1a1a; --dim: #5c5c5c; --bg: #fbfbfa; --card: #fff; --line: #e3e3e0; --ok: #1a7f4b; --warnbg: #fdf3e7; --warnfg: #8a5a00; }
@media (prefers-color-scheme: dark) { :root { --fg: #e8e8e6; --dim: #a0a09c; --bg: #191919; --card: #222; --line: #343432; --ok: #4ec27f; --warnbg: #2e2517; --warnfg: #e0b062; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 2.5rem 1.25rem; background: var(--bg); color: var(--fg);
  font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 34rem; margin: 0 auto; }
h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
.sub { color: var(--dim); margin: 0 0 1.75rem; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 1.1rem 1.25rem; margin-bottom: 1rem; }
.ok { color: var(--ok); font-weight: 600; }
.label { color: var(--dim); font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; margin: 0 0 .35rem; }
code { font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: var(--bg); border: 1px solid var(--line); border-radius: 6px;
  padding: .5rem .65rem; display: block; overflow-x: auto; user-select: all; }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: .4rem 1.25rem; }
dt { color: var(--dim); } dd { margin: 0; }
.warn { background: var(--warnbg); color: var(--warnfg); border-radius: 8px; padding: .85rem 1rem; margin: 0 0 1rem; }
.foot { color: var(--dim); font-size: .85rem; margin-top: 1.5rem; }
</style>
</head>
<body>
<main>
<h1>Signet sync server</h1>
<p class="sub"><span class="ok">&#10003; Reachable.</span> The name, the TLS and the forwarding to this server all work.</p>
${warning}
<div class="card">
<p class="label">Address to enter in Signet</p>
<code>${safeUrl}</code>
</div>
<div class="card">
<dl>
<dt>Protocol</dt><dd>${String(PROTOCOL_VERSION)}</dd>
<dt>Reached as</dt><dd>${safeUrl}</dd>
<dt>Behind a proxy</dt><dd>${proxied ? 'yes' : 'no forwarding headers seen'}</dd>
<dt>Health endpoint</dt><dd><code style="display:inline;padding:.1rem .3rem">/v1/health</code></dd>
</dl>
</div>
<p class="foot">This page is for checking an address in a browser. Obsidian never requests it \u2014 the plugin speaks only to <code style="display:inline;padding:.1rem .3rem">/v1/</code>. Nothing here needs a credential to see, and nothing here reveals which vaults this server holds.</p>
</main>
</body>
</html>
`;
}

function sendBytes(res: ServerResponse, contentType: string, body: Buffer): void {
	res.writeHead(200, {
		'content-type': contentType,
		'content-length': body.byteLength,
		// A blob is opaque bytes somebody else chose. Nothing should be guessing at
		// what they are, least of all a browser that has been pointed at the URL.
		'x-content-type-options': 'nosniff',
	});
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

/**
 * How often one caller may try the registration secret.
 *
 * The comparison is constant-time and the secret is now at least thirty-two
 * characters, so this is not what stands between the port and a new vault — it is
 * what stops somebody sitting on it. Ten tries a quarter of an hour is far more
 * than registering a vault ever needs and far less than guessing needs.
 *
 * Counted per remote address, which behind a reverse proxy is one bucket for
 * everybody. That is a real limitation and still the right shape: the bucket is
 * generous enough that sharing it costs a legitimate device nothing, and a proxy
 * is where per-client limits belong anyway.
 */
const REGISTER_TRIES = 10;
const REGISTER_WINDOW_MS = 15 * 60 * 1000;

const registerTries = new Map<string, { count: number; resetAt: number }>();

function tooManyRegisterTries(req: IncomingMessage, now = Date.now()): boolean {
	const who = req.socket.remoteAddress ?? 'unknown';

	// Swept on the way through, so a long-running server does not accumulate an
	// entry per address that ever tried.
	for (const [key, seen] of registerTries) {
		if (seen.resetAt <= now) {
			registerTries.delete(key);
		}
	}

	const seen = registerTries.get(who);
	if (!seen) {
		registerTries.set(who, { count: 1, resetAt: now + REGISTER_WINDOW_MS });
		return false;
	}

	seen.count += 1;
	return seen.count > REGISTER_TRIES;
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
		// For a person who has just pointed a name at this server and wants to know
		// whether it arrived. Not part of the protocol, and never requested by the
		// plugin.
		method: 'GET',
		pattern: /^\/$/,
		handler: async (ctx) => {
			sendHtml(ctx.res, 200, statusPage(ctx.req));
		},
	},

	{
		method: 'GET',
		pattern: /^\/v1\/health$/,
		handler: async (ctx) => {
			// Deliberately without the vault count. This route exists so a device can
			// ask "is a Signet server here and does it speak my protocol" before it
			// has any credentials, and that is all an unauthenticated caller needs.
			// How many vaults a server holds, and watching that number grow, is not
			// part of the question.
			send(ctx.res, 200, { ok: true, protocol: PROTOCOL_VERSION });
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

			// Counted before the secret is compared, so a wrong answer costs a try
			// whether or not it was close.
			if (tooManyRegisterTries(ctx.req)) {
				fail(ctx.res, 429, 'Too many registration attempts. Try again later.');
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

			const outcome = await ctx.store.writeBlob(
				vaultId,
				blobId,
				await readBody(ctx.req, ctx.config.maxBlobBytes),
				ctx.config.maxVaultBytes
			);
			if (outcome === 'full') {
				// 507, not 400: nothing is wrong with the request. The client is told
				// plainly so the sync can report it rather than retrying forever.
				fail(ctx.res, 507, 'This vault has reached its size limit on this server.');
				return;
			}
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
