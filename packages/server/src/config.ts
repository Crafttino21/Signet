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
	/** Ceiling on what one vault may occupy. 0 switches the check off. */
	maxVaultBytes: number;
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

function number(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
	/** Whether zero is a meaningful answer, as it is for a limit meaning "none". */
	zeroAllowed = false
): number {
	const raw = setting(env, name);
	if (raw === undefined || raw === '') {
		return fallback;
	}
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0 || (value === 0 && !zeroAllowed)) {
		throw new ConfigError(`${name} must be a positive number, got ${raw}`);
	}
	return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
	const registrationSecret = setting(env, 'REGISTRATION_SECRET') ?? '';
	// Thirty-two, not sixteen. The comparison is constant-time and there is no
	// lockout, so the only thing standing between this port and a new vault is how
	// long the secret is — and sixteen human-chosen characters is a weekend.
	if (registrationSecret.length < 32) {
		throw new ConfigError(
			'SIGNET_REGISTRATION_SECRET must be set to at least 32 characters. Generate one with: openssl rand -hex 32'
		);
	}

	return {
		// Loopback unless somebody says otherwise. This server speaks plain HTTP
		// and its bearer token is not encrypted, so the safe deployment is behind a
		// reverse proxy holding the TLS — which the compose file arranges, and which
		// `node dist/server.js` and a hand-written `docker run` do not. Defaulting
		// to every interface meant the safe case was the composed one and the
		// exposed one was what you got by being in a hurry.
		host: setting(env, 'HOST') ?? '127.0.0.1',
		port: number(env, 'PORT', 8787),
		dataDir: setting(env, 'DATA_DIR') ?? '/data',
		registrationSecret,
		// Obsidian's own mobile API struggles well before this, but a cap keeps a
		// broken client from filling the disk in one request.
		maxBlobBytes: number(env, 'MAX_BLOB_BYTES', 100 * 1024 * 1024),
		maxManifestBytes: number(env, 'MAX_MANIFEST_BYTES', 32 * 1024 * 1024),
		// Nothing here is ever deleted — that is deliberate and it is what makes
		// this store safe — so the only way disk use is bounded is a ceiling. One
		// member looping 100 MB blob uploads has every id be a new one, so the
		// de-duplication never fires and the volume fills. Generous by default,
		// because hitting it stops a sync.
		maxVaultBytes: number(env, 'MAX_VAULT_BYTES', 50 * 1024 * 1024 * 1024, true),
	};
}
