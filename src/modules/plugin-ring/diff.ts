import type { DiffItem, DiffReason, LocalPlugin, PluginPlan, RingSnapshot } from './types';

export interface DiffOptions {
	/** Signet's own plugin id. Never appears in a diff — see the note below. */
	selfId: string;
	/** True on iOS/Android, where desktop-only plugins must not be switched on. */
	isMobile: boolean;
	/** Plugins this device deliberately ignores. */
	ignoredIds?: readonly string[];
	/** False when this Obsidian has no installer, or the user switched it off. */
	canInstall?: boolean;
}

/** Structural comparison of two JSON values. Arrays compare in order, objects do not. */
export function jsonEquals(a: unknown, b: unknown): boolean {
	if (a === b) {
		return true;
	}
	if (typeof a !== typeof b || a === null || b === null) {
		return false;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => jsonEquals(item, b[index]));
	}
	if (typeof a !== 'object') {
		return false;
	}

	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	if (keys.length !== Object.keys(right).length) {
		return false;
	}
	return keys.every((key) => key in right && jsonEquals(left[key], right[key]));
}

/**
 * Works out what differs between the host's snapshot and this device.
 *
 * Two rules shape the output:
 *
 * - Signet itself is never part of a diff. Applying an item means disabling and
 *   re-enabling a plugin, and doing that to the plugin running the loop would cut
 *   the loop off mid-way with nothing reported. It is filtered here and again in
 *   {@link planApply}, because a snapshot from an older version might still name it.
 * - A plugin the host does not have is reported as `extra` and is never actionable.
 *   Uninstalling would throw away that plugin's own data.json, so removal is never
 *   something a diff does on its own.
 */
export function computeDiff(
	local: readonly LocalPlugin[],
	snapshot: RingSnapshot,
	options: DiffOptions
): DiffItem[] {
	const ignored = new Set([options.selfId, ...(options.ignoredIds ?? [])]);
	const localById = new Map(
		local.filter((plugin) => !ignored.has(plugin.id)).map((p) => [p.id, p])
	);
	const items: DiffItem[] = [];

	for (const entry of snapshot.plugins) {
		if (ignored.has(entry.id)) {
			continue;
		}

		const mine = localById.get(entry.id);
		const blockedOnMobile = options.isMobile && entry.isDesktopOnly;
		const reason: DiffReason | undefined = blockedOnMobile ? 'desktopOnly' : undefined;

		if (!mine) {
			// Installing is the only action that brings in code this device has never
			// run, so it needs both a working installer and a device that can run it.
			const installable = options.canInstall === true && !blockedOnMobile;
			items.push({
				kind: 'missing',
				id: entry.id,
				name: entry.name,
				hostVersion: entry.version,
				actionable: installable,
				reason: installable ? undefined : (reason ?? 'cannotInstall'),
			});
			continue;
		}

		if (entry.version !== mine.version) {
			items.push({
				kind: 'version',
				id: entry.id,
				name: entry.name,
				hostVersion: entry.version,
				localVersion: mine.version,
				actionable: false,
				reason: 'noUpdate',
			});
		}

		if (entry.settings !== undefined && !jsonEquals(entry.settings, mine.settings)) {
			items.push({
				kind: 'settings',
				id: entry.id,
				name: entry.name,
				actionable: !blockedOnMobile,
				reason,
			});
		}

		if (entry.enabled !== mine.enabled) {
			items.push({
				kind: entry.enabled ? 'enable' : 'disable',
				id: entry.id,
				name: entry.name,
				// Switching a plugin off is always safe; switching a desktop-only one
				// on is not.
				actionable: entry.enabled ? !blockedOnMobile : true,
				reason: entry.enabled ? reason : undefined,
			});
		}
	}

	const hostIds = new Set(snapshot.plugins.map((entry) => entry.id));
	for (const mine of localById.values()) {
		if (!hostIds.has(mine.id)) {
			items.push({
				kind: 'extra',
				id: mine.id,
				name: mine.name,
				localVersion: mine.version,
				actionable: false,
				reason: 'hostLacks',
			});
		}
	}

	return items;
}

/**
 * Turns the actionable part of a diff into one unit of work per plugin.
 *
 * Grouping by plugin is what lets the caller do `disable -> write -> enable` as a
 * single step per plugin, instead of disabling everything and then enabling
 * everything — which would leave a pile of dead plugins behind if it broke down
 * halfway.
 */
export function planApply(
	items: readonly DiffItem[],
	snapshot: RingSnapshot,
	options: Pick<DiffOptions, 'selfId'>
): PluginPlan[] {
	const entries = new Map(snapshot.plugins.map((entry) => [entry.id, entry]));
	const plans = new Map<string, PluginPlan>();

	for (const item of items) {
		// Second line of defence: Signet must never end up in an operation, no
		// matter what a snapshot claims.
		if (!item.actionable || item.id === options.selfId) {
			continue;
		}

		const entry = entries.get(item.id);
		if (!entry) {
			continue;
		}

		const plan = plans.get(item.id) ?? { id: item.id, name: item.name };
		if (item.kind === 'missing' || item.kind === 'version') {
			plan.install = entry.version;
			if (item.kind === 'missing') {
				// A plugin worth fetching is one the host is actually using, and its
				// settings come along in the same unit of work. An update inherits
				// neither: this device may have switched it off on purpose.
				plan.enabled = entry.enabled;
				if (entry.settings !== undefined) {
					plan.settings = entry.settings;
				}
			}
		} else if (item.kind === 'settings') {
			plan.settings = entry.settings;
		} else if (item.kind === 'enable' || item.kind === 'disable') {
			plan.enabled = item.kind === 'enable';
		}
		plans.set(item.id, plan);
	}

	return [...plans.values()];
}
