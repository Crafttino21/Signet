import { describe, expect, it } from 'vitest';
import { isEmptyReport, NOT_FOUND, runPort } from './legacy-port';
import type { LeftAloneReason, Leftover } from './legacy-port';
import { staleHotkeys } from './legacy-leftovers';

/**
 * The rule this file exists to hold down: nothing is retired that was not
 * carried in the same run.
 *
 * Everything here moves somebody's ring code, their device list or their
 * hotkeys. Getting it wrong once costs them all three on every device, so the
 * order of the two steps is worth a test of its own rather than only being a
 * comment.
 */

/** A leftover that records what was asked of it. */
function leftover(
	kind: Leftover['kind'],
	carry: () => Promise<LeftAloneReason | typeof NOT_FOUND | undefined>,
	log: string[]
): Leftover {
	return {
		kind,
		at: kind,
		carry: async () => {
			log.push(`carry:${kind}`);
			return carry();
		},
		retire: () => {
			log.push(`retire:${kind}`);
			return Promise.resolve();
		},
	};
}

const carried = () => Promise.resolve(undefined);
const notCarried = () => Promise.resolve<LeftAloneReason>('notCarried');

describe('runPort', () => {
	it('retires only what it carried', async () => {
		const log: string[] = [];
		const report = await runPort([
			leftover('ringFile', carried, log),
			leftover('rosterFolder', notCarried, log),
		]);

		expect(log).toEqual(['carry:ringFile', 'retire:ringFile', 'carry:rosterFolder']);
		expect(report.tidied.map((item) => item.kind)).toEqual(['ringFile']);
		expect(report.leftAlone).toEqual([
			{ kind: 'rosterFolder', at: 'rosterFolder', reason: 'notCarried' },
		]);
	});

	it('always carries before it retires', async () => {
		const log: string[] = [];
		await runPort([leftover('pluginFolder', carried, log)]);
		expect(log.indexOf('carry:pluginFolder')).toBeLessThan(log.indexOf('retire:pluginFolder'));
	});

	it('keeps the order it was given', async () => {
		// A folder is retired after the things inside it, or it is not empty when
		// its turn comes. That ordering is the caller's, so it must be respected.
		const log: string[] = [];
		await runPort([
			leftover('ringFile', carried, log),
			leftover('rosterFolder', carried, log),
			leftover('folder', carried, log),
		]);
		expect(log).toEqual([
			'carry:ringFile',
			'retire:ringFile',
			'carry:rosterFolder',
			'retire:rosterFolder',
			'carry:folder',
			'retire:folder',
		]);
	});

	it('treats a carry that throws as a reason to leave it alone', async () => {
		const report = await runPort([
			{
				kind: 'ringFile',
				at: 'Toolbox/plugin-ring.json',
				carry: () => Promise.reject(new Error('disk fell over')),
				retire: () => {
					throw new Error('must not be reached');
				},
			},
		]);

		expect(report.tidied).toEqual([]);
		expect(report.leftAlone[0]?.reason).toBe('unreadable');
	});

	it('reports a retire that fails instead of claiming it worked', async () => {
		const report = await runPort([
			{
				kind: 'pluginFolder',
				at: '.obsidian/plugins/toolbox',
				carry: carried,
				retire: () => Promise.reject(new Error('read only')),
			},
		]);

		expect(report.tidied).toEqual([]);
		expect(report.leftAlone[0]?.reason).toBe('failed');
	});

	it('lets one failure not stop the rest', async () => {
		// A ring file that will not open is no reason to leave a dead plugin folder
		// lying under plugins/.
		const log: string[] = [];
		const report = await runPort([
			leftover('ringFile', notCarried, log),
			leftover('pluginFolder', carried, log),
		]);
		expect(report.tidied.map((item) => item.kind)).toEqual(['pluginFolder']);
	});

	it('has nothing to report when there was nothing to find', async () => {
		expect(isEmptyReport(await runPort([]))).toBe(true);
	});

	it('says nothing at all about a leftover that is not there', async () => {
		// The list is fixed, because most of these cannot be looked for without
		// doing the looking. A vault whose only leftover is a folder must not be
		// told its hotkeys were left alone for want of something to carry.
		const log: string[] = [];
		const report = await runPort([
			leftover('hotkeys', () => Promise.resolve(NOT_FOUND), log),
			leftover('folder', carried, log),
		]);

		expect(log).toEqual(['carry:hotkeys', 'carry:folder', 'retire:folder']);
		expect(report.leftAlone).toEqual([]);
		expect(report.tidied.map((item) => item.kind)).toEqual(['folder']);
	});
});

describe('staleHotkeys', () => {
	it('finds a binding nothing answers to any more', () => {
		expect(staleHotkeys({ 'toolbox:open-panel': [1] }, 'toolbox', 'signet')).toEqual([
			'toolbox:open-panel',
		]);
	});

	it('leaves every other plugin out of it', () => {
		const stored = { 'toolbox:sync-now': [1], 'dataview:refresh': [2], 'editor:save': [3] };
		expect(staleHotkeys(stored, 'toolbox', 'signet')).toEqual(['toolbox:sync-now']);
	});

	it('says nothing about one that has already been set again', () => {
		// Telling somebody to bind a key they have already bound is telling them
		// something untrue.
		const stored = { 'toolbox:open-panel': ['old'], 'signet:open-panel': ['new'] };
		expect(staleHotkeys(stored, 'toolbox', 'signet')).toEqual([]);
	});

	it('finds nothing in a file that has none', () => {
		expect(staleHotkeys({ 'dataview:refresh': [1] }, 'toolbox', 'signet')).toEqual([]);
		expect(staleHotkeys({}, 'toolbox', 'signet')).toEqual([]);
	});

	it('does not mistake a longer plugin name for the prefix', () => {
		expect(staleHotkeys({ 'toolboxer:go': [1] }, 'toolbox', 'signet')).toEqual([]);
	});

	it('refuses anything that is not an object of bindings', () => {
		expect(staleHotkeys(null, 'toolbox', 'signet')).toEqual([]);
		expect(staleHotkeys([], 'toolbox', 'signet')).toEqual([]);
		expect(staleHotkeys('toolbox:open-panel', 'toolbox', 'signet')).toEqual([]);
	});

	it('does not lose a key called __proto__ on the way through', () => {
		// It used to build a new object and copy keys into it, and assigning
		// `__proto__` sets a prototype rather than a property — so such a key
		// disappeared when the file was written back. Nothing is built now, and
		// hotkeys.json is a file nobody can easily rebuild.
		const stored = JSON.parse('{"__proto__": {"x": 1}, "toolbox:open-panel": [1]}');
		expect(staleHotkeys(stored, 'toolbox', 'signet')).toEqual(['toolbox:open-panel']);
	});
});
