import { MarkdownView, setIcon } from 'obsidian';
import type { IconName, Workspace } from 'obsidian';
import { t } from '../../i18n';

/** What the indicator is currently saying. */
export type SyncState = 'off' | 'idle' | 'syncing' | 'live' | 'error';

const STATES: readonly SyncState[] = ['off', 'idle', 'syncing', 'live', 'error'];

const ICONS: Record<SyncState, IconName> = {
	off: 'cloud-off',
	idle: 'cloud',
	syncing: 'refresh-cw',
	live: 'cloud',
	error: 'alert-triangle',
};

/** A note being edited together says so instead, because that is the local news. */
const LIVE_NOTE_ICON: IconName = 'users';

/**
 * The sync state, in the header of every open note.
 *
 * Obsidian has no status bar on mobile — `SignetModule.addStatusBarItem` returns
 * undefined there — so on a phone the sync had no visible state at all short of
 * opening the panel. A view header action is the one surface that exists on both,
 * and it sits where the answer is wanted: next to the note it is about.
 *
 * `addAction` has no counterpart that removes an action, so each element is kept:
 * once per view so that switching notes does not stack up a row of identical
 * icons, and collectively so switching the module off leaves nothing behind.
 */
export class SyncIndicator {
	private readonly perView = new WeakMap<MarkdownView, HTMLElement>();
	private readonly added = new Set<HTMLElement>();
	private state: SyncState = 'off';

	constructor(
		private readonly workspace: Workspace,
		private readonly options: {
			/** Whether this note is currently owned by a live editing session. */
			isLive: (path: string) => boolean;
			onClick: () => void;
		}
	) {}

	setState(state: SyncState): void {
		this.state = state;
		this.refresh();
	}

	/** Draws on every open note. Cheap enough to call on any change worth showing. */
	refresh(): void {
		for (const leaf of this.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				this.paint(view, this.elementFor(view));
			}
		}

		// A view that has been closed takes its header with it. Nothing to remove,
		// only a reference to let go of.
		for (const element of this.added) {
			if (!element.isConnected) {
				this.added.delete(element);
			}
		}
	}

	/** Removes every indicator this ever added. For switching the module off. */
	dispose(): void {
		for (const element of this.added) {
			element.remove();
		}
		this.added.clear();
	}

	private elementFor(view: MarkdownView): HTMLElement {
		const existing = this.perView.get(view);
		if (existing?.isConnected) {
			return existing;
		}

		const element = view.addAction(ICONS[this.state], t('vaultSync.status.tooltip'), () => {
			this.options.onClick();
		});
		element.addClass('signet-sync-indicator');
		this.perView.set(view, element);
		this.added.add(element);
		return element;
	}

	private paint(view: MarkdownView, element: HTMLElement): void {
		const path = view.file?.path;
		const live = path !== undefined && this.options.isLive(path);

		setIcon(element, live ? LIVE_NOTE_ICON : ICONS[this.state]);

		// The label is what a screen reader gets and what the tooltip shows, so it
		// says the state in words rather than leaving it to the colour.
		element.setAttribute(
			'aria-label',
			live ? t('vaultSync.indicator.liveNote') : t(`vaultSync.status.${this.state}`)
		);

		for (const state of STATES) {
			element.toggleClass(`signet-sync-indicator--${state}`, !live && state === this.state);
		}
		element.toggleClass('signet-sync-indicator--live', live || this.state === 'live');
	}
}
