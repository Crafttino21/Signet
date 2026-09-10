/**
 * English is the base locale: it defines every key, and every other locale is
 * checked against it. Anything missing elsewhere falls back to the text here, so
 * a partial translation is fine and a stale one is never a blank label.
 *
 * Keys are flat and dotted rather than nested — it keeps the type simple, makes a
 * missing key a compile error, and makes the file easy to diff when translating.
 *
 * Placeholders are `{name}` and are filled in by `t()`. Counts get separate keys
 * for one and many rather than a plural engine, because languages disagree about
 * how many forms they need and a wrong guess reads worse than a spelled-out key.
 */
export const en = {
	'common.enable': 'Enable',
	'common.cancel': 'Cancel',
	'common.copy': 'Copy',

	'module.loadFailed': 'Toolbox: "{name}" failed to load and was switched off.',

	'ring.name': 'Plugin ring',
	'ring.description':
		'Keeps the plugins and their settings in step across your devices. One device hosts, the others follow after showing you what would change.',

	'ring.command.create': 'Create a plugin ring',
	'ring.command.join': 'Join a plugin ring',
	'ring.command.showCode': 'Show the ring code',
	'ring.command.publish': 'Publish plugins to the ring',
	'ring.command.check': 'Check the ring for changes',
	'ring.command.leave': 'Leave the plugin ring',

	'ring.unsupported.notice':
		'Toolbox: the plugin ring is not supported by this Obsidian version.',
	'ring.unsupported.settings':
		'This Obsidian version does not expose the plugin manager this feature needs.',

	'ring.settings.status': 'Status',
	'ring.settings.statusNone':
		'Not in a ring. Create one here, or join with a code from another device.',
	'ring.settings.statusHost': 'Host of this ring. Published up to change {seq}.',
	'ring.settings.statusClient': 'Following the ring. Applied up to change {seq}.',
	'ring.settings.startOrJoin': 'Start or join',
	'ring.settings.createRing': 'Create ring',
	'ring.settings.joinWithCode': 'Join with a code',
	'ring.settings.ring': 'Ring',
	'ring.settings.showCode': 'Show code',
	'ring.settings.publishNow': 'Publish now',
	'ring.settings.checkNow': 'Check for changes',
	'ring.settings.leave': 'Leave',
	'ring.settings.device': 'This device',
	'ring.settings.deviceDesc': 'Shown to the other devices in the ring.',
	'ring.settings.file': 'Ring file',
	'ring.settings.fileDesc': 'An ordinary vault file, so that it travels with your normal sync.',
	'ring.settings.excluded': "Do not share these plugins' settings",
	'ring.settings.excludedDesc':
		'Plugin ids, separated by spaces. Their settings stay on this device when publishing.',
	'ring.settings.ignored': 'Ignore these plugins on this device',
	'ring.settings.ignoredDesc':
		'Plugin ids, separated by spaces. They never show up in a diff here.',
	'ring.settings.codeWarning':
		'Anyone with the ring code can publish to this ring. Treat it like a password.',

	'ring.notice.alreadyInRing': 'This device is already in a ring. Leave it first.',
	'ring.notice.notInRing': 'This device is not in a ring yet.',
	'ring.notice.notHost': 'Only the host publishes to the ring.',
	'ring.notice.invalidCode': 'That is not a ring code. Check that you copied all of it.',
	'ring.notice.noRingFileYet':
		'No ring file at "{path}" yet. Publish on the host device, then let this device finish syncing.',
	'ring.notice.noRingFile': 'There is no ring file at "{path}" in this vault.',
	'ring.notice.publishFailed': 'Could not write the ring file "{path}": {message}',
	'ring.notice.foreignFileHost':
		'The file at "{path}" belongs to a different ring. Press publish to move it aside and write this ring instead.',
	'ring.notice.codeMismatch': 'That code does not match the ring in this vault.',
	'ring.notice.wrongRing': 'This snapshot does not belong to your ring, or it was altered.',
	'ring.notice.joined': 'Joined the ring hosted by "{host}".',
	'ring.notice.joinedWithServer':
		'Joined. The code carried the server address, so this device is contacting it now.',
	'ring.notice.joinedWaiting':
		'Code accepted. Waiting for the host\'s snapshot to arrive at "{path}" — this device will say so once it does.',
	'ring.notice.createCancelled': 'No ring was created. Nothing on this device changed.',
	'ring.notice.removedFromRing':
		'"{host}" removed this device from the ring. Nothing installed here was changed.',
	'ring.notice.becameHost': 'This device is now the host of the ring.',
	'ring.notice.handedOver':
		'The ring now belongs to "{name}". This device follows it from now on.',
	'ring.notice.left': 'Left the ring. Nothing installed was changed.',
	'ring.notice.raced':
		'The ring was changed by "{host}" since this device last published. Nothing was overwritten.',
	'ring.notice.published': 'Published {count} plugins to the ring.',
	'ring.notice.unknownFormat': 'The ring snapshot is not in a format this version understands.',
	'ring.notice.unreadable': 'The ring snapshot could not be read.',
	'ring.notice.retryLater': '{message} Try again in a moment.',
	'ring.notice.hasChanges': 'Toolbox: the plugin ring has changes on another device.',
	'ring.notice.conflictCopies':
		'Toolbox: found {count} conflicting copies of the ring file. Two devices may both be publishing.',
	'ring.notice.codeCopied': 'Ring code copied.',
	'ring.notice.codeCopyFailed': 'Could not copy the code — select it by hand.',
	'ring.notice.newerCode':
		'That code was made by a newer version of Toolbox. Update the plugin on this device first.',
	'ring.notice.replacedRingFile': 'Moved the old ring file at "{path}" to the trash.',
	'ring.notice.ringFileBusy':
		'Obsidian has not indexed the file at "{path}" yet, so it cannot be moved safely. Try again in a moment.',

	'ring.conflict.title': 'There is already a ring file here',
	'ring.conflict.foreign':
		'The file at "{path}" belongs to a different ring. This device cannot read it, and cannot publish over it either.',
	'ring.conflict.corrupt':
		'The file at "{path}" belongs to this ring but will not open. It may have been damaged.',
	'ring.conflict.trashHint':
		'Replacing it moves it to the trash, so it can be recovered. Everything the other ring holds stays where it is — this only frees the path.',
	'ring.conflict.keep': 'Leave it alone',
	'ring.conflict.replace': 'Move it to the trash',

	'ring.file.notJson': 'The ring file is not valid JSON right now.',
	'ring.file.notSnapshot': 'The ring file does not look like a ring snapshot.',

	'ring.device.unknownTime': 'unreadable timestamp',
	'ring.device.now': 'here now',
	'ring.device.minutes': 'seen {count} min ago',
	'ring.device.hours': 'seen {count} h ago',
	'ring.device.days': 'seen {count} days ago',
	'ring.device.mobile': 'Mobile device',
	'ring.device.desktop': 'Desktop',

	'ring.join.title': 'Join a plugin ring',
	'ring.join.hint':
		'Enter the code shown on the device that hosts the ring. Nothing is changed until you have seen what would happen.',
	'ring.join.label': 'Ring code',
	'ring.join.placeholder': 'Paste your ring code',
	'ring.join.submit': 'Join',

	'ring.remove.title': 'Remove "{name}" from the ring?',
	'ring.remove.body':
		'It disappears from this list, and the next time it syncs it leaves the ring on its own. That is a message rather than a lock: the ring code is the key, so a device that still has the code can go on reading the ring. To actually take access away, create a new ring and hand the new code only to the devices that should keep it.',
	'ring.handOver.title': 'Hand the ring to "{name}"?',
	'ring.handOver.body':
		'"{name}" becomes the host and is the one that publishes from then on; this device follows the ring like any other. It takes effect the next time that device syncs. You can hand it back the same way.',
	'ring.code.title': 'Your ring code',
	'ring.code.noServerYet':
		'This code carries no server address, because none is set up yet. Set the sync server up first, then show the code again — every device that joins with it then needs nothing else. A device that already joined with this code has to be told the address by hand.',
	'ring.code.addressNotInCode':
		'The address {url} does not fit into a code. A code carries a plain address like http://192.168.1.10:8787 — not one with a path, a query, or an IPv6 host. Every device joining with this code has to be given the address by hand, under Advanced in its sync settings.',
	'ring.code.parts':
		'The first four groups are the ring itself and never change. The greyed tail is the server address, which appeared when the server was connected — so a shorter code written down before then is not out of date: it still joins this ring, and the device that uses it is asked for the address instead.',
	'ring.code.includeServer': 'Include the server address',
	'ring.code.includeServerDesc':
		'Switch off if the other device reaches the server at a different address — over a VPN, or by a name this network does not know.',
	'ring.code.hintWithServer':
		'Enter this code on another device to take it into the ring. It carries the address of the sync server, so there is nothing else to type there. Anyone holding it can read the ring and publish to it — treat it like a password.',
	'ring.code.hint':
		'Enter this on another device to add it to the ring. Anyone who has it can read and publish to the ring, so treat it like a password.',

	'ring.diff.title': 'Ring update from "{host}"',
	'ring.diff.hostChanged':
		'This snapshot was published by a different device than before. If you did not hand the host role over yourself, do not apply it.',
	'ring.diff.upToDate': 'This device already matches the host.',
	'ring.diff.willApply': 'Will be applied',
	'ring.diff.leftAlone': 'Left alone',
	'ring.diff.nothingToApply': 'Nothing to apply',
	'ring.diff.applyOne': 'Apply 1 change',
	'ring.diff.applyMany': 'Apply {count} changes',

	'ring.kind.missing': 'Not installed here',
	'ring.kind.enable': 'Switch on',
	'ring.kind.disable': 'Switch off',
	'ring.kind.version': 'Different version',
	'ring.kind.settings': 'Settings differ',
	'ring.kind.extra': 'Only on this device',

	'ring.reason.desktopOnly': 'Desktop only, cannot run on this device',
	'ring.reason.notInstalled': 'Not installed yet — installing is not supported yet',
	'ring.reason.noUpdate': 'Updating is not supported yet',
	'ring.reason.hostLacks': 'The host does not have this one — left untouched',

	'ring.result.appliedOne': 'Applied 1 change.',
	'ring.result.appliedMany': 'Applied {count} changes.',
	'ring.result.partial': 'Applied {applied} of {total}. Failed: {names}.',

	'vaultSync.name': 'Vault sync',
	'vaultSync.description':
		'Syncs your notes with your own server, encrypted on this device before they leave it. Uses the same ring code as the plugin ring.',

	'vaultSync.ribbon': 'Sync vault',
	'vaultSync.command.sync': 'Sync the vault now',
	'vaultSync.command.preview': 'Show what a sync would do',
	'vaultSync.command.forget': 'Forget what this device last synced',

	'vaultSync.settings.needsRing':
		'Create or join a plugin ring first. The ring code is what encrypts your notes and identifies your vault to the server.',
	'vaultSync.connect.title': 'Connect your sync server',
	'vaultSync.connect.hint':
		'The ring code is about to be created, and it carries this address to every other device. Setting the server up first is what makes joining a one-step affair everywhere else.',
	'vaultSync.connect.serverDesc':
		'On a home network something like http://192.168.1.10:8787. The port matters: without one it means port 80, where nothing is listening.',
	'vaultSync.connect.secretDesc':
		'From the server, needed once to create the vault. It never leaves this device and is not stored.',
	'vaultSync.connect.connect': 'Connect',
	'vaultSync.connect.working': 'Connecting…',
	'vaultSync.connect.without': 'Without a server',
	'vaultSync.connect.withoutHint':
		'Without a server the ring still keeps plugins in step across your devices. You can connect one later, but the codes handed out before then will not carry the address.',
	'vaultSync.settings.status': 'Status',
	'vaultSync.settings.statusReady': 'Set up. This device can sync.',
	'vaultSync.settings.statusNotSetUp': 'Not set up yet on this server.',
	'vaultSync.settings.server': 'Server address',
	'vaultSync.settings.serverDesc':
		'Normally comes from the ring and needs no attention. Change it only if this device reaches the server at a different address.',
	'vaultSync.settings.strandedClient':
		'Nothing is on its way. This device joined with a code from before the server was set up, so it was never told where the server is.',
	'vaultSync.settings.strandedServerDesc':
		'Two ways out, and either is fine: get a fresh code from the host — it carries the address now — and join again with it, or type the address here.',
	'vaultSync.settings.connect': 'Connect a server',
	'vaultSync.settings.connectDesc':
		'Only on this device, and only once. Every other device in the ring gets the address from here. On a home network that is an address like http://192.168.1.10:8787; use https as soon as the server is reachable from outside, because the notes are encrypted but the access token is not.',
	'vaultSync.settings.fromRing': 'Comes from the ring',
	'vaultSync.settings.fromRingWaiting':
		'Server: {url}. Nothing to enter here — waiting for the host to create the vault there.',
	'vaultSync.settings.registration': 'Registration secret',
	'vaultSync.settings.registrationDesc':
		'From the server, needed once to create the vault. It is cleared straight afterwards and never leaves this device.',
	'vaultSync.settings.setUp': 'Set up',
	'vaultSync.settings.moreAfterSetup':
		'The rest of the settings appear once the server has answered for this vault.',
	'vaultSync.settings.conflicts':
		'{count} conflicted copies in this vault. Both versions of a note were kept, and neither has been looked at since.',
	'vaultSync.settings.confirm': 'Ask before changing files here',
	'vaultSync.settings.confirmDesc':
		'Shows what would arrive, be replaced or be trashed on this device, and waits. Uploading never asks.',
	'vaultSync.settings.announce': 'Report every automatic sync',
	'vaultSync.settings.announceDesc':
		'A notice each time a sync nobody asked for moves something. Off, because with live sync on that is a notice every few seconds. What a run did is always in the panel and in the note header, and anything that fails speaks up either way.',
	'vaultSync.settings.interval': 'Sync automatically every',
	'vaultSync.settings.intervalDesc': 'Minutes. 0 switches it off. Takes effect after a restart.',
	'vaultSync.settings.excluded': 'Do not sync these folders',
	'vaultSync.settings.excludedDesc':
		'One path per line. The Obsidian config folder is always left out.',
	'vaultSync.settings.actions': 'Run',
	'vaultSync.settings.test': 'Test connection',
	'vaultSync.settings.codeWarning':
		'The server cannot read any of this, which also means it cannot help you if the ring code is lost. Keep the code somewhere safe and separate.',

	'vaultSync.plan.title': 'What this sync would do',
	'vaultSync.plan.firstRun':
		'This device has not synced before, so anything that differs is treated as a conflict rather than guessed at.',
	'vaultSync.plan.hereChanges': 'Changes on this device',
	'vaultSync.plan.serverChanges': 'Changes on the server',
	'vaultSync.plan.conflictNote':
		'Where both sides changed, nothing is overwritten: the incoming version is saved next to yours as a conflicted copy.',
	'vaultSync.plan.confirm': 'Sync now',

	'vaultSync.action.upload': 'send to the server',
	'vaultSync.action.download': 'arrives here',
	'vaultSync.action.deleteLocal': 'moved to the trash here',
	'vaultSync.action.deleteRemote': 'removed on the server',
	'vaultSync.action.conflict': 'both changed, both kept',
	'vaultSync.action.resurrect': 'deleted elsewhere, kept because you edited it',

	'vaultSync.result.upToDate': 'Everything is already in sync.',
	'vaultSync.result.uploaded': '{count} sent',
	'vaultSync.result.downloaded': '{count} received',
	'vaultSync.result.trashed': '{count} moved to the trash',
	'vaultSync.result.conflicts': '{count} kept as conflicted copies',
	'vaultSync.result.partial':
		'{done} synced, {failed} failed. Nothing was lost, and the rest is tried again next time.',

	'vaultSync.notice.needsRing': 'Create or join a plugin ring first.',
	'vaultSync.notice.addressPublished':
		'{url} answers for this vault, so it has been published to the ring. Every device that took its address from the ring moves to it at its next sync.',
	'vaultSync.notice.portAdded':
		'No port given, so the usual one was added: {url}. Change it under Advanced if your server listens elsewhere.',
	'vaultSync.notice.unreachable':
		'Toolbox: {url} could not be reached. {message} Check the address including the port — the server listens on 8787 unless you changed it.',
	'vaultSync.notice.foundOnDefaultPort':
		'A sync server does answer at {url} — that is almost certainly the address you want.',
	'vaultSync.notice.badServerUrl':
		'That is not a complete address. It needs to start with http:// or https://, for example http://192.168.1.10:8787.',
	'vaultSync.notice.needsServer': 'Enter the server address first.',
	'vaultSync.notice.serverFromRing': 'Sync server taken from the ring: {url}',
	'vaultSync.notice.readyFromRing':
		'This device is set up for sync. The ring code was all it needed.',
	'vaultSync.notice.notOnServerYet':
		'The server does not know this ring yet. Set it up on the host device first.',
	'vaultSync.notice.needsRegistrationSecret':
		'Enter the registration secret from your server first.',
	'vaultSync.notice.notSetUp': 'Set this vault up on the server first.',
	'vaultSync.notice.reachable': 'Server reached. Protocol version {protocol}.',
	'vaultSync.notice.created': 'Vault created on the server.',
	'vaultSync.notice.joined':
		'This vault already existed on the server, and this device has joined it.',
	'vaultSync.notice.forgotten':
		'Forgotten. The next sync treats every difference as a conflict and keeps both sides.',
	'vaultSync.notice.failed': 'Sync failed:',
	'vaultSync.settings.live': 'Keep open devices in step',
	'vaultSync.settings.liveDesc':
		'Holds one request open on the server, so a change made on another open device arrives within a second. Runs only while Obsidian is on screen, and applies what arrives without asking — conflicts still keep both versions and deletions still go to the trash.',
	'vaultSync.settings.syncOnStart': 'Catch up when Obsidian opens',
	'vaultSync.settings.syncOnStartDesc':
		'Also runs when the app comes back to the front, which is how a phone picks up what it missed.',
	'vaultSync.notice.restartNeeded': 'Takes effect after the module is switched off and on again.',

	'common.advanced': 'Advanced',

	'panel.title': 'Toolbox',
	'panel.open': 'Open the Toolbox panel',
	'panel.available': 'Ready to switch on in the settings: {names}.',
	'panel.version': 'Toolbox {version}',
	'panel.nothing': 'No modules are switched on. Turn one on in the settings.',

	'ring.panel.title': 'Plugin ring',
	'ring.panel.none': 'Not in a ring yet.',
	'ring.panel.host': 'Host · published up to {seq}',
	'ring.panel.client': 'Following · applied up to {seq}',
	'ring.panel.waitingForHost': "Waiting for the host's snapshot to sync to this device.",
	'ring.panel.noFileHost':
		'No ring file at "{path}". Publish, so the other devices have something to join.',
	'ring.panel.foreignFile':
		'The file at "{path}" belongs to a different ring. Publishing will offer to move it aside.',
	'ring.panel.corruptFile': 'The ring file at "{path}" will not open. It may be damaged.',
	'ring.panel.devices': 'Devices',
	'ring.panel.noDevices': 'No device has written itself into the ring yet.',
	'ring.panel.thisDevice': 'this device',
	'ring.panel.isHost': 'host',
	'ring.panel.makeHost': 'Make host',
	'ring.panel.remove': 'Remove',
	'ring.panel.nothingPublished':
		'Nothing published yet — the other devices have no ring file to join. Press "Publish now".',

	'vaultSync.panel.title': 'Vault sync',
	'vaultSync.panel.waitingForRing': 'Setting itself up from the ring — nothing to do here.',
	'vaultSync.panel.strandedClient':
		'No server address. Join again with a fresh code, or enter the address in the settings.',
	'vaultSync.panel.notSetUp': 'Not set up yet.',
	'vaultSync.panel.ready': 'Ready · commit {seq}',
	'vaultSync.panel.live': 'Live',
	'vaultSync.panel.liveOff': 'Manual',
	'vaultSync.panel.serverFromRing': 'Server: {url} · from the ring',
	'vaultSync.panel.serverManual': 'Server: {url} · set on this device',
	'vaultSync.panel.conflicts':
		'{count} conflicted copies in this vault. Both versions of a note were kept, and neither has been looked at.',
	'vaultSync.panel.never': 'Not synced yet on this device.',
	'vaultSync.panel.lastRun': 'Last run: {summary}',

	'vaultSync.status.idle': 'Sync: idle',
	'vaultSync.status.syncing': 'Sync: working',
	'vaultSync.status.live': 'Sync: live',
	'vaultSync.status.error': 'Sync: problem',
	'vaultSync.status.off': 'Sync: off',
	'vaultSync.indicator.liveNote': 'This note is being edited together right now',
	'vaultSync.status.tooltip': 'Toolbox vault sync — click to open the panel',

	'ring.reason.cannotInstall': 'Installing is not possible on this device',
	'ring.kind.install': 'Install',
	'ring.settings.install': 'Install missing plugins',
	'ring.settings.installDesc':
		'Fetches plugins the host has and this device does not. Only plugins listed in Obsidian’s own community directory are installed — an id in a snapshot is never enough on its own.',
	'ring.settings.installUnsupported':
		'This Obsidian version does not expose the plugin installer, so missing plugins can only be listed.',
	'ring.result.installed': 'Installed {count}.',
	'setup.title': 'Set up Toolbox',
	'setup.command': 'Set up Toolbox',
	'setup.nothing': 'Nothing needs setting up. Switch a module on first.',
	'setup.allDone': 'Everything is set up. You can close this.',
	'setup.finish': 'Done',

	'panel.setupNeeded': '{count} step(s) left before this works.',

	'ring.setup.title': 'Create or join a ring',
	'ring.setup.hint':
		'The ring code is the key to everything else: it encrypts your notes and identifies your vault. Create one on your first device, then join with that code on the others.',

	'vaultSync.setup.title': 'Connect to your server',
	'vaultSync.setup.hint':
		'The address of the sync server you run, and the registration secret from its configuration. The secret is used once and then forgotten.',
	'vaultSync.setup.waitingForHost':
		'Nothing to do here. The host publishes the server address to the ring, and this device sets itself up when it arrives.',
	'vaultSync.setup.waitingForServer':
		'Server from the ring: {url}. Waiting for the host to create the vault there.',
	'vaultSync.setup.checkAgain': 'Check now',
	'vaultSync.setup.connect': 'Connect',
	'collab.name': 'Live editing',
	'collab.description':
		'Lets two devices edit the same note at once and merges the keystrokes, instead of keeping two versions. Uses the same ring and server as the sync.',
	'collab.panel.title': 'Live editing',
	'collab.panel.needsSync': 'Needs a ring and a connected server first.',
	'collab.panel.idle': 'No note is open for live editing.',
	'collab.panel.alone': 'connected, nobody else here',
	'collab.panel.peers': 'connected · {count} other device(s)',
	'collab.panel.offline': 'not connected',
	'collab.settings.enabled': 'Edit notes together',
	'collab.settings.enabledDesc':
		'While a note is open it is kept in step keystroke by keystroke with anyone else who has it open. That note is left out of the ordinary file sync until it is closed, so the two cannot write over each other.',
	'collab.settings.excluded': 'Never edit these folders together',
	'collab.settings.excludedDesc': 'One path per line.',
	'collab.notice.failed': 'Toolbox: could not start live editing for this note.',
};

export type TranslationKey = keyof typeof en;

/** A complete locale. Contributed languages use `Partial<Translations>`. */
export type Translations = Record<TranslationKey, string>;
