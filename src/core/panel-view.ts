import { ItemView } from 'obsidian';
import type { IconName, WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n';
import { RELEASES_URL } from './update-check';
import type SignetPlugin from '../main';

export const SIGNET_PANEL_TYPE = 'signet-panel';

/**
 * What the panel's view type was called before the rename.
 *
 * A workspace remembers the type of every open leaf, so a vault that had the
 * panel open when this plugin was still Toolbox reopens a leaf of a type nobody
 * registers any more — an empty pane with an error in it, in the place the panel
 * used to be. `main.ts:onunload` leaves leaves attached on purpose so they
 * survive an update, which is exactly what makes this worth answering: the type
 * is registered as a second name for the same view, and a leaf that comes back
 * under it draws the panel as it always did.
 */
export const LEGACY_PANEL_TYPE = 'toolbox-panel';

/** Both names the panel answers to. The first is the one new leaves are opened as. */
export const PANEL_TYPES = [SIGNET_PANEL_TYPE, LEGACY_PANEL_TYPE];

/**
 * The one place to manage everything Signet does.
 *
 * The panel does not know what any feature is. It walks the modules that are
 * switched on and asks each to draw itself, which keeps a feature's code in its
 * own folder and means a new module appears here without this file changing.
 *
 * It redraws on demand rather than on a timer: a panel that rebuilt itself every
 * second would steal focus from anything the user was in the middle of pressing.
 */
export class SignetPanelView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SignetPlugin,
		/**
		 * Which of its names this leaf was opened under. A leaf restored from a
		 * workspace written before the rename has to keep answering to the name it
		 * was saved as, or Obsidian will not match the view to the leaf.
		 */
		private readonly type: string = SIGNET_PANEL_TYPE
	) {
		super(leaf);
	}

	getViewType(): string {
		return this.type;
	}

	getDisplayText(): string {
		return t('panel.title');
	}

	override getIcon(): IconName {
		return 'wrench';
	}

	protected override async onOpen(): Promise<void> {
		this.render();
	}

	protected override async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('signet-panel');

		// Above the setup banner, because somebody who has not finished setting up
		// should install the version they are going to keep before they do. It is a
		// state, not an event — there is a newer Signet than this one — so it stays
		// here until that stops being true rather than being said once and lost.
		this.renderUpdate(contentEl);

		// After the update line and before the setup: it is an account of something
		// that already happened, which outranks a suggestion and is outranked by the
		// thing still waiting to be done.
		this.renderPort(contentEl);

		// The shortest path from "installed" to "working" belongs at the top, and
		// disappears once there is nothing left to set up.
		const outstanding = this.plugin.registry
			.visible()
			.flatMap(
				(descriptor) => this.plugin.registry.getActive(descriptor.id)?.setupStep() ?? []
			)
			.filter((step) => !step.satisfied());

		if (outstanding.length > 0) {
			const banner = contentEl.createDiv({ cls: 'signet-panel__setup' });
			banner.createEl('p', {
				text: t('panel.setupNeeded', { count: outstanding.length }),
			});
			banner
				.createEl('button', { text: t('setup.command'), cls: 'mod-cta' })
				.addEventListener('click', () => {
					this.plugin.openSetup();
				});
		}

		let drew = false;
		for (const descriptor of this.plugin.registry.visible()) {
			const module = this.plugin.registry.getActive(descriptor.id);
			if (!module) {
				continue;
			}

			// A module with nothing to show should not leave an empty heading
			// behind, so it is given a scratch element and only kept if it used it.
			const section = createDiv({ cls: 'signet-panel__section' });
			module.displayPanel(section);
			if (section.childElementCount === 0) {
				continue;
			}

			contentEl.appendChild(section);
			drew = true;
		}

		// A module becomes available when its prerequisite appears — the vault sync
		// once there is a ring, live editing once a server answers. It arrives
		// switched off, so without this line the only way to find out it is now on
		// offer would be to go and look.
		const waiting = this.plugin.registry
			.visible()
			.filter((descriptor) => !this.plugin.registry.isEnabled(descriptor.id));

		if (waiting.length > 0) {
			contentEl.createEl('p', {
				cls: 'signet-panel__state',
				text: t('panel.available', {
					names: waiting.map((descriptor) => descriptor.name).join(', '),
				}),
			});
		}

		if (!drew) {
			contentEl.createEl('p', { cls: 'signet-panel__empty', text: t('panel.nothing') });
		}

		// Which build is actually running. Copying files into the plugin folder does
		// not reload anything, so "it still does the old thing" and "it is broken"
		// look identical from here — and only one of them is worth debugging.
		contentEl.createEl('p', {
			cls: 'signet-panel__version',
			text: t('panel.version', { version: this.plugin.manifest.version }),
		});
	}

	/**
	 * What the move out of the old name did, and what it did not.
	 *
	 * It runs on its own and moves things into the trash, so it owes an account of
	 * itself — a notice would be gone before anybody read the list. Dismissed
	 * rather than timed out: whoever wants to check the trash against it should be
	 * able to leave it up while they do.
	 */
	private renderPort(containerEl: HTMLElement): void {
		const report = this.plugin.portReport;
		if (!report) {
			return;
		}

		const section = containerEl.createDiv({ cls: 'signet-panel__port' });
		section.createEl('h3', { text: t('port.panel.title') });

		if (report.tidied.length > 0) {
			section.createEl('p', { cls: 'signet-panel__state', text: t('port.panel.tidied') });
			const list = section.createEl('ul');
			for (const item of report.tidied) {
				list.createEl('li', { text: t(`port.kind.${item.kind}`, { at: item.at }) });
			}
		}

		if (report.leftAlone.length > 0) {
			section.createEl('p', {
				cls: 'signet-panel__state signet-panel__state--warn',
				text: t('port.panel.leftAlone'),
			});
			const list = section.createEl('ul');
			for (const item of report.leftAlone) {
				list.createEl('li', {
					text: `${t(`port.kind.${item.kind}`, { at: item.at })} — ${t(
						`port.reason.${item.reason}`
					)}`,
				});
			}
		}

		section
			.createEl('button', { text: t('port.panel.dismiss') })
			.addEventListener('click', () => {
				this.plugin.portReport = undefined;
				this.render();
			});
	}

	/**
	 * That there is a newer version, and where to get it.
	 *
	 * A link rather than a button that installs it. Updating a plugin is
	 * Obsidian's job and the user's decision, and a plugin that replaces itself
	 * while it is in the middle of syncing somebody's notes is not a feature.
	 */
	private renderUpdate(containerEl: HTMLElement): void {
		const update = this.plugin.updates.latest();
		if (!update) {
			return;
		}

		const banner = containerEl.createDiv({ cls: 'signet-panel__update' });
		banner.createEl('p', {
			text: t('update.panel.available', {
				version: update.version,
				installed: this.plugin.manifest.version,
			}),
		});

		// Worth saying, because it is the difference between "somebody released
		// this" and "you are the odd one out in your own ring".
		if (update.from === 'ring') {
			banner.createEl('p', {
				cls: 'signet-panel__state',
				text: t('update.panel.fromRing'),
			});
		}

		banner
			.createEl('a', {
				cls: 'signet-panel__update-link',
				text: t('update.panel.openReleases'),
				href: RELEASES_URL,
			})
			.setAttribute('rel', 'noopener');
	}
}
