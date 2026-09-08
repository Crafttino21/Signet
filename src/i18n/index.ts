import { getLanguage } from 'obsidian';
import { de } from './locales/de';
import { en } from './locales/en';
import type { TranslationKey, Translations } from './locales/en';

export type { TranslationKey, Translations };

/**
 * Every locale the plugin ships with.
 *
 * **Adding a language:** copy `locales/en.ts`, translate the values, type it as
 * `Partial<Translations>` (or `Translations` if it is complete), and add one line
 * here. Anything left untranslated falls back to English, so a half-finished
 * language is still useful. Use the codes from Obsidian's translation repository.
 */
export const LOCALES: Record<string, Partial<Translations>> = {
	en,
	de,
};

let active: Partial<Translations> = en;
let activeLocale = 'en';

/**
 * Picks the locale from Obsidian's UI language.
 *
 * A regional code falls back to its base language — `de-AT` uses `de` — and
 * anything unknown uses English. The language cannot change without restarting
 * Obsidian, so this is called once at load.
 */
export function initI18n(locale: string = getLanguage()): void {
	const normalized = locale.toLowerCase();
	const base = normalized.split(/[-_]/)[0] ?? 'en';

	activeLocale = LOCALES[normalized] ? normalized : LOCALES[base] ? base : 'en';
	active = LOCALES[activeLocale] ?? en;
}

export function currentLocale(): string {
	return activeLocale;
}

/**
 * Looks up a string, falling back to English when the active locale has no entry.
 *
 * `{name}` placeholders are replaced from `vars`. A placeholder with no matching
 * variable is left as it is rather than blanked, so the mistake is visible.
 */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
	const template = active[key] ?? en[key];
	if (!vars) {
		return template;
	}

	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = vars[name];
		return value === undefined ? match : String(value);
	});
}
