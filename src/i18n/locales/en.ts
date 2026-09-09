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
	'ring.notice.codeMismatch': 'That code does not match the ring in this vault.',
	'ring.notice.wrongRing': 'This snapshot does not belong to your ring, or it was altered.',
	'ring.notice.joined': 'Joined the ring hosted by "{host}".',
	'ring.notice.joinedWaiting':
		'Code accepted. Waiting for the host\'s snapshot to arrive at "{path}" — this device will say so once it does.',
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

	'ring.file.notJson': 'The ring file is not valid JSON right now.',
	'ring.file.notSnapshot': 'The ring file does not look like a ring snapshot.',

	'ring.device.mobile': 'Mobile device',
	'ring.device.desktop': 'Desktop',

	'ring.join.title': 'Join a plugin ring',
	'ring.join.hint':
		'Enter the code shown on the device that hosts the ring. Nothing is changed until you have seen what would happen.',
	'ring.join.label': 'Ring code',
	'ring.join.placeholder': 'Paste your ring code',
	'ring.join.submit': 'Join',

	'ring.code.title': 'Your ring code',
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

	'sync.name': 'Sync guardian',
	'sync.description':
		'Watches the sync you already use: finds conflicting copies and notes with conflict markers, and tells you when a device has stopped syncing.',

	'sync.command.report': 'Show the sync report',
	'sync.command.deepScan': 'Search every note for conflict markers',
	'sync.ribbon': 'Sync report',

	'sync.notice.clean': 'No sync conflicts found.',
	'sync.notice.foundOne': 'Toolbox: found 1 sync conflict.',
	'sync.notice.foundMany': 'Toolbox: found {count} sync conflicts.',
	'sync.notice.scanning': 'Reading every note, this may take a moment…',
	'sync.notice.trashed': 'Moved "{name}" to the trash. Nothing was deleted outright.',
	'sync.notice.trashFailed': 'Could not move "{name}" to the trash: {error}',
	'sync.notice.doubleSync': 'Toolbox: two sync engines are managing this vault.',

	'sync.report.title': 'Sync report',
	'sync.report.copies': 'Conflicting copies',
	'sync.report.markers': 'Notes with conflict markers',
	'sync.report.devices': 'Devices',
	'sync.report.clean': 'Nothing looks wrong. No conflicting copies and no conflict markers.',
	'sync.report.deepHint':
		'Only notes tagged #conflict were read. Use "Search every note for conflict markers" for a thorough pass.',
	'sync.report.originalMissing': 'The original is gone — only this copy is left',
	'sync.report.markerOne': '1 conflict block',
	'sync.report.markerMany': '{count} conflict blocks',
	'sync.report.markerLines': 'from line {line}',
	'sync.report.compare': 'Compare',
	'sync.report.open': 'Open',
	'sync.report.noDevices': 'No other device has reported in yet.',

	'sync.device.self': 'this device',
	'sync.device.justNow': 'seen just now',
	'sync.device.hours': 'seen {hours} h ago',
	'sync.device.days': 'seen {days} days ago',
	'sync.device.unknown': 'its timestamp is unreadable',

	'sync.compare.title': 'Conflicting copy of "{name}"',
	'sync.compare.original': 'Original',
	'sync.compare.copy': 'Conflicting copy',
	'sync.compare.identical': 'Both files have exactly the same content, so the copy is redundant.',
	'sync.compare.hint':
		'Whichever you keep, the other one goes to the trash and can be brought back.',
	'sync.compare.keepOriginal': 'Keep the original',
	'sync.compare.keepCopy': 'Keep this copy',
	'sync.compare.openBoth': 'Open both',

	'sync.double.title': 'Two sync engines on the same files',
	'sync.double.body':
		"{tool} syncs a folder above your vault, and {plugins} runs inside Obsidian. Both write the same files, and each sees the other's writes as an outside change — the usual cause of conflicting copies that nobody made.",
	'sync.double.advice':
		'Obsidian recommends one sync service per vault. Use the desktop client on this computer and switch the plugin off here, or the other way round.',
	'sync.double.folder': 'Found in: {folder}',
	'sync.double.dismiss': 'Do not warn again',

	'sync.settings.checkOnStart': 'Check when Obsidian starts',
	'sync.settings.checkOnStartDesc':
		'Report conflicts once after loading, without opening anything.',
	'sync.settings.staleAfter': 'Treat a device as stale after',
	'sync.settings.staleAfterDesc': 'Hours without a sign of life. Set to 0 to never warn.',
	'sync.settings.heartbeatFolder': 'Heartbeat folder',
	'sync.settings.heartbeatFolderDesc':
		'Each device writes one small file here. One writer per file, so these can never conflict themselves.',
	'sync.settings.excluded': 'Skip these folders',
	'sync.settings.excludedDesc': 'One path per line. Useful for archives full of old copies.',
	'sync.settings.doubleSyncCheck': 'Warn about a second sync tool',
	'sync.settings.doubleSyncCheckDesc':
		'Looks at the folders above your vault for another sync client. Desktop only, and it reads folder names only.',
	'vaultSync.name': 'Vault sync',
	'vaultSync.description':
		'Syncs your notes with your own server, encrypted on this device before they leave it. Uses the same ring code as the plugin ring.',

	'vaultSync.ribbon': 'Sync vault',
	'vaultSync.command.sync': 'Sync the vault now',
	'vaultSync.command.preview': 'Show what a sync would do',
	'vaultSync.command.forget': 'Forget what this device last synced',

	'vaultSync.settings.needsRing':
		'Create or join a plugin ring first. The ring code is what encrypts your notes and identifies your vault to the server.',
	'vaultSync.settings.status': 'Status',
	'vaultSync.settings.statusReady': 'Set up. This device can sync.',
	'vaultSync.settings.statusNotSetUp': 'Not set up yet on this server.',
	'vaultSync.settings.server': 'Server address',
	'vaultSync.settings.serverDesc':
		'Normally comes from the ring and needs no attention. Change it only if this device reaches the server at a different address.',
	'vaultSync.settings.connect': 'Connect a server',
	'vaultSync.settings.connectDesc':
		'Only on this device, and only once. Every other device in the ring gets the address from here. On a home network that is an address like http://192.168.1.10:8787; use https as soon as the server is reachable from outside, because the notes are encrypted but the access token is not.',
	'vaultSync.settings.fromRing': 'Comes from the ring',
	'vaultSync.settings.fromRingWaiting':
		'Server: {url}. Nothing to enter here — waiting for the host to create the vault there.',
	'vaultSync.settings.fromRingNoServer':
		'Nothing to enter here. The host publishes the server address to the ring, and this device sets itself up when it arrives.',
	'vaultSync.settings.registration': 'Registration secret',
	'vaultSync.settings.registrationDesc':
		'From the server, needed once to create the vault. It is cleared straight afterwards and never leaves this device.',
	'vaultSync.settings.setUp': 'Set up',
	'vaultSync.settings.confirm': 'Ask before changing files here',
	'vaultSync.settings.confirmDesc':
		'Shows what would arrive, be replaced or be trashed on this device, and waits. Uploading never asks.',
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
	'panel.nothing': 'No modules are switched on. Turn one on in the settings.',

	'ring.panel.title': 'Plugin ring',
	'ring.panel.none': 'Not in a ring yet.',
	'ring.panel.host': 'Host · published up to {seq}',
	'ring.panel.client': 'Following · applied up to {seq}',
	'ring.panel.waitingForHost': 'Waiting for the host\'s snapshot to sync to this device.',
	'ring.panel.nothingPublished':
		'Nothing published yet — the other devices have no ring file to join. Press "Publish now".',

	'vaultSync.panel.title': 'Vault sync',
	'vaultSync.panel.waitingForRing': 'Setting itself up from the ring — nothing to do here.',
	'vaultSync.panel.notSetUp': 'Not set up yet.',
	'vaultSync.panel.ready': 'Ready · commit {seq}',
	'vaultSync.panel.live': 'Live',
	'vaultSync.panel.liveOff': 'Manual',
	'vaultSync.panel.never': 'Not synced yet on this device.',
	'vaultSync.panel.lastRun': 'Last run: {summary}',

	'vaultSync.status.idle': 'Sync: idle',
	'vaultSync.status.syncing': 'Sync: working',
	'vaultSync.status.live': 'Sync: live',
	'vaultSync.status.error': 'Sync: problem',
	'vaultSync.status.off': 'Sync: off',
	'vaultSync.status.tooltip': 'Toolbox vault sync — click to open the panel',

	'sync.panel.title': 'Sync health',
	'sync.panel.clean': 'No conflicts found.',
	'sync.panel.conflicts': '{count} conflicts found.',
	'sync.panel.unchecked': 'Not checked yet.',
	'sync.panel.check': 'Check now',
	'sync.panel.report': 'Open report',
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
