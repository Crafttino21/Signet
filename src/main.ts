import { Plugin } from 'obsidian';
import { initI18n, t } from './i18n';
import { LiveEditingRegistry } from './core/live-editing';
import { ModuleRegistry } from './core/registry';
import { RingLink } from './core/ring-link';
import { TOOLBOX_PANEL_TYPE, ToolboxPanelView } from './core/panel-view';
import { migrateSettings } from './core/settings';
import type { ToolboxSettings } from './core/settings';
import { ToolboxSettingTab } from './core/settings-tab';
import { SetupModal } from './core/setup';
import { registerViewOnce } from './core/view';
import { TOOLBOX_MODULES } from './modules';

/**
 * The plugin itself does almost nothing: it loads settings, hands the module list
 * to the registry, adds the settings tab, and owns the side panel every module
 * draws into. Every feature lives in src/modules.
 */
export default class ToolboxPlugin extends Plugin {
	// Plugin declares `settings?: unknown` and expects subclasses to narrow it.
	override settings!: ToolboxSettings;
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
	private settingTab!: ToolboxSettingTab;

	override async onload(): Promise<void> {
		// Before anything renders a label.
		initI18n();

		this.settings = migrateSettings(await this.loadData(), TOOLBOX_MODULES);
		this.registry = new ModuleRegistry(this, TOOLBOX_MODULES);

		this.settingTab = new ToolboxSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);

		registerViewOnce(this, TOOLBOX_PANEL_TYPE, (leaf) => new ToolboxPanelView(leaf, this));
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
	}

	override onunload(): void {
		// Deliberately empty. Obsidian unloads child components — and therefore every
		// module — on its own, and leaves are left attached on purpose: detaching them
		// here would break their restoration after a plugin update.
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Opens the panel, or reveals it if it is already somewhere. */
	async openPanel(): Promise<void> {
		const { workspace } = this.app;

		const existing = workspace.getLeavesOfType(TOOLBOX_PANEL_TYPE)[0];
		if (existing) {
			await workspace.revealLeaf(existing);
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) {
			return;
		}
		await leaf.setViewState({ type: TOOLBOX_PANEL_TYPE, active: true });
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
		for (const leaf of this.app.workspace.getLeavesOfType(TOOLBOX_PANEL_TYPE)) {
			const view = leaf.view;
			if (view instanceof ToolboxPanelView) {
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

	/** Called when another device changes data.json underneath us (e.g. via sync). */
	override async onExternalSettingsChange(): Promise<void> {
		this.settings = migrateSettings(await this.loadData(), TOOLBOX_MODULES);
		await this.registry.syncWithSettings();
		this.refreshPanel();
		this.refreshSettings();
	}
}
