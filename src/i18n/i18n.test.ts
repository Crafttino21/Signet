import { afterEach, describe, expect, it } from 'vitest';
import { currentLocale, initI18n, LOCALES, t } from './index';
import { de } from './locales/de';
import { en } from './locales/en';

afterEach(() => {
	initI18n('en');
});

describe('locale selection', () => {
	it('uses the requested locale', () => {
		initI18n('de');
		expect(currentLocale()).toBe('de');
		expect(t('common.enable')).toBe(de['common.enable']);
	});

	it('falls back from a regional code to its base language', () => {
		initI18n('de-AT');
		expect(currentLocale()).toBe('de');

		initI18n('de_DE');
		expect(currentLocale()).toBe('de');
	});

	it('falls back to English for a language we do not ship', () => {
		initI18n('xx-YY');
		expect(currentLocale()).toBe('en');
		expect(t('common.enable')).toBe(en['common.enable']);
	});

	it('is case insensitive', () => {
		initI18n('DE');
		expect(currentLocale()).toBe('de');
	});
});

describe('t', () => {
	it('fills placeholders', () => {
		initI18n('en');
		expect(t('ring.notice.joined', { host: 'Desktop' })).toBe(
			'Joined the ring hosted by "Desktop".'
		);
	});

	it('leaves an unmatched placeholder visible rather than blanking it', () => {
		initI18n('en');
		expect(t('ring.notice.joined', { wrong: 'x' })).toContain('{host}');
	});

	it('accepts numbers', () => {
		initI18n('de');
		expect(t('ring.notice.published', { count: 3 })).toBe('3 Plugins im Ring veröffentlicht.');
	});

	it('falls back to English for a key a locale has not translated', () => {
		// A half-finished locale is the normal state for a contributed language,
		// so an untranslated key must show English rather than nothing.
		LOCALES['xx'] = { 'common.enable': 'Enabled-xx' };
		try {
			initI18n('xx');
			expect(t('common.enable')).toBe('Enabled-xx');
			expect(t('ring.name')).toBe(en['ring.name']);
		} finally {
			delete LOCALES['xx'];
		}
	});
});

describe('translation files', () => {
	it('German covers every English key with no extras', () => {
		expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
	});

	it('has no empty strings', () => {
		for (const [key, value] of Object.entries({ ...en, ...de })) {
			expect(value, key).not.toBe('');
		}
	});

	it('uses the same placeholders in German as in English', () => {
		const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

		for (const key of Object.keys(en) as (keyof typeof en)[]) {
			expect(placeholders(de[key]), key).toEqual(placeholders(en[key]));
		}
	});
});
