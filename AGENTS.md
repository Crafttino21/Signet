# Conventions

Notes for anyone — human or AI — working in this repository.

## Architecture

Every feature is a module under `src/modules/<name>/index.ts`: a `ToolboxModule`
subclass plus an exported `ModuleDescriptor`, registered in `src/modules/index.ts`.
Nothing feature-specific belongs in `src/main.ts` or `src/core/` — those stay generic.

A module is an Obsidian `Component`, which is what makes runtime toggling work.
`this.register*()` cleans up when _that component_ unloads, so:

- Register through `this.*`, never `this.plugin.*`. `this.addCommand()` and
  `this.addRibbonIcon()` exist on `ToolboxModule` precisely because the `Plugin`
  versions cannot be undone per module.
- `onload()` sets up, `onunload()` runs on both switch-off and plugin unload,
  `onDisable()` runs only on a deliberate switch-off.
- Views go through `registerViewOnce()` in `src/core/view.ts`.

Module ids are the keys settings are stored under. They are permanent once released.

## Obsidian plugin rules

These are enforced by `npm run lint` (`eslint-plugin-obsidianmd`), which mirrors the
community plugin review. Beyond what the linter catches:

- Use `this.app`, never the global `app`.
- Build DOM with `createEl()` / `createDiv()` and clear it with `empty()`. Never
  `innerHTML`, `outerHTML` or `insertAdjacentHTML`.
- Style through classes in `styles.css` using Obsidian's CSS variables. No inline
  `style` attributes, no hardcoded colours.
- `normalizePath()` on every path that comes from settings or string concatenation.
- `Vault.process()` for background edits, the `Editor` interface for the active note,
  `FileManager.processFrontMatter()` for frontmatter. Not `Vault.modify()`.
- The `Vault` API rather than the `Adapter` API.
- No default hotkeys, and no console output on the happy path — errors only.
- Sentence case in user-facing text.
- Do not detach leaves in `onunload()`; that belongs in `onDisable()`.

## Obsidian internals

`src/core/obsidian-internals.ts` is the only file allowed to touch `app.plugins`.
That API is undocumented and absent from `obsidian.d.ts`; keeping it in one place
means a future Obsidian release breaks one file, and the wrapper can disable the
feature instead of crashing. Do not reach for `app.plugins` anywhere else.

`app.vault.configDir` is the config folder — never write `.obsidian` literally.
Hidden folders are reachable only through the adapter API, visible vault files
through the vault API.

## Plugin ring

The ring applies changes another device published, which means running code from
elsewhere. Three rules are not negotiable:

- Toolbox never appears in a diff or an operation. Disabling the plugin that is
  running the apply loop would cut the loop off silently, so it is filtered when
  collecting, again in `planApply`, and once more in `applyPlans`.
- Changes are applied one plugin at a time as `disable -> write -> enable`, never
  as a batch of disables followed by a batch of enables.
- A snapshot only counts as applied when every item succeeded, and a plugin the
  host does not have is left alone rather than removed.

## Privacy

The plugin works offline and stays that way: no network calls, no telemetry, no
remote code loading. Anything that would change that needs an explicit decision
first, not a pull request.

## Before finishing a change

```bash
npm run check    # typecheck + lint + tests
```

New Obsidian imports need a matching export in `src/test/obsidian.stub.ts`, or the
tests break on something that works fine in the real app.
