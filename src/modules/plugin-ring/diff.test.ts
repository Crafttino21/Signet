import { describe, expect, it } from 'vitest';
import { computeDiff, jsonEquals, planApply } from './diff';
import type { LocalPlugin, RingSnapshot } from './types';

const SELF = 'signet';

function snapshotOf(plugins: RingSnapshot['plugins']): RingSnapshot {
	return {
		version: 1,
		seq: 1,
		host: { id: 'host-device', name: 'Desktop' },
		updatedAt: '2026-09-08T00:00:00.000Z',
		plugins,
	};
}

function entry(over: Partial<RingSnapshot['plugins'][number]> & { id: string }) {
	return {
		name: over.id,
		version: '1.0.0',
		enabled: true,
		isDesktopOnly: false,
		...over,
	};
}

function local(over: Partial<LocalPlugin> & { id: string }): LocalPlugin {
	return {
		name: over.id,
		version: '1.0.0',
		enabled: true,
		isDesktopOnly: false,
		...over,
	};
}

const options = { selfId: SELF, isMobile: false };

describe('jsonEquals', () => {
	it('ignores key order but not array order', () => {
		expect(jsonEquals({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		expect(jsonEquals([1, 2], [2, 1])).toBe(false);
	});

	it('separates missing keys from undefined values', () => {
		expect(jsonEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(jsonEquals(null, undefined)).toBe(false);
	});
});

describe('computeDiff', () => {
	it('reports a plugin the host has and this device does not', () => {
		const diff = computeDiff([], snapshotOf([entry({ id: 'dataview' })]), options);

		expect(diff).toHaveLength(1);
		expect(diff[0]).toMatchObject({ kind: 'missing', id: 'dataview', actionable: false });
	});

	it('reports enabling and disabling as actionable', () => {
		const diff = computeDiff(
			[local({ id: 'a', enabled: false }), local({ id: 'b', enabled: true })],
			snapshotOf([entry({ id: 'a', enabled: true }), entry({ id: 'b', enabled: false })]),
			options
		);

		expect(diff).toEqual([
			expect.objectContaining({ kind: 'enable', id: 'a', actionable: true }),
			expect.objectContaining({ kind: 'disable', id: 'b', actionable: true }),
		]);
	});

	it('reports differing settings but ignores settings the host did not share', () => {
		const shared = computeDiff(
			[local({ id: 'a', settings: { theme: 'dark' } })],
			snapshotOf([entry({ id: 'a', settings: { theme: 'light' } })]),
			options
		);
		expect(shared).toEqual([expect.objectContaining({ kind: 'settings', actionable: true })]);

		const withheld = computeDiff(
			[local({ id: 'a', settings: { theme: 'dark' } })],
			snapshotOf([entry({ id: 'a' })]),
			options
		);
		expect(withheld).toEqual([]);
	});

	it('flags a version difference without offering to fix it', () => {
		const diff = computeDiff(
			[local({ id: 'a', version: '1.0.0' })],
			snapshotOf([entry({ id: 'a', version: '2.0.0' })]),
			options
		);

		expect(diff).toEqual([
			expect.objectContaining({
				kind: 'version',
				hostVersion: '2.0.0',
				localVersion: '1.0.0',
				actionable: false,
			}),
		]);
	});

	it('never proposes removing a plugin the host does not have', () => {
		const diff = computeDiff([local({ id: 'mine' })], snapshotOf([]), options);

		expect(diff).toEqual([
			expect.objectContaining({ kind: 'extra', id: 'mine', actionable: false }),
		]);
	});

	it('leaves Signet itself out of the diff entirely', () => {
		const diff = computeDiff(
			[local({ id: SELF, enabled: true })],
			snapshotOf([entry({ id: SELF, enabled: false, settings: { secret: 'leaked' } })]),
			options
		);

		expect(diff).toEqual([]);
	});

	it('skips plugins this device ignores', () => {
		const diff = computeDiff([], snapshotOf([entry({ id: 'shell-commands' })]), {
			...options,
			ignoredIds: ['shell-commands'],
		});

		expect(diff).toEqual([]);
	});

	it('will not switch a desktop-only plugin on when running on mobile', () => {
		const diff = computeDiff(
			[local({ id: 'a', enabled: false, isDesktopOnly: true })],
			snapshotOf([entry({ id: 'a', enabled: true, isDesktopOnly: true })]),
			{ ...options, isMobile: true }
		);

		expect(diff).toEqual([
			expect.objectContaining({ kind: 'enable', actionable: false, reason: 'desktopOnly' }),
		]);
	});

	it('still allows switching a desktop-only plugin off on mobile', () => {
		const diff = computeDiff(
			[local({ id: 'a', enabled: true, isDesktopOnly: true })],
			snapshotOf([entry({ id: 'a', enabled: false, isDesktopOnly: true })]),
			{ ...options, isMobile: true }
		);

		expect(diff).toEqual([expect.objectContaining({ kind: 'disable', actionable: true })]);
	});
});

describe('planApply', () => {
	it('collects every change to one plugin into a single unit of work', () => {
		const snapshot = snapshotOf([entry({ id: 'a', enabled: true, settings: { x: 2 } })]);
		const diff = computeDiff(
			[local({ id: 'a', enabled: false, settings: { x: 1 } })],
			snapshot,
			options
		);

		expect(planApply(diff, snapshot, { selfId: SELF })).toEqual([
			{ id: 'a', name: 'a', settings: { x: 2 }, enabled: true },
		]);
	});

	it('drops items that cannot be acted on', () => {
		const snapshot = snapshotOf([entry({ id: 'a', version: '2.0.0' })]);
		const diff = computeDiff([local({ id: 'a', version: '1.0.0' })], snapshot, options);

		expect(planApply(diff, snapshot, { selfId: SELF })).toEqual([]);
	});

	it('refuses to act on Signet even when a snapshot names it', () => {
		// A diff from an older version could still contain Signet. Acting on it
		// would disable the plugin running the loop, so planApply filters again.
		const snapshot = snapshotOf([entry({ id: SELF, enabled: false })]);
		const forged = [
			{ kind: 'disable' as const, id: SELF, name: 'Signet', actionable: true },
			{ kind: 'settings' as const, id: SELF, name: 'Signet', actionable: true },
		];

		expect(planApply(forged, snapshot, { selfId: SELF })).toEqual([]);
	});
});
