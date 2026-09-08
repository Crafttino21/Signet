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
		'No ring file found in this vault yet. Publish from the host device first.',
	'ring.notice.noRingFile': 'There is no ring file in this vault.',
	'ring.notice.codeMismatch': 'That code does not match the ring in this vault.',
	'ring.notice.wrongRing': 'This snapshot does not belong to your ring, or it was altered.',
	'ring.notice.joined': 'Joined the ring hosted by "{host}".',
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
};

export type TranslationKey = keyof typeof en;

/** A complete locale. Contributed languages use `Partial<Translations>`. */
export type Translations = Record<TranslationKey, string>;
