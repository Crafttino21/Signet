import { Component, Platform } from 'obsidian';
import type { App, Command, IconName } from 'obsidian';
import type { SetupStep } from './setup';
import type SignetPlugin from '../main';

/**
 * The static half of a module: everything the settings tab needs in order to list
 * a module that is switched off, without having to construct it.
 */
export interface ModuleDescriptor<S = unknown> {
	/**
	 * Stable identifier, also used as the key under which this module's settings
	 * are stored. Never change it after a release — doing so silently orphans
	 * every user's configuration for this module.
	 */
	readonly id: string;
	/** Shown as the section heading in settings. Sentence case. */
	readonly name: string;
	/** One line explaining what switching this on does. */
	readonly description: string;
	readonly defaultSettings: S;
	/**
	 * Defaults to false. On only for the ring, which is where everything starts;
	 * everything else is switched on once it has something to do.
	 */
	readonly enabledByDefault?: boolean;
	/**
	 * Whether this module has any business being on screen yet. Defaults to true.
	 *
	 * A module whose prerequisite is missing is not shown at all — not as a switch,
	 * not in the panel, not in the setup. Offering the vault sync before there is a
	 * ring means offering a screen of settings that cannot do anything and cannot
	 * say why, and the same goes for live editing before a server answers.
	 *
	 * This governs display only. Whether a module runs is the user's switch, and a
	 * module that is on but not yet relevant sits idle rather than being torn down
	 * and rebuilt as its prerequisite comes and goes.
	 */
	available?(plugin: SignetPlugin): boolean;
	/**
	 * Switch this on by itself the first time it becomes available. Defaults to
	 * false.
	 *
	 * For a module whose whole purpose is the thing that just appeared: joining a
	 * ring whose code carries a server is asking for the sync, and making someone
	 * find a switch afterwards is asking them to confirm what they already said.
	 *
	 * It happens once per module, ever, recorded in `autoEnabled`. Switching it
	 * off afterwards is a decision, and decisions are not undone by a prerequisite
	 * coming back.
	 */
	readonly enableWhenAvailable?: boolean;
	create(plugin: SignetPlugin): SignetModule<S>;
}

/**
 * Base class for a feature.
 *
 * A module is an Obsidian `Component`, which is what makes runtime toggling work:
 * `registerEvent()`, `registerDomEvent()`, `registerInterval()` and `register()`
 * clean up when *the component they were called on* unloads — not when the plugin
 * unloads. So a module that registers everything through `this.*` is fully torn
 * down by `plugin.removeChild(module)`, while the rest of the plugin keeps running.
 *
 * Put setup in `onload()` and use the `this.register*` helpers for anything that
 * needs undoing. Anything registered directly on the plugin instead leaks until
 * the whole plugin unloads.
 */
export abstract class SignetModule<S = unknown> extends Component {
	constructor(
		protected readonly plugin: SignetPlugin,
		readonly descriptor: ModuleDescriptor<S>
	) {
		super();
	}

	protected get app(): App {
		return this.plugin.app;
	}

	protected get settings(): S {
		return this.plugin.settings.moduleSettings[this.descriptor.id] as S;
	}

	/**
	 * Adds a command that disappears again when this module is switched off.
	 *
	 * `Plugin.addCommand()` binds the command to the plugin's lifetime, so a module
	 * must undo it explicitly. Use this instead of `this.plugin.addCommand()`.
	 */
	protected addCommand(command: Command): Command {
		const registered = this.plugin.addCommand(command);
		// Obsidian prefixes the id with the plugin id, so remove by the returned one.
		this.register(() => this.plugin.removeCommand(registered.id));
		return registered;
	}

	/**
	 * Adds a ribbon icon that is removed again when this module is switched off.
	 * Same reasoning as {@link addCommand}.
	 */
	protected addRibbonIcon(
		icon: IconName,
		title: string,
		callback: (evt: MouseEvent) => void
	): HTMLElement {
		const element = this.plugin.addRibbonIcon(icon, title, callback);
		this.register(() => element.remove());
		return element;
	}

	/**
	 * Adds a status bar item that disappears again when this module is switched
	 * off. Returns undefined on mobile, where Obsidian has no status bar at all —
	 * callers must cope rather than assume one exists.
	 */
	protected addStatusBarItem(): HTMLElement | undefined {
		if (!Platform.isDesktopApp) {
			return undefined;
		}

		const element = this.plugin.addStatusBarItem();
		this.register(() => {
			element.remove();
		});
		return element;
	}

	/** Merges a partial update into this module's settings and persists them. */
	protected async patchSettings(patch: Partial<S>): Promise<void> {
		const current = this.settings;
		const base = typeof current === 'object' && current !== null ? current : {};
		this.plugin.settings.moduleSettings[this.descriptor.id] = { ...base, ...patch };
		await this.plugin.saveSettings();
	}

	/**
	 * Called only when the user switches this module off — not when the plugin
	 * unloads because Obsidian is closing or updating.
	 *
	 * That distinction matters: `onunload()` runs in both cases, so cleanup that
	 * should not happen on shutdown belongs here. Detaching leaves is the usual
	 * example — doing it on plugin unload breaks their restoration after an update.
	 */
	onDisable(): void {
		// Nothing by default.
	}

	/**
	 * Optional: render this module's own controls into its settings section.
	 * Only called while the module is enabled.
	 */
	displaySettings(_containerEl: HTMLElement): void {
		// Nothing by default.
	}

	/**
	 * Optional: render this module's live state into the shared side panel.
	 *
	 * The panel is one surface for the user but stays assembled from the modules
	 * themselves, so a feature keeps everything it owns in one folder rather than
	 * a panel growing a branch per module.
	 *
	 * Called whenever the panel redraws, which can be often — keep it cheap and
	 * read state rather than fetching it.
	 */
	displayPanel(_containerEl: HTMLElement): void {
		// Nothing by default.
	}

	/**
	 * Optional: the step this module contributes to the guided setup.
	 *
	 * Return undefined when there is nothing to set up. The wizard shows steps in
	 * module order, so a module that others depend on should come first in the
	 * module list.
	 */
	setupStep(): SetupStep | undefined {
		return undefined;
	}

	/**
	 * Asks the panel to redraw, after this module changed something worth showing.
	 *
	 * Cheap and safe to call often — the panel holds no input the user could be in
	 * the middle of. For a change the settings tab also shows, use {@link refreshUi}.
	 */
	protected refreshPanel(): void {
		this.plugin.refreshPanel();
	}

	/**
	 * Redraws both surfaces after a deliberate change of state.
	 *
	 * Creating a ring, joining one, registering with a server: the settings tab
	 * describes all of these, and without this it would go on describing how things
	 * were before the button was pressed until the user leaves the tab and comes
	 * back. Not for progress updates — rebuilding the settings tab takes the cursor
	 * out of any text field being typed into.
	 */
	protected refreshUi(): void {
		this.plugin.reconcileModules();
	}
}
