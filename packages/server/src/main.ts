import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { createSyncServer } from './http';
import { CollabRelay } from './relay';
import { RoomStore } from './rooms';
import { VaultStore } from './storage';

/**
 * Whether this looks like it is running inside a container.
 *
 * Only ever used to decide whether to warn. Both signals are heuristics and
 * neither is load-bearing: getting it wrong prints an unnecessary line or omits
 * a helpful one.
 */
async function inContainer(): Promise<boolean> {
	try {
		await stat('/.dockerenv');
		return true;
	} catch {
		return process.env.KUBERNETES_SERVICE_HOST !== undefined;
	}
}

/**
 * Says so when the server is listening somewhere nothing can reach it.
 *
 * Loopback is the right default — this speaks plain HTTP and its bearer token
 * travels in the clear, so the safe deployment is behind a reverse proxy, which
 * the compose file arranges. But inside a container loopback means the container
 * itself and nothing else, and a hand-written `docker run` does not set `HOST`.
 * The result is a server that starts perfectly, logs nothing unusual, and
 * refuses every connection — which reads as "sync is broken" rather than as a
 * setting.
 */
async function warnIfUnreachable(host: string): Promise<void> {
	if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
		return;
	}
	if (!(await inContainer())) {
		return;
	}

	console.warn(
		`Warning: listening on ${host}, which inside a container means nothing outside it can connect.`
	);
	console.warn(
		'Set HOST=0.0.0.0 and keep the container behind a reverse proxy that holds the TLS.'
	);
}

/**
 * Entry point. Starts the server, or explains clearly why it will not.
 */
async function main(): Promise<void> {
	const config = loadConfig();

	// Fail here rather than on the first request, so a wrong volume mount shows up
	// at start instead of halfway through someone's first sync.
	await mkdir(join(config.dataDir, 'vaults'), { recursive: true });

	const store = new VaultStore(config.dataDir);
	const server = createSyncServer(config, store);

	// Collaboration shares the same port and the same credentials; it is another
	// door into the same vault rather than a second service to expose.
	const relay = new CollabRelay(store, new RoomStore(config.dataDir));
	relay.attach(server);

	server.listen(config.port, config.host, () => {
		console.log(`Signet sync server listening on ${config.host}:${String(config.port)}`);
		console.log(`Data directory: ${config.dataDir}`);
		void warnIfUnreachable(config.host);
	});

	const shutdown = (signal: string): void => {
		console.log(`${signal} received, closing.`);
		relay.close();
		server.close(() => process.exit(0));
	};
	process.on('SIGTERM', () => shutdown('SIGTERM'));
	process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
	if (error instanceof ConfigError) {
		console.error(`Configuration problem: ${error.message}`);
		process.exit(2);
	}
	console.error('Failed to start:', error);
	process.exit(1);
});
