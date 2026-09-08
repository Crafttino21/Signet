# Toolbox

An Obsidian plugin that collects several small quality-of-life tools in one place,
each one switchable on its own.

Every feature is a **module**: a self-contained unit with its own settings that can
be turned on and off at runtime without restarting Obsidian.

## Plugin ring

Keeps the plugins and their settings in step across your devices, so setting up a
new one does not mean reinstalling and reconfiguring everything by hand.

One device is the **host**. It publishes a snapshot of which plugins it has, which
are switched on, and their settings. The other devices join with a code and pull
that snapshot in — after being shown exactly what would change.

Because every device opens the same synced vault, the ring needs no server and no
account: the snapshot is an ordinary file inside the vault. That is deliberate —
config folders often do not sync to mobile, ordinary vault files do.

**How it is kept safe.** Applying a ring update means running code from another
machine, and that exact pattern has been attacked in the wild ([PHANTOMPULSE][],
April 2026: a shared vault was used to pull in plugins that then executed shell
commands). So:

- Joining takes the code. A device never joins a ring on its own.
- The snapshot is encrypted with AES-GCM using a key derived from that code. Since
  AES-GCM is authenticated, write access to the vault is not enough to push a
  snapshot at the ring — only someone holding the code can.
- Nothing is applied without showing you the changes first.
- Toolbox never acts on itself, and a plugin the host does not have is left alone
  rather than removed.

The settings of other plugins routinely contain API keys in plain text, which is
why the snapshot is encrypted rather than merely signed. You can also list plugins
whose settings should never leave this device.

[PHANTOMPULSE]: https://thehackernews.com/2026/04/obsidian-plugin-abuse-delivers.html

### What it currently does and does not do

Switching plugins on and off and syncing their settings works. **Installing a
plugin the device does not have yet is not implemented** — those show up in the
diff as "not installed here" so you know what to add by hand. When that lands, it
will install only from Obsidian's curated community list.

### Disclosure

The ring reads and writes other plugins' `data.json` and switches plugins on and
off. It does that through `app.plugins`, which is an internal Obsidian API that is
not part of the public typings — `src/core/obsidian-internals.ts` isolates it and
disables the feature if a future Obsidian release changes it. The ring itself makes
no network requests.

## Example modules

Three example modules ship alongside it as templates to copy: a command, a sidebar
panel and a pair of event listeners.

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
    obsidian-internals.ts  the one file that touches Obsidian's internal API
  modules/
    index.ts               the module list — the only file a new feature touches
    plugin-ring/           keeps plugins in step across devices
    example-command/       a command, a ribbon icon, one setting
    example-view/          a sidebar panel
    example-events/        vault and workspace listeners
  test/
    obsidian.stub.ts       stand-in for the `obsidian` module
    fake-app.ts            in-memory vault and plugin manager for tests
```

Inside `plugin-ring/`, the files without an Obsidian import — `code.ts`, `crypto.ts`
and `diff.ts` — hold the logic worth testing, and that is where the tests are.

## Before a public release

- Decide on the final `id` and `name` in `manifest.json` (the `id` is permanent) and
  update `name` in `package.json` to match.
- Set `author` and optionally `authorUrl` / `fundingUrl` in `manifest.json`.
- Remove the `example-*` modules once real ones exist.
- Check `minAppVersion` against the newest API you actually use. It is currently
  `1.7.2`, set by `Plugin.removeCommand()`.

## License

[MIT](LICENSE)
