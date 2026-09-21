import { isRoomFrame, openBlob, ROOM_SUBPROTOCOL, routes, sealBlob } from '@signet/protocol';
import type { Bytes, RoomFrame } from '@signet/protocol';

/**
 * One encrypted socket to one room.
 *
 * Every payload is sealed before it leaves and opened after it arrives, so the
 * server relays bytes it cannot read. A text edit, a cursor position and a whole
 * document history are the same thing to it.
 *
 * The token travels as a WebSocket subprotocol rather than in the URL: query
 * strings end up in proxy logs and browser history, and a bearer token has no
 * business in either.
 */

export interface RoomHandlers {
	/** Everything the room held when this client joined. */
	onHistory: (updates: Uint8Array[], generation: number) => void;
	onUpdate: (update: Uint8Array) => void;
	onPresence: (update: Uint8Array) => void;
	onStatus: (connected: boolean) => void;
	onError: (error: unknown) => void;
	/** The room was compacted; this is the generation to compact against next. */
	onGeneration: (generation: number) => void;
	/**
	 * The server refused this room outright, and retrying will not help.
	 *
	 * Distinct from the socket merely dropping, which is ordinary and is retried.
	 * The one case so far is a history the server could not read: it says so
	 * rather than claiming the room is empty, because a client told a room is
	 * empty seeds it from its own copy of the note.
	 */
	onUnavailable: (reason: string) => void;
}

/** The server's way of saying this room cannot be served. See the relay. */
const ROOM_UNREADABLE = 4001;

/**
 * The largest frame the relay will accept, less a little room for the envelope.
 *
 * Mirrors `MAX_FRAME_BYTES` on the server. Exceeding it is not a rejection with
 * a message — `ws` closes the connection at the protocol level, code 1009, with
 * no frame at all. Since the thing most likely to be too large is the whole
 * document state, and the client offers exactly that on every reconnect, going
 * over turned into a loop: connect, send, be cut off, reconnect, send the same
 * thing again, forever, without a word anywhere.
 */
const MAX_FRAME_CHARS = 11 * 1024 * 1024;

/** Connection attempts before a socket that has never opened says so. */
const QUIET_ATTEMPTS = 3;

/** How long to wait before reconnecting, growing up to a ceiling. */
const RECONNECT_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class RoomSocket {
	private socket: WebSocket | undefined;
	private closed = false;
	private attempt = 0;
	/** Whether a connection has ever succeeded, so a first failure can be named. */
	private everOpened = false;
	/** Said once per run of failures, rather than on every retry. */
	private complained = false;
	private reconnectTimer: number | undefined;

	constructor(
		private readonly options: {
			serverUrl: string;
			vaultId: string;
			roomId: string;
			token: string;
			contentKey: CryptoKey;
			secret: Bytes;
		},
		private readonly handlers: RoomHandlers
	) {}

	/**
	 * Where the room lives.
	 *
	 * Built through `URL` rather than by rewriting the string, because both of the
	 * things that go wrong here are invisible to a substitution. An address with
	 * no scheme passed straight through and made `new WebSocket` throw from inside
	 * `start()`; an address carrying a path — a reverse proxy on a subpath — gave
	 * something the relay's route never matches, which is a 404 on every upgrade
	 * and a reconnect loop that never says why.
	 *
	 * Throws on an address that cannot be used, which is what the caller wants: it
	 * is a configuration error, and this way it names itself.
	 */
	private url(): string {
		const url = new URL(this.options.serverUrl);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			throw new Error(`The sync server address is not an http address: ${url.protocol}`);
		}

		// The socket lives on the same origin as everything else, so https becomes
		// wss and http becomes ws without the user configuring a second address.
		url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
		// A proxy may put the server under a prefix, and the route is relative to
		// wherever that is.
		url.pathname =
			url.pathname.replace(/\/+$/, '') +
			routes.room(this.options.vaultId, this.options.roomId);
		url.search = '';
		url.hash = '';
		return url.toString();
	}

	connect(): void {
		if (this.closed || this.socket) {
			return;
		}

		// The token first, so a server that predates the second name still reads it
		// where it expects to; the second name is what a current server agrees to,
		// so the token is not repeated back in the response.
		const socket = new WebSocket(this.url(), [this.options.token, ROOM_SUBPROTOCOL]);
		this.socket = socket;

		socket.addEventListener('open', () => {
			this.attempt = 0;
			this.everOpened = true;
			this.complained = false;
			this.handlers.onStatus(true);
		});
		socket.addEventListener('message', (event: MessageEvent<string>) => {
			void this.receive(event.data);
		});
		socket.addEventListener('close', (event: CloseEvent) => {
			this.socket = undefined;
			this.handlers.onStatus(false);

			if (!this.everOpened && !this.complained && this.attempt >= QUIET_ATTEMPTS) {
				// A socket that has never once opened is a wrong address, a server that
				// is not running, or a token the server will not take — and a browser
				// cannot tell a failed upgrade's status code apart from any of the
				// others. Retrying forever without a word is what made all three look
				// identical to somebody trying to work out why nothing happens.
				this.complained = true;
				this.handlers.onError(
					new Error(
						'The sync server did not accept the connection for this note. Check the address and that the vault is set up on it.'
					)
				);
			}

			if (event.code === ROOM_UNREADABLE) {
				// A considered no, not a dropped connection. Reconnecting would ask the
				// same question every thirty seconds forever and never say why.
				this.closed = true;
				this.handlers.onUnavailable(event.reason || 'The room is unavailable.');
				return;
			}

			this.scheduleReconnect();
		});
		socket.addEventListener('error', () => {
			// The close handler does the work; an error on its own tells us nothing
			// the browser will not repeat there.
			socket.close();
		});
	}

	private scheduleReconnect(): void {
		if (this.closed) {
			return;
		}
		const delay = RECONNECT_MS[Math.min(this.attempt, RECONNECT_MS.length - 1)] ?? 30_000;
		this.attempt += 1;
		this.reconnectTimer = window.setTimeout(() => {
			this.reconnectTimer = undefined;
			this.connect();
		}, delay);
	}

	private async receive(raw: string): Promise<void> {
		let frame: unknown;
		try {
			frame = JSON.parse(raw);
		} catch {
			return;
		}
		if (!isRoomFrame(frame)) {
			return;
		}

		try {
			if (frame.type === 'history') {
				const updates = await Promise.all(frame.updates.map((update) => this.open(update)));
				this.handlers.onHistory(updates, frame.generation);
			} else if (frame.type === 'update') {
				this.handlers.onUpdate(await this.open(frame.payload));
			} else if (frame.type === 'presence') {
				this.handlers.onPresence(await this.open(frame.payload));
			} else if (frame.type === 'generation') {
				this.handlers.onGeneration(frame.generation);
			} else if (frame.type === 'error') {
				this.handlers.onError(new Error(frame.message));
			}
		} catch (error) {
			// A payload that will not open is either from another ring or corrupt.
			// Neither is worth tearing the session down for.
			this.handlers.onError(error);
		}
	}

	private open(payload: string): Promise<Uint8Array> {
		return openBlob(this.options.contentKey, base64ToBytes(payload));
	}

	private async seal(bytes: Uint8Array): Promise<string> {
		return bytesToBase64(await sealBlob(this.options.contentKey, bytes));
	}

	async sendUpdate(update: Uint8Array): Promise<void> {
		await this.send({ type: 'update', payload: await this.seal(update) });
	}

	async sendPresence(update: Uint8Array): Promise<void> {
		await this.send({ type: 'presence', payload: await this.seal(update) });
	}

	async sendCompacted(merged: Uint8Array, generation: number, basedOn: number): Promise<void> {
		await this.send({
			type: 'compact',
			payload: await this.seal(merged),
			generation,
			basedOn,
		});
	}

	private send(frame: RoomFrame): Promise<void> {
		const socket = this.socket;
		if (socket && socket.readyState === WebSocket.OPEN) {
			const text = JSON.stringify(frame);

			if (text.length > MAX_FRAME_CHARS) {
				// Sending it would take the connection down without explanation, and
				// the reconnect would send it again. Saying so and keeping the socket
				// is the difference between a note that is too big to share and a
				// plugin that appears to have hung.
				this.handlers.onError(
					new Error(
						`This note's history is too large to send (${String(text.length)} characters). Close and reopen it to compact it.`
					)
				);
				return Promise.resolve();
			}

			socket.send(text);
		}
		// Dropped while disconnected. Nothing is lost by it: the session offers its
		// whole state again once the room answers, which covers everything that was
		// typed in the meantime.
		return Promise.resolve();
	}

	get connected(): boolean {
		return this.socket?.readyState === WebSocket.OPEN;
	}

	close(): void {
		this.closed = true;
		if (this.reconnectTimer !== undefined) {
			window.clearTimeout(this.reconnectTimer);
		}
		this.socket?.close();
		this.socket = undefined;
	}
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
