import { describe, expect, it } from 'vitest';
import { isCheckDue, isRunnableHere, UpdateWatch } from './update-check';

const DAY = 24 * 60 * 60 * 1000;

describe('UpdateWatch', () => {
	it('has nothing to say when everything is on this version', () => {
		const watch = new UpdateWatch('0.4.0');
		watch.sawInRing('0.4.0');
		expect(watch.latest()).toBeUndefined();
	});

	it('ignores a device that is behind', () => {
		// The ordinary state of a ring mid-update: one device has the new one and
		// the rest have not. The ones that have not are not news.
		const watch = new UpdateWatch('0.4.0');
		watch.sawInRing('0.3.0');
		expect(watch.latest()).toBeUndefined();
	});

	it('ignores a device that never said which version it runs', () => {
		const watch = new UpdateWatch('0.4.0');
		watch.sawInRing(undefined);
		expect(watch.latest()).toBeUndefined();
	});

	it('reports a device in the ring that is ahead', () => {
		const watch = new UpdateWatch('0.4.0');
		watch.sawInRing('0.5.0');
		expect(watch.latest()).toEqual({ version: '0.5.0', from: 'ring' });
	});

	it('keeps the highest version it has been shown', () => {
		const watch = new UpdateWatch('0.4.0');
		watch.sawInRing('0.5.0');
		watch.sawInRing('0.6.0');
		watch.sawInRing('0.5.0');
		expect(watch.latest()?.version).toBe('0.6.0');
	});

	it('lets the repository beat the ring, and not the other way round', () => {
		const watch = new UpdateWatch('0.4.0');
		watch.sawInRing('0.5.0');
		watch.sawRelease('0.6.0');
		expect(watch.latest()).toEqual({ version: '0.6.0', from: 'github' });

		// A repeat of what is already known changes nothing, so the wording does
		// not flip every time a roster is read.
		watch.sawInRing('0.6.0');
		expect(watch.latest()).toEqual({ version: '0.6.0', from: 'github' });
	});

	it('tells its listeners only when the answer changed', () => {
		const watch = new UpdateWatch('0.4.0');
		let called = 0;
		watch.onChange(() => {
			called += 1;
		});

		watch.sawInRing('0.3.0');
		expect(called).toBe(0);

		watch.sawInRing('0.5.0');
		expect(called).toBe(1);

		watch.sawInRing('0.5.0');
		expect(called).toBe(1);
	});

	it('stops listening when asked', () => {
		const watch = new UpdateWatch('0.4.0');
		let called = 0;
		const stop = watch.onChange(() => {
			called += 1;
		});
		stop();
		watch.sawInRing('0.5.0');
		expect(called).toBe(0);
	});
});

describe('isCheckDue', () => {
	const now = 1_700_000_000_000;

	it('is due when nothing has ever been checked', () => {
		expect(isCheckDue(undefined, now)).toBe(true);
	});

	it('is not due again within the day', () => {
		expect(isCheckDue({ at: now - DAY / 2 }, now)).toBe(false);
	});

	it('is due a day later', () => {
		expect(isCheckDue({ at: now - DAY }, now)).toBe(true);
	});

	it('is due when the stored time is in the future', () => {
		// A clock that was wrong and has since been corrected would otherwise hold
		// the check off until whatever that wrong time plus a day turns out to be.
		expect(isCheckDue({ at: now + DAY * 400 }, now)).toBe(true);
	});
});

describe('isRunnableHere', () => {
	it('allows a release this Obsidian is new enough for', () => {
		expect(isRunnableHere('1.8.7', '1.8.7')).toBe(true);
		expect(isRunnableHere('1.8.7', '1.9.0')).toBe(true);
	});

	it('refuses one it is not', () => {
		// Offering an update the app will refuse to load is worse than saying
		// nothing: it gets installed, Obsidian disables it, and the notes stop
		// syncing.
		expect(isRunnableHere('1.13.0', '1.8.7')).toBe(false);
	});

	it('allows anything when the requirement is unreadable', () => {
		expect(isRunnableHere(undefined, '1.8.7')).toBe(true);
		expect(isRunnableHere('', '1.8.7')).toBe(true);
		expect(isRunnableHere(42, '1.8.7')).toBe(true);
	});
});
