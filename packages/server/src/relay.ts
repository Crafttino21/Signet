import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { COMPACT_THRESHOLD } from './rooms';
import type { RoomStore } from './rooms';
import { isSafeId, isRoomFrame } from '@signet/protocol';
import type { RoomFrame } from '@signet/protocol';
import { secretsMatch, sha256Hex } from './storage';
import type { VaultStore } from './storage';

/**
 * The collaboration relay.
 *
 * Everyone editing one note holds a socket to the same room. An update arrives
 * sealed, is appended to the room's log, and goes out to everyone else — the
 * server never decrypts it, and could not tell an edit from a cursor move if it
 * tried. What it does know is which connections belong to the same room and how
 * many bytes passed between them.
 *
 * The token travels as a WebSocket subprotocol rather than in the query string,
 * because query strings end up in proxy logs and browser history and a bearer
 * token has no business in either.
 */

const ROOM_PATH = /^\/v1\/vaults\/([0-9a-f]{16,128})\/rooms\/([0-9a-f]{16,128})$/;

interface Member {
	socket: WebSocket;
	vaultId: string;
	roomId: string;
}

export class CollabRelay {
	private readonly wss = new WebSocketServer({ noServer: true });
	/** Sockets by `vaultId/roomId`, so a message reaches exactly one room. */
	private readonly rooms = new Map<string, Set<Member>>();

	constructor(
		private readonly vaults: VaultStore,
		private readonly store: RoomStore
	) {}

	/** Hooks the relay onto an existing HTTP server's upgrade handshake. */
	attach(server: Server): void {
		server.on('upgrade', (request, socket, head) => {
			void this.upgrade(request, socket as never, head);
		});
	}

	private async upgrade(request: IncomingMessage, socket: never, head: Buffer): Promise<void> {
		const url = new URL(request.url ?? '/', 'http://localhost');
		const match = ROOM_PATH.exec(url.pathname);

		const reject = (status: string): void => {
			const raw = socket as unknown as { end: (data: string) => void };
			raw.end(`HTTP/1.1 ${status}\r\n\r\n`);
		};

		if (!match) {
			reject('404 Not Found');
			return;
		}

		const vaultId = match[1] ?? '';
		const roomId = match[2] ?? '';
		if (!isSafeId(vaultId) || !isSafeId(roomId)) {
			reject('400 Bad Request');
			return;
		}

		// The subprotocol carries the token. Same check as every other route: only
		// the hash is ever stored, so the server's disk cannot be used to write.
		const offered = String(request.headers['sec-websocket-protocol'] ?? '')
			.split(',')
			.map((value) => value.trim())
			.filter((value) => value.length > 0);
		const token = offered[0];
		const auth = await this.vaults.readAuth(vaultId);

		if (!token || !auth || !secretsMatch(sha256Hex(token), auth.tokenHash)) {
			reject('401 Unauthorized');
			return;
		}

		this.wss.handleUpgrade(request, socket, head, (ws) => {
			void this.join({ socket: ws, vaultId, roomId }, token);
		});
	}

	private key(member: Member): string {
		return `${member.vaultId}/${member.roomId}`;
	}

	private async join(member: Member, token: string): Promise<void> {
		const key = this.key(member);
		const members = this.rooms.get(key) ?? new Set<Member>();
		this.rooms.set(key, members);
		members.add(member);

		member.socket.on('message', (raw: Buffer) => {
			void this.receive(member, raw);
		});
		member.socket.on('close', () => {
			members.delete(member);
			if (members.size === 0) {
				this.rooms.delete(key);
			}
		});
		// A socket error is not worth a stack trace on the server; the client will
		// reconnect and the close handler tidies up either way.
		member.socket.on('error', () => undefined);

		const log = await this.store.read(member.vaultId, member.roomId);
		this.send(member.socket, {
			type: 'history',
			updates: log.updates,
			generation: log.generation,
		});

		// Silence the unused token now that authentication is done with it.
		void token;
	}

	private async receive(member: Member, raw: Buffer): Promise<void> {
		let frame: unknown;
		try {
			frame = JSON.parse(raw.toString('utf8'));
		} catch {
			this.send(member.socket, { type: 'error', message: 'Not valid JSON.' });
			return;
		}

		if (!isRoomFrame(frame)) {
			this.send(member.socket, { type: 'error', message: 'Unknown frame.' });
			return;
		}

		if (frame.type === 'update') {
			await this.store.append(member.vaultId, member.roomId, frame.payload);
			this.broadcast(member, frame);
			return;
		}

		if (frame.type === 'presence') {
			// Never stored: where someone's cursor was five minutes ago is nobody's
			// business, including this server's.
			this.broadcast(member, frame);
			return;
		}

		if (frame.type === 'compact') {
			const outcome = await this.store.compact(
				member.vaultId,
				member.roomId,
				frame.generation,
				frame.payload
			);
			if (!outcome.ok) {
				// Someone else compacted first. Nothing is lost; this client simply
				// rebuilt from a log that has already been superseded.
				this.send(member.socket, { type: 'error', message: 'Compaction was out of date.' });
			}
		}
	}

	private broadcast(from: Member, frame: RoomFrame): void {
		const members = this.rooms.get(this.key(from));
		if (!members) {
			return;
		}
		for (const member of members) {
			if (member !== from) {
				this.send(member.socket, frame);
			}
		}
	}

	private send(socket: WebSocket, frame: RoomFrame): void {
		if (socket.readyState === socket.OPEN) {
			socket.send(JSON.stringify(frame));
		}
	}

	/** How many updates a room holds before a joining client should compact it. */
	static get compactThreshold(): number {
		return COMPACT_THRESHOLD;
	}

	/** Rooms with someone in them, for the health endpoint. */
	get activeRooms(): number {
		return this.rooms.size;
	}

	close(): void {
		for (const members of this.rooms.values()) {
			for (const member of members) {
				member.socket.close();
			}
		}
		this.rooms.clear();
		this.wss.close();
	}
}
