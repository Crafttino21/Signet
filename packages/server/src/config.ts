/**
 * Configuration comes from the environment, so a container needs no file baked in.
 *
 * The server refuses to start without a registration secret. Without one, anyone
 * who can reach the port could create vaults and fill the disk — and a sync server
 * that silently accepts strangers is worse than one that will not boot.
 */

export interface ServerConfig {
	host: string;
	port: number;
	dataDir: string;
	/** Required to create a new vault. Existing vaults authenticate with their own token. */
	registrationSecret: string;
	maxBlobBytes: number;
	maxManifestBytes: number;
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

function number(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === '') {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new ConfigError(`${name} must be a positive number, got ${raw}`);
	}
	return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const registrationSecret = env.TOOLBOX_REGISTRATION_SECRET ?? '';
	if (registrationSecret.length < 16) {
		throw new ConfigError(
			'TOOLBOX_REGISTRATION_SECRET must be set to at least 16 characters. Generate one with: openssl rand -hex 32'
		);
	}

	return {
		host: env.TOOLBOX_HOST ?? '0.0.0.0',
		port: number(env, 'TOOLBOX_PORT', 8787),
		dataDir: env.TOOLBOX_DATA_DIR ?? '/data',
		registrationSecret,
		// Obsidian's own mobile API struggles well before this, but a cap keeps a
		// broken client from filling the disk in one request.
		maxBlobBytes: number(env, 'TOOLBOX_MAX_BLOB_BYTES', 100 * 1024 * 1024),
		maxManifestBytes: number(env, 'TOOLBOX_MAX_MANIFEST_BYTES', 32 * 1024 * 1024),
	};
}
