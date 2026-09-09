import { Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * Shared building blocks for settings screens.
 *
 * Most settings a module offers exist so that an unusual setup is possible, not
 * because anyone is expected to change them. Leaving them all on one flat page
 * makes the two or three that matter hard to find, so the rarely-touched ones go
 * behind a fold that starts closed.
 */

/**
 * A collapsed section for settings that normally stay untouched.
 *
 * Returns the element to put them in. Built from `<details>` so the browser owns
 * the open and closed state — no click handler, and it keeps working with a
 * keyboard and a screen reader.
 */
export function advancedSection(containerEl: HTMLElement, label?: string): HTMLElement {
	const details = containerEl.createEl('details', { cls: 'toolbox-advanced' });
	details.createEl('summary', {
		cls: 'toolbox-advanced__summary',
		text: label ?? t('common.advanced'),
	});
	return details.createDiv({ cls: 'toolbox-advanced__body' });
}

/** A row of buttons under a shared label, for actions rather than settings. */
export function actionRow(containerEl: HTMLElement, label: string): Setting {
	return new Setting(containerEl).setName(label).setClass('toolbox-actions');
}
