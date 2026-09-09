import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigError, loadConfig } from './config';
import { createSyncServer } from './http';
import { VaultStore } from './storage';

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

	server.listen(config.port, config.host, () => {
		console.log(`Toolbox sync server listening on ${config.host}:${String(config.port)}`);
		console.log(`Data directory: ${config.dataDir}`);
	});

	const shutdown = (signal: string): void => {
		console.log(`${signal} received, closing.`);
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
