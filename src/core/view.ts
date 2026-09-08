import type { View, WorkspaceLeaf } from 'obsidian';
import type ToolboxPlugin from '../main';

const registeredTypes = new WeakMap<ToolboxPlugin, Set<string>>();

/**
 * Registers a view type at most once per plugin instance.
 *
 * `Plugin.registerView()` is the one piece of setup a module cannot own: the
 * registration is bound to the plugin's lifetime and registering the same type
 * twice throws. A module that can be switched off and on again would hit that on
 * the second enable.
 *
 * So the view *type* stays registered until the plugin unloads — that is by
 * design and costs nothing, since a registered type does nothing on its own. The
 * module still owns everything the user can see: its commands, its ribbon icon,
 * and the leaves it opened.
 */
export function registerViewOnce(
	plugin: ToolboxPlugin,
	type: string,
	viewCreator: (leaf: WorkspaceLeaf) => View
): void {
	let types = registeredTypes.get(plugin);
	if (!types) {
		types = new Set<string>();
		registeredTypes.set(plugin, types);
	}

	if (types.has(type)) {
		return;
	}

	types.add(type);
	plugin.registerView(type, viewCreator);
}
