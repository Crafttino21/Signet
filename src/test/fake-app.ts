/**
 * A fake Obsidian `App` for tests: an in-memory file system plus the parts of the
 * internal `app.plugins` manager that `PluginApi` talks to.
 *
 * This is the counterpart to `obsidian.stub.ts` — the stub replaces the module,
 * this replaces the running app. Both grow as the code under test needs more.
 */

export interface FakePluginManifest {
	id: string;
	name: string;
	version: string;
	isDesktopOnly?: boolean;
}

export interface FakeAppOptions {
	manifests?: FakePluginManifest[];
	enabled?: string[];
	files?: Record<string, string>;
	configDir?: string;
	/** Plugin ids whose enable/disable calls should blow up, to test failure paths. */
	failOn?: string[];
}

export class FakeApp {
	readonly vault: {
		configDir: string;
		adapter: {
			exists: (path: string) => Promise<boolean>;
			read: (path: string) => Promise<string>;
			write: (path: string, data: string) => Promise<void>;
			mkdir: (path: string) => Promise<void>;
		};
	};

	readonly plugins: {
		manifests: Record<string, FakePluginManifest>;
		enabledPlugins: Set<string>;
		enablePlugin: (id: string) => Promise<void>;
		disablePlugin: (id: string) => Promise<void>;
		saveConfig: () => Promise<void>;
	};

	readonly files: Map<string, string>;
	/** Every enable/disable in order, so tests can assert the sequence. */
	readonly calls: string[] = [];

	constructor(options: FakeAppOptions = {}) {
		const failOn = new Set(options.failOn ?? []);
		this.files = new Map(Object.entries(options.files ?? {}));

		this.vault = {
			configDir: options.configDir ?? '.obsidian',
			adapter: {
				exists: (path) => Promise.resolve(this.files.has(path)),
				read: (path) => {
					const content = this.files.get(path);
					if (content === undefined) {
						return Promise.reject(new Error(`No such file: ${path}`));
					}
					return Promise.resolve(content);
				},
				write: (path, data) => {
					this.files.set(path, data);
					return Promise.resolve();
				},
				mkdir: () => Promise.resolve(),
			},
		};

		this.plugins = {
			manifests: Object.fromEntries((options.manifests ?? []).map((m) => [m.id, m])),
			enabledPlugins: new Set(options.enabled ?? []),
			enablePlugin: (id) => {
				this.calls.push(`enable:${id}`);
				if (failOn.has(id)) {
					return Promise.reject(new Error(`Cannot enable ${id}`));
				}
				this.plugins.enabledPlugins.add(id);
				return Promise.resolve();
			},
			disablePlugin: (id) => {
				this.calls.push(`disable:${id}`);
				if (failOn.has(id)) {
					return Promise.reject(new Error(`Cannot disable ${id}`));
				}
				this.plugins.enabledPlugins.delete(id);
				return Promise.resolve();
			},
			saveConfig: () => Promise.resolve(),
		};
	}

	dataPath(pluginId: string): string {
		return `${this.vault.configDir}/plugins/${pluginId}/data.json`;
	}

	readData(pluginId: string): unknown {
		const raw = this.files.get(this.dataPath(pluginId));
		return raw === undefined ? undefined : JSON.parse(raw);
	}
}
