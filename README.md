# Toolbox

An Obsidian plugin that collects several small quality-of-life tools in one place,
each one switchable on its own.

Every feature is a **module**: a self-contained unit with its own settings that can
be turned on and off at runtime without restarting Obsidian. The plugin ships with
three example modules that exist purely as templates to copy.

## Installing for development

```bash
npm install
npm run dev      # rebuild on change
```

Then copy `main.js`, `manifest.json` and `styles.css` into your vault:

```
<your vault>/.obsidian/plugins/toolbox/
```

Enable **Toolbox** under Settings → Community plugins. After a rebuild, use
_Reload app without saving_ (or the Hot Reload plugin) to pick up the change.

## Adding a module

Three steps, no changes to the plugin core:

1. Create `src/modules/<your-module>/index.ts`.
2. Subclass `ToolboxModule` and export a `ModuleDescriptor`.
3. Add the descriptor to `TOOLBOX_MODULES` in `src/modules/index.ts`.

```ts
import { ToolboxModule } from '../../core/module';
import type { ModuleDescriptor } from '../../core/module';
import type ToolboxPlugin from '../../main';

type MySettings = { threshold: number };

const DEFAULT_SETTINGS: MySettings = { threshold: 5 };

class MyModule extends ToolboxModule<MySettings> {
	override onload(): void {
		this.addCommand({ id: 'do-it', name: 'Do it', callback: () => this.run() });
	}

	private run(): void {
		// this.settings.threshold, this.app, ...
	}
}

export const myModule: ModuleDescriptor<MySettings> = {
	id: 'my-module',
	name: 'My module',
	description: 'What switching this on does.',
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new MyModule(plugin, myModule),
};
```

Settings, the enable toggle and the settings section come for free.

### The one rule

**Register everything through `this.*`, never through `this.plugin.*`.**

A module is an Obsidian `Component`, and `this.register()`, `this.registerEvent()`,
`this.registerDomEvent()`, `this.registerInterval()`, `this.addCommand()` and
`this.addRibbonIcon()` all undo themselves when the module is switched off.
The same calls made on `this.plugin` survive until the whole plugin unloads, which
means a switched-off module would leave its commands and listeners behind.

Two things need care:

- **Views.** `Plugin.registerView()` cannot be undone and throws on a second
  registration, so use `registerViewOnce()` from `src/core/view.ts`. The view type
  stays registered for the plugin's lifetime; the module owns the leaves instead.
- **Cleanup that must not happen on shutdown.** `onunload()` runs both when the user
  switches a module off _and_ when Obsidian closes or updates the plugin. Put anything
  that should only happen on a deliberate switch-off — detaching leaves above all — in
  `onDisable()`.

Module ids are settings keys. Changing one after a release orphans every user's
configuration for that module.

## Development

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Rebuild `main.js` on every change                    |
| `npm run build`     | Typecheck, then produce a minified `main.js`         |
| `npm run typecheck` | `tsc --noEmit`                                       |
| `npm run lint`      | ESLint, including Obsidian's own plugin-review rules |
| `npm run format`    | Prettier                                             |
| `npm test`          | Vitest                                               |
| `npm run check`     | Typecheck + lint + tests                             |

Tests run against `src/test/obsidian.stub.ts`, a hand-written stand-in for the
`obsidian` module, which only exists inside the app at runtime. When a module starts
importing something new from `obsidian`, add it to the stub.

`npm run lint` includes `eslint-plugin-obsidianmd`, which checks the same rules the
community plugin review applies — so surprises show up here rather than at submission.

## Layout

```
src/
  main.ts                  loads settings, builds the registry, adds the settings tab
  core/
    module.ts              ToolboxModule base class + ModuleDescriptor
    registry.ts            which modules exist, which are running
    settings.ts            settings shape + migration
    settings-tab.ts        one section per module
    view.ts                registerViewOnce()
  modules/
    index.ts               the module list — the only file a new feature touches
    example-command/       a command, a ribbon icon, one setting
    example-view/          a sidebar panel
    example-events/        vault and workspace listeners
  test/
    obsidian.stub.ts       stand-in for the `obsidian` module
```

## Before a public release

- Decide on the final `id` and `name` in `manifest.json` (the `id` is permanent) and
  update `name` in `package.json` to match.
- Set `author` and optionally `authorUrl` / `fundingUrl` in `manifest.json`.
- Remove the `example-*` modules once real ones exist.
- Check `minAppVersion` against the newest API you actually use. It is currently
  `1.7.2`, set by `Plugin.removeCommand()`.

## License

[MIT](LICENSE)
