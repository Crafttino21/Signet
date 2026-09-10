import { requestUrl } from 'obsidian';
import { routes } from '@toolbox/protocol';
import type { HeadResponse, RingEnvelope } from '@toolbox/protocol';

/**
 * Talking to the sync server.
 *
 * Uses Obsidian's `requestUrl` rather than `fetch`, because it is not subject to
 * the renderer's CORS rules and works the same on mobile — the two reasons a
 * plain `fetch` tends to work on the desktop and then quietly fail on a phone.
 *
 * Nothing here encrypts or decrypts. By the time bytes reach this class they are
 * already sealed, which keeps the one question that matters — *did this leave the
 * device readable?* — answerable by looking at a single other file.
 */

export class SyncServerError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'SyncServerError';
	}
}

export type PushOutcome =
	| { ok: true; seq: number }
	/** Someone else committed first. Pull, reconcile, try again. */
	| { ok: false; head: number };

function describe(status: number, body: string): string {
	if (status === 401) {
		return 'The server did not accept this ring code.';
	}
	if (status === 403) {
		return 'The registration secret is wrong.';
	}
	if (status === 404) {
		return 'This vault does not exist on the server yet.';
	}
	if (status === 413) {
		return 'The server refused it as too large.';
	}
	return `Server responded ${String(status)}: ${body.slice(0, 200)}`;
}

export class SyncClient {
	private readonly base: string;

	constructor(
		baseUrl: string,
		private readonly vaultId: string,
		private readonly token: string
	) {
		// A trailing slash would turn every path into a double slash.
		this.base = baseUrl.replace(/\/+$/, '');
	}

	private async call(
		path: string,
		init: { method: string; body?: string | ArrayBuffer; headers?: Record<string, string> } = {
			method: 'GET',
		}
	): Promise<{ status: number; text: string; arrayBuffer: ArrayBuffer }> {
		const response = await requestUrl({
			url: `${this.base}${path}`,
			method: init.method,
			body: init.body,
			headers: { authorization: `Bearer ${this.token}`, ...init.headers },
			// We handle 409 and 404 as ordinary outcomes rather than failures.
			throw: false,
		});

		return { status: response.status, text: response.text, arrayBuffer: response.arrayBuffer };
	}

	/** Confirms the address points at a sync server before anything is written. */
	async health(): Promise<{ protocol: number }> {
		const response = await requestUrl({ url: `${this.base}${routes.health()}`, throw: false });
		if (response.status !== 200) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
		return response.json as { protocol: number };
	}

	async register(registrationSecret: string, tokenHash: string): Promise<'created' | 'exists'> {
		const response = await this.call(routes.register(this.vaultId), {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-registration-secret': registrationSecret,
			},
			body: JSON.stringify({ tokenHash }),
		});

		if (response.status !== 200 && response.status !== 201) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
		return response.status === 201 ? 'created' : 'exists';
	}

	/**
	 * Whether the server already knows this vault and accepts this ring code.
	 *
	 * This is what lets a second device set itself up with nothing but the ring
	 * code. Registration creates the vault and fixes which token opens it; every
	 * later device derives that same token from the same code, so it has nothing
	 * to register — it only has to find out whether the host has been here yet.
	 *
	 * The server answers 401 both for "no such vault" and "wrong token", on
	 * purpose, so that a stranger cannot learn which vaults exist. Both mean the
	 * same thing here: not yet usable from this device.
	 */
	async belongs(): Promise<boolean> {
		const response = await this.call(routes.head(this.vaultId));
		if (response.status === 200) {
			return true;
		}
		if (response.status === 401) {
			return false;
		}
		throw new SyncServerError(describe(response.status, response.text), response.status);
	}

	/**
	 * The current commit number.
	 *
	 * With `waitFor`, the request parks on the server until the vault moves past
	 * that commit or the wait runs out. A timeout comes back as the unchanged head,
	 * which is an ordinary answer rather than an error.
	 */
	async head(waitFor?: { since: number; seconds: number }): Promise<HeadResponse> {
		const query = waitFor
			? `?since=${String(waitFor.since)}&wait=${String(waitFor.seconds)}`
			: '';
		const response = await this.call(`${routes.head(this.vaultId)}${query}`);
		if (response.status !== 200) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
		return JSON.parse(response.text) as HeadResponse;
	}

	async commit(seq: number): Promise<RingEnvelope> {
		const response = await this.call(routes.commit(this.vaultId, seq));
		if (response.status !== 200) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
		return JSON.parse(response.text) as RingEnvelope;
	}

	async push(baseSeq: number, manifest: RingEnvelope): Promise<PushOutcome> {
		const response = await this.call(routes.push(this.vaultId), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ baseSeq, manifest }),
		});

		if (response.status === 409) {
			const conflict = JSON.parse(response.text) as { head: number };
			return { ok: false, head: conflict.head };
		}
		if (response.status !== 201) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
		return { ok: true, seq: (JSON.parse(response.text) as { seq: number }).seq };
	}

	/** Undefined when the server does not have it, which the caller must handle. */
	async getBlob(blobId: string): Promise<Uint8Array | undefined> {
		const response = await this.call(routes.blob(this.vaultId, blobId));
		if (response.status === 404) {
			return undefined;
		}
		if (response.status !== 200) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
		return new Uint8Array(response.arrayBuffer);
	}

	async putBlob(blobId: string, sealed: Uint8Array): Promise<void> {
		const response = await this.call(routes.blob(this.vaultId, blobId), {
			method: 'PUT',
			headers: { 'content-type': 'application/octet-stream' },
			body: sealed.buffer.slice(
				sealed.byteOffset,
				sealed.byteOffset + sealed.byteLength
			) as ArrayBuffer,
		});

		if (response.status !== 201) {
			throw new SyncServerError(describe(response.status, response.text), response.status);
		}
	}
}

/**
 * Asks an address whether a sync server is there, without a vault or a token.
 *
 * Used only to work out what went wrong after something already failed, so it
 * answers false rather than throwing: a diagnosis that can itself fail is not a
 * diagnosis. `/v1/health` is the one route that needs no credentials, which is
 * what makes this possible at all.
 */
export async function isSyncServerAt(baseUrl: string): Promise<boolean> {
	try {
		const response = await requestUrl({
			url: `${baseUrl.replace(/\/+$/, '')}${routes.health()}`,
			throw: false,
		});
		return response.status === 200 && (response.json as { ok?: unknown }).ok === true;
	} catch {
		return false;
	}
}
