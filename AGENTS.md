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
- A view type cannot be unregistered, so register it at most once and let it
  outlive the module; the module owns its commands and leaves instead.

Module ids are the keys settings are stored under. They are permanent once released.

A module draws two surfaces: `displaySettings()` for its settings section, and
`displayPanel()` for its part of the shared side panel. The panel knows nothing
about any feature — it walks the switched-on modules and asks each to draw itself,
so a new module appears there without `core/panel-view.ts` changing. Call
`this.refreshPanel()` after changing something the panel shows; it never polls.

Settings that exist for unusual setups go inside `advancedSection()`. What is left
outside it should be what someone actually needs on the first day.

## Text shown to users

Every user-facing string goes through `t()` from `src/i18n`, never inline. Add the
key to `src/i18n/locales/en.ts` first — it is the base locale and defines the type
— then translate it in `de.ts`, which is typed as complete and will fail to compile
until you do. Keep display text out of the logic: `diff.ts` emits reason codes and
the modal translates them.

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
- Nothing is installed unless Obsidian's curated community list contains it, the
  release manifest exists, and that manifest declares the same id. An id in a
  snapshot is never on its own a reason to fetch and run code.

## Sync guardian

It watches the user's sync; it never syncs anything itself. Three rules:

- Never resolve a conflict without showing the two versions first.
- Removing a file means `fileManager.trashFile()`, never a delete — the sync
  problems this module reports have already cost users content.
- Never merge conflict markers automatically. Open the note at the marker and let
  the user decide.

The double-sync check reads folder names above the vault. That is access outside
the vault, so it stays desktop-only, reads listings only, is switchable off, and is
disclosed in the README — the developer policy requires that disclosure.

## Vault sync

The rules the reconciler and engine must keep, in `src/modules/vault-sync`:

- Never merge and never overwrite when both sides changed. Keep both, naming the
  incoming one so the sync guardian recognises it.
- A remote deletion goes through `trashFile()`, never a hard delete, and never at
  all if this device edited the file since it last synced.
- Never infer a deletion without a base. A device with no sync state is missing
  files, not reporting that the user deleted them.
- The base state is per-device and carries the device id. A base written by
  another device is treated as no base at all.

The wire format and cryptography live in `packages/protocol` and are shared with
the server. Never reimplement either on one side only; drift between the ends of
a sync protocol is what loses data.

## Live editing

`src/modules/live-collab` puts an open note into a Yjs document and relays sealed
updates through the server. The rules that keep it from destroying text:

- One writer per note. A note claimed in `src/core/live-editing.ts` belongs to its
  session; the file sync must exclude every path in `liveEditing.list()`. Two
  writers on one note is the failure this whole project exists to prevent.
- A room with history wins over the file on disk. Only an empty room is seeded, and
  the seed is built under a fixed client id so two devices racing to seed the same
  file produce identical bytes rather than the text twice.
- Never echo a remote update back into the room. Updates that arrived from the
  socket are applied with the session as origin, and that origin is what the send
  path checks.
- Writing back to disk only happens when the text actually differs. An identical
  write still moves the modification time, which the file sync reads as a change.

Getting from a note to its CodeMirror view goes through `editor-binding.ts`, which
uses `editorInfoField` and a `Compartment` — both exported by Obsidian. Do not
reach for the undocumented `.cm` property on a Markdown view.

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
