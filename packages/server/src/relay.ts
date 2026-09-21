import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import { COMPACT_THRESHOLD } from './rooms';
import type { RoomStore } from './rooms';
import { isSafeId, isRoomFrame, ROOM_SUBPROTOCOL } from '@signet/protocol';
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
 *
 * That was only half the job. `ws` picks the first subprotocol a client offers
 * and writes it back in the 101 response unless told otherwise — so the token was
 * in a *response* header too, which the other half of a proxy's log configuration
 * captures. A client cannot simply stop offering it, and a server cannot simply
 * agree to nothing: a client whose offer is declined closes the connection.
 *
 * So there is a second name with nothing secret in it, `ROOM_SUBPROTOCOL`. The
 * client offers the token first and that after it, and this agrees to that one
 * whenever it is there. A client from before it existed offers only the token and
 * still gets the old answer, which is why the order is what it is.
 */

/**
 * The largest frame a room will carry.
 *
 * Generous for what it holds — a sealed Yjs update, or a whole compacted document
 * — and nothing like the 100 MiB `ws` allows by default. One socket sending one
 * default-sized frame is 100 MiB parsed into memory and appended to a log that
 * has no cap of its own.
 */
const MAX_FRAME_BYTES = 12 * 1024 * 1024;

const ROOM_PATH = /^\/v1\/vaults\/([0-9a-f]{16,128})\/rooms\/([0-9a-f]{16,128})$/;

interface Member {
	socket: WebSocket;
	vaultId: string;
	roomId: string;
	/** Answered the last ping. A socket that misses one is not there any more. */
	alive: boolean;
}

/**
 * How often to check that a socket is still attached to something.
 *
 * Under the sixty seconds an idle nginx waits before cutting a proxied
 * connection, so an idle collaboration survives instead of being dropped and
 * reconnected all day — and each of those reconnects re-offers the whole
 * document.
 *
 * It is also the only way a half-open socket is ever noticed. A closed laptop, a
 * NAT rebind or a killed network never delivers `close`, so without this the
 * member stays in its room for the life of the process: broadcasts are written
 * into it, and everyone else keeps seeing it in the room.
 */
const HEARTBEAT_MS = 30_000;

/**
 * Close code for a room whose history could not be read.
 *
 * In the 4000-4999 range, which is the one a library leaves to the application.
 * It exists so the client can tell "the server said no about this room" from the
 * far more ordinary "the connection dropped" — the first is worth stopping and
 * reporting, the second is worth retrying quietly.
 */
export const ROOM_UNREADABLE = 4001;

export class CollabRelay {
	private readonly wss = new WebSocketServer({
		noServer: true,
		// Agree to the name that is not a secret, so the 101 response does not
		// repeat the token back. A client that offers only the token is from before
		// that name existed; it still gets the old answer rather than a broken
		// handshake, because a client whose offered subprotocol is declined closes
		// the connection.
		handleProtocols: (protocols) =>
			protocols.has(ROOM_SUBPROTOCOL)
				? ROOM_SUBPROTOCOL
				: (protocols.values().next().value ?? false),
		maxPayload: MAX_FRAME_BYTES,
	});
	/** Sockets by `vaultId/roomId`, so a message reaches exactly one room. */
	private readonly rooms = new Map<string, Set<Member>>();

	/** Drives the liveness check. Unref'd, so it never holds the process open. */
	private readonly heartbeat: NodeJS.Timeout;

	constructor(
		private readonly vaults: VaultStore,
		private readonly store: RoomStore
	) {
		this.heartbeat = setInterval(() => {
			this.sweep();
		}, HEARTBEAT_MS);
		this.heartbeat.unref();
	}

	/**
	 * Pings everyone, and drops whoever did not answer the last one.
	 *
	 * `terminate` rather than `close`: a socket that failed to answer a ping is
	 * not going to complete a closing handshake either, and `close` on one of
	 * those waits for a reply that never comes.
	 */
	private sweep(): void {
		for (const members of this.rooms.values()) {
			for (const member of [...members]) {
				if (!member.alive) {
					member.socket.terminate();
					continue;
				}
				member.alive = false;
				try {
					member.socket.ping();
				} catch {
					member.socket.terminate();
				}
			}
		}
	}

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
			// Ended and then destroyed: a client that ignores the response would
			// otherwise leave the connection half-open for as long as TCP allows,
			// and an upgrade nobody authenticated is the cheapest thing to send.
			const raw = socket as unknown as {
				end: (data: string) => void;
				destroy: () => void;
			};
			raw.end(`HTTP/1.1 ${status}\r\n\r\n`);
			raw.destroy();
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
		// The token is whichever offer is not the protocol name. Reading offer zero
		// worked only because the token happens to come first.
		const token = offered.find((value) => value !== ROOM_SUBPROTOCOL);
		const auth = await this.vaults.readAuth(vaultId);

		if (!token || !auth || !secretsMatch(sha256Hex(token), auth.tokenHash)) {
			reject('401 Unauthorized');
			return;
		}

		this.wss.handleUpgrade(request, socket, head, (ws) => {
			void this.join({ socket: ws, vaultId, roomId, alive: true }, token);
		});
	}

	private key(member: Member): string {
		return `${member.vaultId}/${member.roomId}`;
	}

	private async join(member: Member, token: string): Promise<void> {
		const key = this.key(member);

		// A socket error is not worth a stack trace on the server; the client will
		// reconnect and the close handler tidies up either way.
		member.socket.on('error', () => undefined);

		// Read the history *before* joining the room.
		//
		// Joining first put this socket in the broadcast set while the read was
		// still in flight, so another peer's update could arrive ahead of the
		// `history` frame. On the client that lands on a document which has not been
		// seeded yet — and `seed` then sees an empty history and puts the local file
		// on top of it, which is how a note comes back with its content twice.
		let log;
		try {
			log = await this.store.read(member.vaultId, member.roomId);
		} catch (error) {
			// Never as an empty room. A client told a room is empty seeds it from its
			// own copy of the note, and that copy becomes the room for everybody.
			console.error(`Signet: could not read room ${member.roomId}.`, error);
			this.send(member.socket, {
				type: 'error',
				message: 'This note\u2019s history could not be read. Nothing was changed.',
			});
			member.socket.close(ROOM_UNREADABLE, 'history unavailable');
			return;
		}

		if (member.socket.readyState !== member.socket.OPEN) {
			// Gone while we were reading. Adding it now would leave a member nothing
			// ever removes, because its `close` has already been and gone.
			return;
		}

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
		member.socket.on('pong', () => {
			member.alive = true;
		});

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
			const stored = await this.store.append(member.vaultId, member.roomId, frame.payload);
			if (stored === 'full') {
				// Not relayed either. Letting it through would put the edit on every
				// other device while this room's history no longer records it, and a
				// history that disagrees with the devices is worse than a refusal.
				this.send(member.socket, {
					type: 'error',
					message: 'This note has too much history. Close and reopen it to compact.',
				});
				return;
			}
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
				frame.payload,
				frame.basedOn
			);
			if (!outcome.ok) {
				// Someone else compacted first. Nothing is lost; this client simply
				// rebuilt from a log that has already been superseded.
				this.send(member.socket, { type: 'error', message: 'Compaction was out of date.' });
				return;
			}

			// Everybody is told, the compacting client included.
			const members = this.rooms.get(this.key(member));
			for (const other of members ?? []) {
				this.send(other.socket, { type: 'generation', generation: outcome.generation });
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
			return;
		}

		// Nothing can be done about it here — the frame has nowhere to go, and a
		// `RoomFrame` carries no sequence number, so the receiving end cannot see
		// the hole either. Saying so at least makes it findable, which "silently,
		// and neither end knows" was not.
		console.warn(`Signet: dropped a ${frame.type} frame for a socket that is not open.`);
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
		clearInterval(this.heartbeat);
		for (const members of this.rooms.values()) {
			for (const member of members) {
				member.socket.close();
			}
		}
		this.rooms.clear();
		this.wss.close();
	}
}
