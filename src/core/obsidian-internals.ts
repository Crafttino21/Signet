import type { App, PluginManifest } from 'obsidian';

/**
 * Access to Obsidian's community plugin manager (`app.plugins`).
 *
 * This API is **not** part of `obsidian.d.ts` — it is internal and undocumented,
 * and Obsidian is free to change it in any release. Two plugins in the community
 * store (BRAT and Community Install Manager) rely on it, so it is stable enough
 * in practice, but it is still a bet.
 *
 * The whole bet lives in this one file. Nothing else in the codebase touches
 * `app.plugins`, every method is checked at runtime before it is called, and
 * `PluginApi.detect()` returns undefined when the shape is not what we expect —
 * so a broken Obsidian release disables the feature instead of crashing it.
 *
 * The cast is deliberately local rather than a `declare module 'obsidian'`
 * augmentation: a global augmentation would make `app.plugins` look official
 * everywhere and defeat the isolation this file exists for.
 */
interface CommunityPluginManager {
	manifests?: Record<string, PluginManifest>;
	enabledPlugins?: Set<string> | string[];
	enablePlugin?: (id: string) => Promise<void>;
	enablePluginAndSave?: (id: string) => Promise<void>;
	disablePlugin?: (id: string) => Promise<void>;
	loadManifests?: () => Promise<void>;
	saveConfig?: () => Promise<void>;
	installPlugin?: (repo: string, version: string, manifest: PluginManifest) => Promise<void>;
}

export interface InstalledPlugin {
	id: string;
	name: string;
	version: string;
	isDesktopOnly: boolean;
	enabled: boolean;
}

/** Methods without which the ring cannot do anything useful. */
const REQUIRED = ['enablePlugin', 'disablePlugin'] as const;

function readManager(app: App): CommunityPluginManager | undefined {
	const manager = (app as App & { plugins?: unknown }).plugins;
	if (typeof manager !== 'object' || manager === null) {
		return undefined;
	}
	return manager;
}

export class PluginApi {
	private constructor(private readonly manager: CommunityPluginManager) {}

	/** Returns undefined when the internal API is missing or has changed shape. */
	static detect(app: App): PluginApi | undefined {
		const manager = readManager(app);
		if (!manager) {
			return undefined;
		}

		for (const method of REQUIRED) {
			if (typeof manager[method] !== 'function') {
				return undefined;
			}
		}
		if (typeof manager.manifests !== 'object' || manager.manifests === null) {
			return undefined;
		}

		return new PluginApi(manager);
	}

	/** Names of expected methods that are missing — for a useful error message. */
	static missing(app: App): string[] {
		const manager = readManager(app);
		if (!manager) {
			return ['app.plugins'];
		}

		const gaps = REQUIRED.filter((method) => typeof manager[method] !== 'function');
		if (typeof manager.manifests !== 'object' || manager.manifests === null) {
			gaps.push('manifests' as (typeof REQUIRED)[number]);
		}
		return gaps;
	}

	listInstalled(): InstalledPlugin[] {
		const manifests = this.manager.manifests ?? {};
		return Object.values(manifests).map((manifest) => ({
			id: manifest.id,
			name: manifest.name,
			version: manifest.version,
			isDesktopOnly: manifest.isDesktopOnly === true,
			enabled: this.isEnabled(manifest.id),
		}));
	}

	isEnabled(id: string): boolean {
		const enabled = this.manager.enabledPlugins;
		if (enabled instanceof Set) {
			return enabled.has(id);
		}
		if (Array.isArray(enabled)) {
			return enabled.includes(id);
		}
		return false;
	}

	async enable(id: string): Promise<void> {
		// enablePluginAndSave also persists the enabled list; fall back to the
		// plain version plus an explicit saveConfig when it is not there.
		if (this.manager.enablePluginAndSave) {
			await this.manager.enablePluginAndSave(id);
			return;
		}
		await this.manager.enablePlugin?.(id);
		await this.manager.saveConfig?.();
	}

	async disable(id: string): Promise<void> {
		await this.manager.disablePlugin?.(id);
		await this.manager.saveConfig?.();
	}

	/**
	 * Whether this Obsidian exposes the installer at all.
	 *
	 * Separate from {@link detect} on purpose: the ring is useful without it — it
	 * can still switch plugins on and off and carry settings — so a missing
	 * installer disables one feature rather than the module.
	 */
	canInstall(): boolean {
		return typeof this.manager.installPlugin === 'function';
	}

	/**
	 * Installs a community plugin through Obsidian's own installer.
	 *
	 * This is the same code path the "Browse community plugins" screen uses, so
	 * Obsidian does the downloading and the writing rather than us reaching into
	 * the plugins folder ourselves.
	 */
	async install(repo: string, version: string, manifest: PluginManifest): Promise<void> {
		if (!this.manager.installPlugin) {
			throw new Error('This Obsidian version does not expose the plugin installer.');
		}
		await this.manager.installPlugin(repo, version, manifest);
	}

	/** Rereads the plugin folder, so a freshly installed plugin becomes known. */
	async reloadManifests(): Promise<void> {
		await this.manager.loadManifests?.();
	}

	/** True once the plugin folder actually contains it. */
	isInstalled(id: string): boolean {
		return this.manager.manifests?.[id] !== undefined;
	}

	/** Reloads a plugin so it picks up a data.json we just wrote from outside. */
	async reload(id: string): Promise<void> {
		await this.manager.disablePlugin?.(id);
		await this.manager.enablePlugin?.(id);
	}
}
