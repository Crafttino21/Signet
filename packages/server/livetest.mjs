/**
 * Verifies a running server end to end, with real keys and real encryption.
 *
 * Bundle it, drop it on the host, and run it against the deployed container:
 *
 *   node build-livetest.mjs
 *   docker run --rm --network host -v /tmp:/t node:22-alpine node /t/livetest.js http://127.0.0.1:8787
 *
 * It creates a throwaway vault from a random secret, so it never touches real
 * data — but it does leave that vault behind, since the server never deletes.
 */

import * as Y from 'yjs';
import {
	deriveAuthToken,
	deriveBlobId,
	deriveContentKey,
	deriveNameKey,
	deriveRoomId,
	deriveVaultId,
	generateRingSecret,
	hashAuthToken,
	hashContent,
	openBlob,
	openSnapshot,
	sealBlob,
	sealSnapshot,
} from '@signet/protocol';

const base = (process.argv[2] ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const registrationSecret = process.argv[3] ?? '';

let failures = 0;

function check(label, condition, detail = '') {
	const mark = condition ? 'ok  ' : 'FAIL';
	if (!condition) {
		failures += 1;
	}
	console.log(`${mark} ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
	const health = await fetch(`${base}/v1/health`);
	const healthBody = await health.json();
	check('health answers', health.status === 200, JSON.stringify(healthBody));

	if (!registrationSecret) {
		console.log('\nNo registration secret given, so the write path is skipped.');
		return;
	}

	const secret = generateRingSecret();
	const vaultId = await deriveVaultId(secret);
	const token = await deriveAuthToken(secret);
	const authed = { authorization: `Bearer ${token}` };

	const registered = await fetch(`${base}/v1/vaults/${vaultId}/register`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-registration-secret': registrationSecret,
		},
		body: JSON.stringify({ tokenHash: await hashAuthToken(token) }),
	});
	check('vault registers', registered.status === 201, `status ${registered.status}`);

	const stranger = await fetch(`${base}/v1/vaults/${vaultId}/head`);
	check('a caller without a token is refused', stranger.status === 401);

	// A note, sealed exactly as the plugin would seal it.
	const plaintext = new TextEncoder().encode('# Live test\n\nEtwas Vertrauliches.\n');
	const contentKey = await deriveContentKey(secret);
	const nameKey = await deriveNameKey(secret);
	const contentHash = await hashContent(plaintext);
	const blobId = await deriveBlobId(nameKey, contentHash);

	const put = await fetch(`${base}/v1/vaults/${vaultId}/blobs/${blobId}`, {
		method: 'PUT',
		headers: { ...authed, 'content-type': 'application/octet-stream' },
		body: await sealBlob(contentKey, plaintext),
	});
	check('blob uploads', put.status === 201, `status ${put.status}`);

	const manifest = {
		version: 1,
		seq: 1,
		device: { id: 'livetest', name: 'Live test' },
		updatedAt: new Date().toISOString(),
		files: [
			{
				path: 'Arbeit/Geheim.md',
				hash: contentHash,
				blob: blobId,
				size: plaintext.byteLength,
				mtime: Date.now(),
			},
		],
		deleted: [],
	};

	const pushed = await fetch(`${base}/v1/vaults/${vaultId}/commits`, {
		method: 'POST',
		headers: { ...authed, 'content-type': 'application/json' },
		body: JSON.stringify({ baseSeq: 0, manifest: await sealSnapshot(secret, manifest) }),
	});
	check('commit is accepted', pushed.status === 201, `status ${pushed.status}`);

	const stale = await fetch(`${base}/v1/vaults/${vaultId}/commits`, {
		method: 'POST',
		headers: { ...authed, 'content-type': 'application/json' },
		body: JSON.stringify({ baseSeq: 0, manifest: await sealSnapshot(secret, manifest) }),
	});
	check('a push from behind is rejected', stale.status === 409, `status ${stale.status}`);

	// Read it back the way a second device would.
	const commit = await fetch(`${base}/v1/vaults/${vaultId}/commits/1`, { headers: authed });
	const stored = await commit.text();
	check('the stored commit reveals no filename', !stored.includes('Geheim'));
	check('the stored commit reveals no content', !stored.includes('Vertrauliches'));

	const pulled = await openSnapshot(secret, JSON.parse(stored));
	check('the manifest decrypts', pulled.files?.[0]?.path === 'Arbeit/Geheim.md');

	const blob = await fetch(`${base}/v1/vaults/${vaultId}/blobs/${blobId}`, { headers: authed });
	const restored = await openBlob(contentKey, new Uint8Array(await blob.arrayBuffer()));
	check(
		'the note comes back byte for byte',
		new TextDecoder().decode(restored) === new TextDecoder().decode(plaintext)
	);

	// The long poll: park a request, then commit from "another device".
	const parked = fetch(`${base}/v1/vaults/${vaultId}/head?since=1&wait=15`, { headers: authed });
	await new Promise((resolve) => setTimeout(resolve, 300));

	await fetch(`${base}/v1/vaults/${vaultId}/commits`, {
		method: 'POST',
		headers: { ...authed, 'content-type': 'application/json' },
		body: JSON.stringify({
			baseSeq: 1,
			manifest: await sealSnapshot(secret, { ...manifest, seq: 2 }),
		}),
	});

	const started = Date.now();
	const woken = await (await parked).json();
	check(
		'a parked request is woken by another commit',
		woken.seq === 2 && Date.now() - started < 5_000,
		`seq ${woken.seq}`
	);

	await checkRoom({ base, vaultId, token, contentKey, nameKey });

	console.log(`\nThrowaway vault left behind: ${vaultId}`);
}

/**
 * Two devices in one room, against the deployed relay.
 *
 * The merge itself is proved by the test suite; what this establishes is that a
 * real deployment carries it — that the socket upgrade survives whatever proxy
 * sits in front, that the token is accepted as a subprotocol, and that the room
 * outlives the connection that filled it.
 */
async function checkRoom({ base, vaultId, token, contentKey, nameKey }) {
	const roomId = await deriveRoomId(nameKey, 'Arbeit/Gemeinsam.md');
	const url = `${base.replace(/^http/, 'ws')}/v1/vaults/${vaultId}/rooms/${roomId}`;

	const seal = async (bytes) => bytesToBase64(await sealBlob(contentKey, bytes));
	const open = (payload) => openBlob(contentKey, base64ToBytes(payload));

	const one = await room(url, token);
	// Every joiner is greeted with the room's history, this one included. Taking it
	// now means the next frame it sees is genuinely the other device's edit.
	const greeting = await one.next();
	check('the first device is greeted', greeting.type === 'history', `frame ${greeting.type}`);

	const first = new Y.Doc();
	first.getText('content').insert(0, 'Von Gerät eins.\n');
	one.send({ type: 'update', payload: await seal(Y.encodeStateAsUpdate(first)) });

	const two = await room(url, token);
	const history = await two.next();
	check(
		'a joining device is given the room',
		history.type === 'history',
		`frame ${history.type}`
	);

	const second = new Y.Doc();
	for (const update of history.updates ?? []) {
		Y.applyUpdate(second, await open(update));
	}
	check(
		'what it is given decrypts to the text',
		second.getText('content').toJSON() === 'Von Gerät eins.\n',
		JSON.stringify(second.getText('content').toJSON())
	);

	// The other direction, live rather than from storage.
	second.getText('content').insert(0, 'Von Gerät zwei. ');
	two.send({ type: 'update', payload: await seal(Y.encodeStateAsUpdate(second)) });

	const relayed = await one.next();
	check('an edit reaches the other device', relayed.type === 'update', `frame ${relayed.type}`);
	Y.applyUpdate(first, await open(relayed.payload));
	check(
		'both devices end up with the same text',
		first.getText('content').toJSON() === second.getText('content').toJSON(),
		JSON.stringify(first.getText('content').toJSON())
	);

	one.close();
	two.close();

	const refused = await room(url, 'x'.repeat(64)).then(
		() => false,
		() => true
	);
	check('a socket with the wrong token is turned away', refused);
}

/** One socket, queueing frames so nothing that arrives early is missed. */
function room(url, token) {
	const socket = new WebSocket(url, [token]);
	const queued = [];
	let waiting;

	socket.addEventListener('message', (event) => {
		const frame = JSON.parse(event.data);
		if (waiting) {
			const resolve = waiting;
			waiting = undefined;
			resolve(frame);
		} else {
			queued.push(frame);
		}
	});

	return new Promise((resolve, reject) => {
		socket.addEventListener('error', () => reject(new Error('socket refused')));
		socket.addEventListener('open', () =>
			resolve({
				send: (frame) => socket.send(JSON.stringify(frame)),
				next: (timeoutMs = 10_000) =>
					queued.length > 0
						? Promise.resolve(queued.shift())
						: new Promise((got, fail) => {
								const timer = setTimeout(
									() => fail(new Error('no frame arrived')),
									timeoutMs
								);
								waiting = (frame) => {
									clearTimeout(timer);
									got(frame);
								};
							}),
				close: () => socket.close(),
			})
		);
	});
}

function bytesToBase64(bytes) {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value) {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

main().then(
	() => {
		console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
		process.exit(failures === 0 ? 0 : 1);
	},
	(error) => {
		console.error('Live test could not run:', error);
		process.exit(2);
	}
);
