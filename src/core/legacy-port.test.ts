import { describe, expect, it } from 'vitest';
import { isEmptyReport, NOT_FOUND, runPort } from './legacy-port';
import type { LeftAloneReason, Leftover } from './legacy-port';
import { rewritePrefixes } from './legacy-leftovers';

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

describe('rewritePrefixes', () => {
	it('moves a binding to the new prefix', () => {
		expect(rewritePrefixes({ 'toolbox:open-panel': [1] }, 'toolbox', 'signet')).toEqual({
			'signet:open-panel': [1],
		});
	});

	it('leaves every other plugin alone', () => {
		const stored = { 'toolbox:sync-now': [1], 'dataview:refresh': [2], 'editor:save': [3] };
		expect(rewritePrefixes(stored, 'toolbox', 'signet')).toEqual({
			'signet:sync-now': [1],
			'dataview:refresh': [2],
			'editor:save': [3],
		});
	});

	it('does not overwrite a binding somebody has already chosen', () => {
		// The old key is the stale one — nothing has answered to it since the
		// rename — so it goes, and the one that was chosen since then stays.
		const stored = { 'toolbox:open-panel': ['old'], 'signet:open-panel': ['new'] };
		expect(rewritePrefixes(stored, 'toolbox', 'signet')).toEqual({
			'signet:open-panel': ['new'],
		});
	});

	it('says there is nothing to do rather than rewriting the file for nothing', () => {
		// This file belongs to Obsidian and holds every hotkey the user has. It is
		// not written unless there is a reason.
		expect(rewritePrefixes({ 'dataview:refresh': [1] }, 'toolbox', 'signet')).toBeUndefined();
		expect(rewritePrefixes({}, 'toolbox', 'signet')).toBeUndefined();
	});

	it('refuses anything that is not an object of bindings', () => {
		expect(rewritePrefixes(null, 'toolbox', 'signet')).toBeUndefined();
		expect(rewritePrefixes([], 'toolbox', 'signet')).toBeUndefined();
		expect(rewritePrefixes('toolbox:open-panel', 'toolbox', 'signet')).toBeUndefined();
	});

	it('does not touch a key that merely starts with the same letters', () => {
		const stored = { 'toolboxer:go': [1] };
		expect(rewritePrefixes(stored, 'toolbox', 'signet')).toBeUndefined();
	});
});
