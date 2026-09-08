import type { Translations } from './en';

/**
 * German. Typed as a complete `Translations` on purpose: adding a key to `en.ts`
 * breaks this file until it is translated too, which is what keeps the two in step.
 */
export const de: Translations = {
	'common.enable': 'Aktiviert',
	'common.cancel': 'Abbrechen',
	'common.copy': 'Kopieren',

	'module.loadFailed': 'Toolbox: „{name}“ konnte nicht geladen werden und wurde abgeschaltet.',

	'ring.name': 'Plugin-Ring',
	'ring.description':
		'Hält Plugins und ihre Einstellungen auf allen Geräten gleich. Ein Gerät ist der Host, die anderen ziehen nach — nachdem sie zeigen, was sich ändern würde.',

	'ring.command.create': 'Plugin-Ring erstellen',
	'ring.command.join': 'Plugin-Ring beitreten',
	'ring.command.showCode': 'Ring-Code anzeigen',
	'ring.command.publish': 'Plugins im Ring veröffentlichen',
	'ring.command.check': 'Ring auf Änderungen prüfen',
	'ring.command.leave': 'Plugin-Ring verlassen',

	'ring.unsupported.notice':
		'Toolbox: Der Plugin-Ring wird von dieser Obsidian-Version nicht unterstützt.',
	'ring.unsupported.settings':
		'Diese Obsidian-Version stellt die Plugin-Verwaltung nicht bereit, die diese Funktion braucht.',

	'ring.settings.status': 'Status',
	'ring.settings.statusNone':
		'In keinem Ring. Hier einen erstellen oder mit einem Code von einem anderen Gerät beitreten.',
	'ring.settings.statusHost': 'Host dieses Rings. Veröffentlicht bis Änderung {seq}.',
	'ring.settings.statusClient': 'Folgt dem Ring. Angewendet bis Änderung {seq}.',
	'ring.settings.startOrJoin': 'Erstellen oder beitreten',
	'ring.settings.createRing': 'Ring erstellen',
	'ring.settings.joinWithCode': 'Mit Code beitreten',
	'ring.settings.ring': 'Ring',
	'ring.settings.showCode': 'Code anzeigen',
	'ring.settings.publishNow': 'Jetzt veröffentlichen',
	'ring.settings.checkNow': 'Auf Änderungen prüfen',
	'ring.settings.leave': 'Verlassen',
	'ring.settings.device': 'Dieses Gerät',
	'ring.settings.deviceDesc': 'Wird den anderen Geräten im Ring angezeigt.',
	'ring.settings.file': 'Ring-Datei',
	'ring.settings.fileDesc':
		'Eine ganz normale Vault-Datei, damit sie mit der vorhandenen Synchronisierung mitkommt.',
	'ring.settings.excluded': 'Einstellungen dieser Plugins nicht teilen',
	'ring.settings.excludedDesc':
		'Plugin-IDs, durch Leerzeichen getrennt. Ihre Einstellungen bleiben beim Veröffentlichen auf diesem Gerät.',
	'ring.settings.ignored': 'Diese Plugins auf diesem Gerät ignorieren',
	'ring.settings.ignoredDesc':
		'Plugin-IDs, durch Leerzeichen getrennt. Sie tauchen hier in keinem Vergleich auf.',
	'ring.settings.codeWarning':
		'Wer den Ring-Code hat, kann in diesem Ring veröffentlichen. Behandle ihn wie ein Passwort.',

	'ring.notice.alreadyInRing': 'Dieses Gerät ist bereits in einem Ring. Erst verlassen.',
	'ring.notice.notInRing': 'Dieses Gerät ist noch in keinem Ring.',
	'ring.notice.notHost': 'Nur der Host veröffentlicht im Ring.',
	'ring.notice.invalidCode': 'Das ist kein Ring-Code. Prüfe, ob du ihn vollständig kopiert hast.',
	'ring.notice.noRingFileYet':
		'In diesem Vault gibt es noch keine Ring-Datei. Zuerst auf dem Host-Gerät veröffentlichen.',
	'ring.notice.noRingFile': 'In diesem Vault gibt es keine Ring-Datei.',
	'ring.notice.codeMismatch': 'Dieser Code gehört nicht zum Ring in diesem Vault.',
	'ring.notice.wrongRing':
		'Dieser Snapshot gehört nicht zu deinem Ring oder wurde nachträglich verändert.',
	'ring.notice.joined': 'Dem Ring von „{host}“ beigetreten.',
	'ring.notice.left': 'Ring verlassen. An den installierten Plugins wurde nichts geändert.',
	'ring.notice.raced':
		'Der Ring wurde von „{host}“ geändert, seit dieses Gerät zuletzt veröffentlicht hat. Es wurde nichts überschrieben.',
	'ring.notice.published': '{count} Plugins im Ring veröffentlicht.',
	'ring.notice.unknownFormat': 'Der Ring-Snapshot hat ein Format, das diese Version nicht kennt.',
	'ring.notice.unreadable': 'Der Ring-Snapshot konnte nicht gelesen werden.',
	'ring.notice.retryLater': '{message} Gleich noch einmal versuchen.',
	'ring.notice.hasChanges': 'Toolbox: Im Plugin-Ring gibt es Änderungen von einem anderen Gerät.',
	'ring.notice.conflictCopies':
		'Toolbox: {count} Konfliktkopien der Ring-Datei gefunden. Womöglich veröffentlichen zwei Geräte gleichzeitig.',
	'ring.notice.codeCopied': 'Ring-Code kopiert.',
	'ring.notice.codeCopyFailed':
		'Der Code konnte nicht kopiert werden — bitte von Hand markieren.',

	'ring.file.notJson': 'Die Ring-Datei ist gerade kein gültiges JSON.',
	'ring.file.notSnapshot': 'Die Ring-Datei sieht nicht wie ein Ring-Snapshot aus.',

	'ring.device.mobile': 'Mobilgerät',
	'ring.device.desktop': 'Desktop',

	'ring.join.title': 'Einem Plugin-Ring beitreten',
	'ring.join.hint':
		'Gib den Code ein, der auf dem Host-Gerät angezeigt wird. Es wird nichts geändert, bevor du gesehen hast, was passieren würde.',
	'ring.join.label': 'Ring-Code',
	'ring.join.placeholder': 'Ring-Code einfügen',
	'ring.join.submit': 'Beitreten',

	'ring.code.title': 'Dein Ring-Code',
	'ring.code.hint':
		'Gib diesen Code auf einem anderen Gerät ein, um es in den Ring aufzunehmen. Wer ihn hat, kann den Ring lesen und darin veröffentlichen — behandle ihn wie ein Passwort.',

	'ring.diff.title': 'Ring-Änderung von „{host}“',
	'ring.diff.hostChanged':
		'Dieser Snapshot wurde von einem anderen Gerät als bisher veröffentlicht. Wenn du die Host-Rolle nicht selbst übergeben hast, wende ihn nicht an.',
	'ring.diff.upToDate': 'Dieses Gerät stimmt bereits mit dem Host überein.',
	'ring.diff.willApply': 'Wird angewendet',
	'ring.diff.leftAlone': 'Bleibt unangetastet',
	'ring.diff.nothingToApply': 'Nichts anzuwenden',
	'ring.diff.applyOne': 'Eine Änderung anwenden',
	'ring.diff.applyMany': '{count} Änderungen anwenden',

	'ring.kind.missing': 'Hier nicht installiert',
	'ring.kind.enable': 'Einschalten',
	'ring.kind.disable': 'Ausschalten',
	'ring.kind.version': 'Andere Version',
	'ring.kind.settings': 'Einstellungen weichen ab',
	'ring.kind.extra': 'Nur auf diesem Gerät',

	'ring.reason.desktopOnly': 'Nur für Desktop, läuft auf diesem Gerät nicht',
	'ring.reason.notInstalled': 'Noch nicht installiert — Installieren wird noch nicht unterstützt',
	'ring.reason.noUpdate': 'Aktualisieren wird noch nicht unterstützt',
	'ring.reason.hostLacks': 'Der Host hat dieses Plugin nicht — bleibt unangetastet',

	'ring.result.appliedOne': 'Eine Änderung angewendet.',
	'ring.result.appliedMany': '{count} Änderungen angewendet.',
	'ring.result.partial': '{applied} von {total} angewendet. Fehlgeschlagen: {names}.',
};
