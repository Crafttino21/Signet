# Toolbox

An Obsidian plugin that collects several small quality-of-life tools in one place,
each one switchable on its own.

Every feature is a **module**: a self-contained unit with its own settings that can
be turned on and off at runtime without restarting Obsidian.

Everything is managed from one place. The wrench in the ribbon opens a side panel
where each switched-on module draws its own state and its own buttons — the ring,
the sync, the conflict report. On the desktop a small indicator in the status bar
says whether sync is idle, working, live or in trouble, and clicking it opens the
panel. Mobile has no status bar, so there the panel carries that on its own.

Settings that exist for unusual setups rather than everyday use sit behind an
**Advanced** fold that starts closed, so the two or three that matter are not
buried among them.

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

## Vault sync

Syncs your notes with a server you run, encrypted on the device before they leave
it. The server code is in [`packages/server`](packages/server/README.md).

It uses the same ring code as the plugin ring, so one code covers both which
plugins you have and what your notes say. Every key is derived from it with a
separate label, and the server is only ever told the vault id and a hash of an
access token — never the key that decrypts anything. It cannot read a note, a
filename, or tell whether two vaults hold the same document.

### How it decides what to do

The reconciler compares three things, not two: what is here, what is on the
server, and what this device last agreed with the server. Comparing only the
first two can tell you that they differ but never _who_ changed, so it has to
guess — and the usual guess, "newer wins", is exactly what quietly eats a note.

With the third input the question is answerable, and the awkward cases have real
answers instead of guesses:

| Situation                            | What happens                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Only the server changed              | Pulled.                                                                                                           |
| Only this device changed             | Pushed.                                                                                                           |
| **Both changed**                     | **Both kept.** The incoming version is saved beside yours as a conflicted copy — never merged, never overwritten. |
| Deleted elsewhere, untouched here    | Moved to the **trash**, never deleted outright.                                                                   |
| Deleted elsewhere, but you edited it | Kept, and put back on the other devices. Work beats a deletion.                                                   |
| A device with no memory of syncing   | Downloads; it never reads its own emptiness as "the user deleted everything".                                     |

Before anything on this device is replaced or trashed, you get to see the list and
say yes. Uploading never asks — it cannot cost you anything.

### Setting it up

1. Run the server: see [`packages/server/README.md`](packages/server/README.md).
2. Create or join a plugin ring, if you have not already. The ring code is the key.
3. In the module's settings, enter the server address and the registration secret
   from the server, then press **Set up**. The registration secret is used once and
   cleared afterwards; it is not a login.
4. Press **Show what a sync would do** before the first real run.

The server cannot read your notes, which also means **it cannot help you if the
ring code is lost**. Keep the code somewhere safe and separate from the server.

### Live between open devices

With **Keep open devices in step** switched on, a device parks one request on the
server, which answers the moment another device commits — so a change made on the
desktop shows up on an open phone within about a second, without either of them
polling. Local edits are pushed after a two-second pause, so a burst of typing
becomes one commit instead of thirty.

**Catch up when Obsidian opens** covers the other half: a device that was closed
or in the background syncs as soon as it comes back to the front. On a phone that
is the moment you open the app.

Both only run while Obsidian is on screen, and that limit is not a choice. iOS
suspends a backgrounded app and Android vendors kill it, so "syncs while the phone
is in your pocket" is not something any plugin can deliver. Self-hosted LiveSync
reached the same conclusion and requires its own peer-to-peer mode to run in the
foreground with the screen awake.

### What it does not do yet

Sync is **file-level**, not character-level. Two devices editing the same note at
the same moment produce a conflicted copy rather than merging keystroke by
keystroke. Real collaborative editing needs a CRDT layer on top of this — a
separate and much larger piece of work, not a setting.

## Sync guardian

Watches whatever sync you already use instead of replacing it. Three things go
wrong with vault sync, and all three are invisible from inside Obsidian:

- **Conflicting copies** pile up in folders nobody opens
  (`Note (conflicted copy 2026-08-28 093612).md`, Syncthing's `.sync-conflict-…`).
- **Conflict markers written into a note** — some tools do not create a second
  file, they put both versions into the original between `<<<<<<<` and `>>>>>>>`.
  The file count never changes and the note looks completely normal in the file
  tree. This is the dangerous one.
- **A device quietly stops syncing** and nothing says so.

The report lists all of it. Every conflicting copy can be compared side by side
with the file it came from before you decide which one to keep — and the one you
drop goes to the **trash**, never straight to deletion. Notes with markers are only
opened at the right line; merging is never done for you, because a merge can
destroy text.

Devices report in through one small file each under `Toolbox/health/`. One writer
per file, so these can never conflict with each other — and because they travel
through your normal sync, a heartbeat that stops arriving _is_ the symptom.

### Two sync tools on one vault

The single most common cause of conflicts nobody caused. Obsidian's own
documentation is blunt: _"Avoid syncing the same vault across multiple services …
to prevent data conflicts or corruption."_ If a desktop sync client manages a
folder above your vault while a sync plugin runs inside Obsidian, both write the
same files and each sees the other's writes as an outside change.

The guardian detects this and says so. **Disclosure:** that check reads the names
of entries in the folders _above_ your vault, looking for markers like
`.nextcloudsync.log`, `.dropbox` or `.stfolder`. It reads directory listings only,
never file contents, runs on desktop only, and can be switched off in the module's
settings. Nothing leaves your machine — the plugin makes no network requests at all.

## Languages

The interface follows Obsidian's own language setting. English and German are
translated in full; anything else falls back to English.

**Contributing a language** is one file. Copy `src/i18n/locales/en.ts`, translate
the values, and add a line to `LOCALES` in `src/i18n/index.ts`:

```ts
// src/i18n/locales/fr.ts
import type { Translations } from './en';

export const fr: Partial<Translations> = {
	'common.enable': 'Activer',
	// ...
};
```

Type it `Partial<Translations>` and translate as much or as little as you like —
untranslated keys fall back to English, so a half-finished language still helps.
Use the locale codes from [Obsidian's translation repository][translations]. Keep
the `{placeholders}` intact; a test checks that they match the English text.

[translations]: https://github.com/obsidianmd/obsidian-translations#existing-languages

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
import { t } from '../../i18n';

type MySettings = { threshold: number };

const DEFAULT_SETTINGS: MySettings = { threshold: 5 };

class MyModule extends ToolboxModule<MySettings> {
	override onload(): void {
		this.addCommand({ id: 'do-it', name: t('mine.command'), callback: () => this.run() });
	}

	private run(): void {
		// this.settings.threshold, this.app, ...
	}
}

export const myModule: ModuleDescriptor<MySettings> = {
	id: 'my-module',
	// Getters, because the locale is only known once the plugin loads.
	get name() {
		return t('mine.name');
	},
	get description() {
		return t('mine.description');
	},
	defaultSettings: DEFAULT_SETTINGS,
	create: (plugin: ToolboxPlugin) => new MyModule(plugin, myModule),
};
```

Settings, the enable toggle and the settings section come for free. Text the user
sees goes through `t()` — add the keys to `src/i18n/locales/en.ts` and `de.ts`.

### The one rule

**Register everything through `this.*`, never through `this.plugin.*`.**

A module is an Obsidian `Component`, and `this.register()`, `this.registerEvent()`,
`this.registerDomEvent()`, `this.registerInterval()`, `this.addCommand()` and
`this.addRibbonIcon()` all undo themselves when the module is switched off.
The same calls made on `this.plugin` survive until the whole plugin unloads, which
means a switched-off module would leave its commands and listeners behind.

Two things need care:

- **Views.** `Plugin.registerView()` cannot be undone and throws on a second
  registration, so a module that can be switched off and on again must register the
  view type at most once and let it outlive the module, owning only its commands
  and open leaves.
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
    obsidian-internals.ts  the one file that touches Obsidian's internal API
  modules/
    index.ts               the module list — the only file a new feature touches
    plugin-ring/           keeps plugins in step across devices
    vault-sync/            syncs notes with your own server, encrypted
    sync-health/           finds sync conflicts, watches device heartbeats
  i18n/
    index.ts               t() and locale selection
    locales/               en.ts is the base, one file per language
  test/
    obsidian.stub.ts       stand-in for the `obsidian` module
    fake-app.ts            in-memory plugin manager for tests
    fake-vault.ts          in-memory vault for tests
packages/
  protocol/                wire format and cryptography, shared with the server
  server/                  the sync server you run yourself
```

In both modules the files without an Obsidian import — `code.ts`, `crypto.ts`,
`diff.ts`, `patterns.ts`, `health.ts` — hold the logic worth testing, and that is
where the tests are.

## Before a public release

- Decide on the final `id` and `name` in `manifest.json` (the `id` is permanent) and
  update `name` in `package.json` to match.
- Set `author` and optionally `authorUrl` / `fundingUrl` in `manifest.json`.
- Check `minAppVersion` against the newest API you actually use. It is currently
  `1.8.7`, set by `getLanguage()`.

## License

[MIT](LICENSE)
