import { Notice, Plugin } from 'obsidian';
import { initI18n, t } from './i18n';
import { LiveEditingRegistry } from './core/live-editing';
import { ModuleRegistry } from './core/registry';
import { RingLink } from './core/ring-link';
import {
	LEGACY_PANEL_TYPE,
	PANEL_TYPES,
	SIGNET_PANEL_TYPE,
	SignetPanelView,
} from './core/panel-view';
import { migrateSettings } from './core/settings';
import type { SignetSettings } from './core/settings';
import { SignetSettingTab } from './core/settings-tab';
import { SetupModal } from './core/setup';
import { PluginApi } from './core/obsidian-internals';
import { adoptLegacyFolder } from './core/rename';
import { coreLeftovers, LEGACY_VAULT_FOLDER, legacyPluginFolder } from './core/legacy-leftovers';
import { isEmptyReport, runPort } from './core/legacy-port';
import type { Leftover, PortReport } from './core/legacy-port';
import { pathExists } from './core/vault-fs';
import { registerViewOnce } from './core/view';
import {
	lastSeenVersion,
	lastUpdateCheck,
	rememberUpdateCheck,
	rememberVersion,
} from './core/device-state';
import { fetchLatestVersion, isCheckDue, UpdateWatch } from './core/update-check';
import { WhatsNewModal } from './core/whats-new';
import { SIGNET_MODULES } from './modules';

/**
 * The plugin itself does almost nothing: it loads settings, hands the module list
 * to the registry, adds the settings tab, and owns the side panel every module
 * draws into. Every feature lives in src/modules.
 */
export default class SignetPlugin extends Plugin {
	// Plugin declares `settings?: unknown` and expects subclasses to narrow it.
	override settings!: SignetSettings;
	registry!: ModuleRegistry;
	/**
	 * Notes currently owned by a live editing session.
	 *
	 * Shared rather than messaged between modules because the file sync reads it on
	 * every reconcile and must see the current answer — a stale copy would mean
	 * writing over somebody's typing.
	 */
	readonly liveEditing = new LiveEditingRegistry();
	/**
	 * What the ring says besides which plugins to have — the sync server's address.
	 * Kept here so the two modules can agree without importing each other.
	 */
	readonly ringLink = new RingLink();
	/**
	 * Whether anything has said there is a newer Signet than this one.
	 *
	 * Shared rather than asked for, for the same reason as the two above: the ring
	 * fills it in whenever it reads a roster, the panel and the settings both draw
	 * from it, and none of them should have to know where the answer came from.
	 */
	readonly updates = new UpdateWatch(this.manifest.version);
	/** What the last port found, for the panel. Undefined when it found nothing. */
	portReport: PortReport | undefined;
	private settingTab!: SignetSettingTab;
	/** Guards against a module's own load calling back into reconciliation. */
	private reconciling = false;

	override async onload(): Promise<void> {
		// Before anything renders a label.
		initI18n();

		// Before the settings are read, because this is what there is to read: a
		// device updating from the version called Toolbox has everything in a
		// folder named after the old id, which Obsidian treats as another plugin.
		const plugins = PluginApi.detect(this.app);
		const moved = await adoptLegacyFolder(
			this.app,
			this.folder(),
			plugins && {
				isEnabled: (id) => plugins.isEnabled(id),
				disable: (id) => plugins.disable(id),
			}
		);

		this.settings = migrateSettings(await this.loadData(), SIGNET_MODULES);
		this.registry = new ModuleRegistry(this, SIGNET_MODULES);

		this.settingTab = new SignetSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		registerViewOnce(this, SIGNET_PANEL_TYPE, (leaf) => new SignetPanelView(leaf, this));
		// The name the panel had before the rename. A vault that had it open still
		// has a leaf of that type in its workspace, and nothing registering it is
		// an empty pane where the panel used to be.
		registerViewOnce(
			this,
			LEGACY_PANEL_TYPE,
			(leaf) => new SignetPanelView(leaf, this, LEGACY_PANEL_TYPE)
		);
		this.addRibbonIcon('wrench', t('panel.open'), () => void this.openPanel());
		this.addCommand({
			id: 'open-panel',
			name: t('panel.open'),
			callback: () => void this.openPanel(),
		});
		this.addCommand({
			id: 'setup',
			name: t('setup.command'),
			callback: () => {
				this.openSetup();
			},
		});

		await this.registry.syncWithSettings();

		// Redraw both surfaces when something turns out to be newer than this. The
		// ring finds that out whenever it reads a roster, which is long after this.
		this.register(
			this.updates.onChange(() => {
				this.refreshPanel();
				this.refreshSettings();
			})
		);

		// Said once, after everything is up, because it explains why the plugin
		// looks set up already and where the old folder went.
		if (moved) {
			new Notice(
				t(moved.switchedOff ? 'rename.movedInAndOff' : 'rename.movedIn', {
					from: moved.from,
				})
			);
		}

		this.addCommand({
			id: 'port-legacy',
			name: t('port.command'),
			callback: () => {
				void this.portFromToolbox('always');
			},
		});

		// Everything here waits for the layout and none of it is awaited: the vault
		// index is not there during onload, and a plugin that waits on the network
		// to finish starting is a plugin that does not start on a train.
		this.app.workspace.onLayoutReady(() => {
			this.showWhatIsNew();
			void this.lookForUpdates();
			void this.portFromToolbox('ifAnything').catch((error: unknown) => {
				console.error('Signet: could not finish the move out of the old folder.', error);
			});
		});
	}

	/**
	 * Finishes the move out of the plugin that used to be called Toolbox.
	 *
	 * After the modules are up, because half of what there is to find belongs to
	 * them, and inside `onLayoutReady`, because the rest of it is in the vault and
	 * the vault index is not there during `onload` — the reasoning is written out
	 * in `core/vault-fs.ts`.
	 *
	 * No marker records that this has run. It begins with two existence checks and
	 * stops on the spot when both come back empty, which is what every start after
	 * the first one costs — and it means a leftover that arrives later, dropped in
	 * by whatever else syncs this vault, is still picked up.
	 */
	async portFromToolbox(announce: 'always' | 'ifAnything'): Promise<void> {
		const leftovers = await this.collectLeftovers();
		if (leftovers.length === 0) {
			this.portReport = undefined;
			this.refreshPanel();
			if (announce === 'always') {
				new Notice(t('port.notice.nothing'));
			}
			return;
		}

		const report = await runPort(leftovers);
		this.portReport = isEmptyReport(report) ? undefined : report;
		this.refreshPanel();

		if (report.tidied.length > 0) {
			new Notice(t('port.notice.tidied', { count: report.tidied.length }));
		} else if (announce === 'always') {
			new Notice(t('port.notice.nothing'));
		}
	}

	private async collectLeftovers(): Promise<Leftover[]> {
		const there =
			(await pathExists(this.app, legacyPluginFolder(this.app))) ||
			(await pathExists(this.app, LEGACY_VAULT_FOLDER)) ||
			this.app.workspace.getLeavesOfType(LEGACY_PANEL_TYPE).length > 0;
		if (!there) {
			return [];
		}

		const modules = this.registry
			.visible()
			.map((descriptor) => this.registry.getActive(descriptor.id))
			.filter((module) => module !== undefined);

		const fromModules: Leftover[] = [];
		for (const module of modules) {
			fromModules.push(...(await module.legacyLeftovers()));
		}

		const core = coreLeftovers({
			app: this.app,
			pluginFolder: this.folder(),
			plugins: PluginApi.detect(this.app),
			// Every module that has an opinion has to agree. One of them saying the
			// old folder holds something this one does not is enough to keep it.
			settingsAreHere: (theirs) => modules.every((module) => module.legacyDataIsHere(theirs)),
		});

		// The modules first: what they own lives inside `Toolbox/`, and the folder
		// itself is the last thing core retires — only once it is empty.
		return [...fromModules, ...core];
	}

	/**
	 * The notes for this version, the first time this device runs it.
	 *
	 * The version is recorded whether or not there was anything to show, so that a
	 * first install is silent once rather than on every start, and so that the next
	 * update has somewhere to count from.
	 */
	private showWhatIsNew(): void {
		const installed = this.manifest.version;
		const seen = lastSeenVersion(this.app);
		if (seen === installed) {
			return;
		}

		WhatsNewModal.openIfAnything(this.app, installed, seen);
		rememberVersion(this.app, installed);
	}

	/**
	 * Asks the repository whether there is a newer release, at most once a day.
	 *
	 * What came back last time is offered again even when it is not time to ask,
	 * because the answer outlives the session that fetched it — otherwise the
	 * banner would appear on the day of the check and vanish on the day after.
	 */
	private async lookForUpdates(): Promise<void> {
		if (!this.settings.checkForUpdates) {
			return;
		}

		const previous = lastUpdateCheck(this.app);
		if (previous?.version !== undefined) {
			this.updates.sawRelease(previous.version);
		}
		if (!isCheckDue(previous, Date.now())) {
			return;
		}

		const version = await fetchLatestVersion();
		rememberUpdateCheck(this.app, { at: Date.now(), version });
		if (version !== undefined) {
			this.updates.sawRelease(version);
		}
	}

	override onunload(): void {
		// Deliberately empty. Obsidian unloads child components — and therefore every
		// module — on its own, and leaves are left attached on purpose: detaching them
		// here would break their restoration after a plugin update.
	}

	/**
	 * Where this plugin's files actually are.
	 *
	 * `manifest.dir` rather than a path built from the id: the two are the same
	 * by convention and came apart when the plugin was renamed. An install
	 * updated in place keeps its old folder name while the manifest declares the
	 * new id, and anything written to the guessed path lands in a folder
	 * Obsidian never loads from.
	 */
	folder(): string {
		return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Opens the panel, or reveals it if it is already somewhere. */
	async openPanel(): Promise<void> {
		const { workspace } = this.app;

		const existing = PANEL_TYPES.flatMap((type) => workspace.getLeavesOfType(type))[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({ type: SIGNET_PANEL_TYPE, active: true });
		await workspace.revealLeaf(leaf);
	}

	/** Opens the guided setup. */
	openSetup(): void {
		new SetupModal(this.app, this).open();
	}

	/**
	 * Redraws the panel, if it is open.
	 *
	 * Modules call this after changing something worth showing, rather than the
	 * panel polling them — a panel that rebuilt itself on a timer would take focus
	 * away from whatever the user was in the middle of pressing.
	 */
	refreshPanel(): void {
		for (const leaf of PANEL_TYPES.flatMap((type) =>
			this.app.workspace.getLeavesOfType(type)
		)) {
			const view = leaf.view;
			if (view instanceof SignetPanelView) {
				view.render();
			}
		}
	}

	/**
	 * Redraws the settings tab, if the user is looking at it.
	 *
	 * Separate from {@link refreshPanel} on purpose. The panel shows live status and
	 * is redrawn often; the settings tab holds text fields somebody may be typing
	 * in, and rebuilding it takes their cursor with it. So this belongs to
	 * deliberate changes of state — a ring created, a server registered — not to
	 * progress reports.
	 */
	refreshSettings(): void {
		this.settingTab.refresh();
	}

	/**
	 * After a deliberate change of state: switch on anything that just became
	 * relevant, then redraw both surfaces.
	 *
	 * Joining a ring whose code carries a server is the case this exists for. The
	 * sync module becomes available at that moment, and having asked for it by
	 * pasting that code, the user should not then have to go and find a switch.
	 */
	reconcileModules(): void {
		if (this.reconciling) {
			return;
		}
		this.reconciling = true;
		void this.registry
			.reconcileAvailability()
			.catch((error: unknown) => {
				console.error('Signet: could not switch on a newly available module.', error);
			})
			.finally(() => {
				this.reconciling = false;
				this.refreshPanel();
				this.refreshSettings();
			});
	}

	/** Called when another device changes data.json underneath us (e.g. via sync). */
	override async onExternalSettingsChange(): Promise<void> {
		this.settings = migrateSettings(await this.loadData(), SIGNET_MODULES);
		await this.registry.syncWithSettings();
		this.refreshPanel();
		this.refreshSettings();
	}
}
