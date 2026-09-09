import type { App } from 'obsidian';
import type { PluginApi } from '../../core/obsidian-internals';
import type { InstallOutcome } from './installer';
import { writePluginData } from './plugin-data';
import type { PluginPlan } from './types';

export interface ApplyFailure {
	plan: PluginPlan;
	error: string;
}

export interface ApplyResult {
	applied: PluginPlan[];
	/** Plugins fetched from the community list during this run. */
	installed: string[];
	failed: ApplyFailure[];
	/**
	 * Only true when every unit of work succeeded. The caller must not record the
	 * snapshot as applied otherwise — doing so would make the diff disappear while
	 * this device never actually caught up with the host.
	 */
	complete: boolean;
}

export interface ApplyDeps {
	app: App;
	api: PluginApi;
	/** Toolbox's own id, which is never acted on. */
	selfId: string;
	/**
	 * Fetches a plugin this device does not have.
	 *
	 * Injected rather than imported so this file stays free of the network, and so
	 * a test can exercise the ordering without one. Absent means installing is off,
	 * and a plan asking for it fails rather than being silently half-applied.
	 */
	install?: (request: { id: string; version: string }) => Promise<InstallOutcome>;
}

function refusalMessage(outcome: Extract<InstallOutcome, { ok: false }>): string {
	if (outcome.refusal === 'notListed') {
		return 'Not in Obsidian’s community plugin list, so it was not installed.';
	}
	if (outcome.refusal === 'unsupported') {
		return 'This Obsidian version does not expose the plugin installer.';
	}
	return outcome.detail ?? 'No matching release was found.';
}

/**
 * Carries out one plan per plugin.
 *
 * Each plugin is done as a self-contained unit rather than in phases across all
 * of them. If the run breaks down halfway, the plugins it has not reached are
 * simply untouched, instead of being left switched off.
 *
 * The order within a unit matters and differs by case. A plugin being installed
 * is not running yet, so its settings can be written straight away and it is
 * switched on last. One that is already installed has to be switched off first,
 * because a running plugin holds its settings in memory and would write them back
 * over what we just put on disk.
 *
 * A failure on one plugin does not stop the others — the same best-effort shape
 * the module registry uses. What matters is that the caller learns exactly what
 * did and did not happen.
 */
export async function applyPlans(
	deps: ApplyDeps,
	plans: readonly PluginPlan[]
): Promise<ApplyResult> {
	const applied: PluginPlan[] = [];
	const installed: string[] = [];
	const failed: ApplyFailure[] = [];

	for (const plan of plans) {
		// Third and last guard against acting on ourselves. Disabling the plugin
		// that is running this loop would end the loop silently, mid-way.
		if (plan.id === deps.selfId) {
			continue;
		}

		try {
			if (plan.install !== undefined) {
				if (!deps.install) {
					throw new Error('Installing plugins is switched off.');
				}

				const outcome = await deps.install({ id: plan.id, version: plan.install });
				if (!outcome.ok) {
					throw new Error(refusalMessage(outcome));
				}
				installed.push(plan.id);
			}

			const alreadyRunning = deps.api.isEnabled(plan.id);
			const target = plan.enabled ?? alreadyRunning;

			if (plan.settings !== undefined) {
				// A running plugin holds its settings in memory and would overwrite
				// the file again, so it has to be off while we write. A freshly
				// installed one is not running, and needs no such dance.
				if (alreadyRunning) {
					await deps.api.disable(plan.id);
				}
				await writePluginData(deps.app, plan.id, plan.settings);
			}

			if (target && !deps.api.isEnabled(plan.id)) {
				await deps.api.enable(plan.id);
			} else if (!target && deps.api.isEnabled(plan.id)) {
				await deps.api.disable(plan.id);
			}

			applied.push(plan);
		} catch (error) {
			failed.push({ plan, error: error instanceof Error ? error.message : String(error) });
		}
	}

	return { applied, installed, failed, complete: failed.length === 0 };
}
