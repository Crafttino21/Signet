import { isRoomFrame, openBlob, routes, sealBlob } from '@signet/protocol';
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
}

/** How long to wait before reconnecting, growing up to a ceiling. */
const RECONNECT_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export class RoomSocket {
	private socket: WebSocket | undefined;
	private closed = false;
	private attempt = 0;
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

	private url(): string {
		// The socket lives on the same origin as everything else, so https becomes
		// wss and http becomes ws without the user configuring a second address.
		const base = this.options.serverUrl.replace(/\/+$/, '').replace(/^http/, 'ws');
		return `${base}${routes.room(this.options.vaultId, this.options.roomId)}`;
	}

	connect(): void {
		if (this.closed || this.socket) {
			return;
		}

		const socket = new WebSocket(this.url(), [this.options.token]);
		this.socket = socket;

		socket.addEventListener('open', () => {
			this.attempt = 0;
			this.handlers.onStatus(true);
		});
		socket.addEventListener('message', (event: MessageEvent<string>) => {
			void this.receive(event.data);
		});
		socket.addEventListener('close', () => {
			this.socket = undefined;
			this.handlers.onStatus(false);
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

	async sendCompacted(merged: Uint8Array, generation: number): Promise<void> {
		await this.send({ type: 'compact', payload: await this.seal(merged), generation });
	}

	private send(frame: RoomFrame): Promise<void> {
		const socket = this.socket;
		if (socket && socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(frame));
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
