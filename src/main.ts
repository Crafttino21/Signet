import { Plugin } from 'obsidian';
import { initI18n, t } from './i18n';
import { ModuleRegistry } from './core/registry';
import { TOOLBOX_PANEL_TYPE, ToolboxPanelView } from './core/panel-view';
import { migrateSettings } from './core/settings';
import type { ToolboxSettings } from './core/settings';
import { ToolboxSettingTab } from './core/settings-tab';
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

	override async onload(): Promise<void> {
		// Before anything renders a label.
		initI18n();

		this.settings = migrateSettings(await this.loadData(), TOOLBOX_MODULES);
		this.registry = new ModuleRegistry(this, TOOLBOX_MODULES);

		this.addSettingTab(new ToolboxSettingTab(this.app, this));

		registerViewOnce(this, TOOLBOX_PANEL_TYPE, (leaf) => new ToolboxPanelView(leaf, this));
		this.addRibbonIcon('wrench', t('panel.open'), () => void this.openPanel());
		this.addCommand({
			id: 'open-panel',
			name: t('panel.open'),
			callback: () => void this.openPanel(),
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

	/** Called when another device changes data.json underneath us (e.g. via sync). */
	override async onExternalSettingsChange(): Promise<void> {
		this.settings = migrateSettings(await this.loadData(), TOOLBOX_MODULES);
		await this.registry.syncWithSettings();
		this.refreshPanel();
	}
}
