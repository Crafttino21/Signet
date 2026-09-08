import type { App } from 'obsidian';
import type { PluginApi } from '../../core/obsidian-internals';
import { writePluginData } from './plugin-data';
import type { PluginPlan } from './types';

export interface ApplyFailure {
	plan: PluginPlan;
	error: string;
}

export interface ApplyResult {
	applied: PluginPlan[];
	failed: ApplyFailure[];
	/**
	 * Only true when every unit of work succeeded. The caller must not record the
	 * snapshot as applied otherwise — doing so would make the diff disappear while
	 * this device never actually caught up with the host.
	 */
	complete: boolean;
}

/**
 * Carries out one plan per plugin.
 *
 * Each plugin is done as a self-contained `disable -> write -> enable` step rather
 * than disabling everything first and enabling everything afterwards. If the run
 * breaks down halfway, the plugins it has not reached yet are simply untouched,
 * instead of being left switched off.
 *
 * A failure on one plugin does not stop the others — the same best-effort shape
 * the module registry uses in `src/core/registry.ts`. What matters is that the
 * caller learns exactly what did and did not happen.
 */
export async function applyPlans(
	app: App,
	api: PluginApi,
	plans: readonly PluginPlan[],
	selfId: string
): Promise<ApplyResult> {
	const applied: PluginPlan[] = [];
	const failed: ApplyFailure[] = [];

	for (const plan of plans) {
		// Third and last guard against acting on ourselves. Disabling the plugin
		// that is running this loop would end the loop silently, mid-way.
		if (plan.id === selfId) {
			continue;
		}

		try {
			const target = plan.enabled ?? api.isEnabled(plan.id);

			if (plan.settings !== undefined) {
				// A running plugin holds its settings in memory and would overwrite
				// the file again, so it has to be off while we write.
				if (api.isEnabled(plan.id)) {
					await api.disable(plan.id);
				}
				await writePluginData(app, plan.id, plan.settings);
			}

			if (target && !api.isEnabled(plan.id)) {
				await api.enable(plan.id);
			} else if (!target && api.isEnabled(plan.id)) {
				await api.disable(plan.id);
			}

			applied.push(plan);
		} catch (error) {
			failed.push({ plan, error: error instanceof Error ? error.message : String(error) });
		}
	}

	return { applied, failed, complete: failed.length === 0 };
}
