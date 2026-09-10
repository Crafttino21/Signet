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

/**
 * Reads a setting, accepting the name this server used to go by.
 *
 * The project was called Toolbox until it grew a sync service and stopped
 * being one. A rename must not stop somebody's server booting after a `git
 * pull`, so both spellings are read and the old one is simply the older name
 * for the same thing.
 */
function setting(env: NodeJS.ProcessEnv, name: string): string | undefined {
	return env[`SIGNET_${name}`] ?? env[`TOOLBOX_${name}`];
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

function number(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
	const raw = setting(env, name);
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
	const registrationSecret = setting(env, 'REGISTRATION_SECRET') ?? '';
	if (registrationSecret.length < 16) {
		throw new ConfigError(
			'SIGNET_REGISTRATION_SECRET must be set to at least 16 characters. Generate one with: openssl rand -hex 32'
		);
	}

	return {
		host: setting(env, 'HOST') ?? '0.0.0.0',
		port: number(env, 'PORT', 8787),
		dataDir: setting(env, 'DATA_DIR') ?? '/data',
		registrationSecret,
		// Obsidian's own mobile API struggles well before this, but a cap keeps a
		// broken client from filling the disk in one request.
		maxBlobBytes: number(env, 'MAX_BLOB_BYTES', 100 * 1024 * 1024),
		maxManifestBytes: number(env, 'MAX_MANIFEST_BYTES', 32 * 1024 * 1024),
	};
}
