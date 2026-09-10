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

A module that cannot do anything yet is not shown at all. `available()` on the
descriptor is that gate — the vault sync appears once there is a ring, live
editing once a server has answered — and it governs the settings tab, the panel
and the guided setup alike. `enableWhenAvailable` then switches it on the first
time that happens, once ever, recorded in `autoEnabled`: pasting a code that
carries a server is asking for the sync, and a prerequisite reappearing must not
overrule someone who later switched it off. The panel names anything available
and still off, so nobody has to go looking. Availability is display only:
whether a module runs is the user's switch, and one that is on but not yet
relevant sits idle rather than being torn down and rebuilt as its prerequisite
comes and goes.

The same principle inside a module: while the vault sync has no server that has
answered, its settings show the one thing there is to do and say the rest follows.
A page of controls that cannot say which of them is the one in the way is worse
than a short page.

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
- A run somebody asked for reports back; one that ran on its own does not, unless
  it failed. A button that works in silence reads as a button that did nothing,
  and an unattended sync that announces itself is a notice every few seconds.
- A notice is for something that just happened. A ring file that has not arrived
  yet, a device still waiting for a host: those are states, they belong in the
  panel, and a notice repeats them on every start and every write forever. What
  a client reaches without anybody pressing anything says nothing unless it is
  both new and actionable — and says it once.
- A ring file that will not open is classified before anything is written over it
  (`classifyRingFile`). Only a file whose ring id is demonstrably not ours may be
  moved aside, and it goes to the trash rather than being overwritten. A file of
  ours that merely looks broken is left alone — a sync client caught mid-write
  looks exactly the same.

## The device roster

`src/modules/plugin-ring/devices.ts`. One file per device under
`<ring folder>/devices`, named after the device id — a single writer per file,
so the roster cannot become a source of conflicts. Ordinary vault files, so they
travel by the sync and measure it.

- Removing a device and handing over the host are **cooperative**, and the
  wording must keep saying so. The ring code is the key: a removed device that
  keeps the code can still read the ring, and only a new ring revokes anything.
  Never write "revoke", "block" or "kick" about either.
- Removal travels in the snapshot's `removed` list and the host carries it
  forward on every publish. A device that reads its own id there leaves.
- A handover is published before the old host steps down. Stepping down first
  would leave a ring nobody is publishing.
- A device's own heartbeat is the only file it writes there, and another
  device's goes to the trash rather than being deleted.
- Another device's heartbeat arrives as an ordinary file write, so the roster is
  re-read on vault events in that folder and when the panel finds it stale. The
  host runs none of the client paths, so without that it read the roster once at
  startup and never again — which is exactly how a phone stays invisible.
- The panel is the ring and nothing else. A module with settings puts them in
  the settings; `displayPanel` is for what only the panel can answer.

## Vault sync

The rules the reconciler and engine must keep, in `src/modules/vault-sync`:

- Never merge and never overwrite when both sides changed. Keep both, naming the
  incoming one so it is recognisable as a conflicted copy — `patterns.ts` is what
  recognises them, and the panel counts them, because a copy nobody looks at is
  the same as a lost edit.
- A remote deletion goes through `trashFile()`, never a hard delete, and never at
  all if this device edited the file since it last synced.
- Never infer a deletion without a base. A device with no sync state is missing
  files, not reporting that the user deleted them.
- The base state is per-device and carries the device id. A base written by
  another device is treated as no base at all.

The wire format and cryptography live in `packages/protocol` and are shared with
the server. Never reimplement either on one side only; drift between the ends of
a sync protocol is what loses data.

## What the ring carries

`src/core/ring-link.ts` is the seam between the ring and the sync, and exists so
neither module imports the other: the sync module contributes its server address,
the ring publishes it inside the encrypted snapshot, and every device that reads a
snapshot announces what it found.

- Only the host publishes. A request to publish from elsewhere is a no-op on every
  other device, which is why the request is a broadcast rather than a call.
- The server is connected before the ring is committed, through
  `RingLink.setUpServer()`. A code shown before the server exists carries no
  address, and every device that joined with one is stranded — so the first code
  anyone sees is already the complete one.
- Anything that walks the vault waits for `onLayoutReady`. Pasting a join code
  sets the whole chain going — ring settings, announced address, adopt, claim,
  first sync — during a module's own `onload`, when `vault.getFiles()` is still
  empty. It fires immediately when the index is already there, so the wait costs
  nothing.
- The ring code is the vault's identity. When it changes or goes away,
  `RingLink.ringChanged()` says so and the sync drops its registration: the vault
  id, the token and every key came out of the code that just left, and a device
  still calling itself registered talks to a vault it cannot open.
- An address a person typed is never replaced by the ring; one that came from the
  ring is. On a home network the host's address can be the unreachable one, so a
  typed answer stands — but a server that moves must not need a visit to every
  device. `serverUrlSource` in the sync settings is what carries that distinction,
  and `shouldAdopt` in `server-url.ts` is the whole rule.
- An address out of a snapshot is checked for scheme before it is ever used, and so
  is one the host typed — before it is published, not after, because a client drops
  a malformed address silently and there is nowhere to see that happen.
- A local address without a port gets 8787, and is told so. `http://10.0.0.1` is a
  valid URL meaning port 80, where nothing is listening, and the result is
  "connection refused" for a server that is running fine. An explicitly typed port
  is never second-guessed, including `:80`.
- The address also rides on the join code, because the snapshot cannot reach a
  device that has never synced. That is a display form only: settings store the
  bare ring code, and `parseRingCode` ignores any suffix.
- `addressToUrl` always writes the port, default or not. An address with no port
  is what `completeServerUrl` fills in, so dropping `:80` on the way out turns it
  into `:8787` on the way in. What cannot be encoded at all is reported where the
  code is shown, never dropped in silence.
- A joining device registers nothing. Registration creates the vault and fixes
  which token opens it; every later device derives that same token from the same
  ring code, so it only asks whether the host has been there yet. The registration
  secret is server-wide and must never travel to a second device.

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
