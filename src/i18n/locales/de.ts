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

	'sync.name': 'Sync-Wächter',
	'sync.description':
		'Beobachtet die Synchronisierung, die du ohnehin nutzt: findet Konfliktkopien und Notizen mit Konfliktmarkern und meldet, wenn ein Gerät nicht mehr synchronisiert.',

	'sync.command.report': 'Sync-Bericht anzeigen',
	'sync.command.deepScan': 'Alle Notizen nach Konfliktmarkern durchsuchen',
	'sync.ribbon': 'Sync-Bericht',

	'sync.notice.clean': 'Keine Sync-Konflikte gefunden.',
	'sync.notice.foundOne': 'Toolbox: 1 Sync-Konflikt gefunden.',
	'sync.notice.foundMany': 'Toolbox: {count} Sync-Konflikte gefunden.',
	'sync.notice.scanning': 'Alle Notizen werden gelesen, das dauert einen Moment …',
	'sync.notice.trashed':
		'„{name}“ in den Papierkorb verschoben. Endgültig gelöscht wurde nichts.',
	'sync.notice.trashFailed': '„{name}“ konnte nicht in den Papierkorb verschoben werden: {error}',
	'sync.notice.doubleSync': 'Toolbox: Zwei Sync-Programme verwalten diesen Vault.',

	'sync.report.title': 'Sync-Bericht',
	'sync.report.copies': 'Konfliktkopien',
	'sync.report.markers': 'Notizen mit Konfliktmarkern',
	'sync.report.devices': 'Geräte',
	'sync.report.clean': 'Alles unauffällig. Keine Konfliktkopien und keine Konfliktmarker.',
	'sync.report.deepHint':
		'Gelesen wurden nur Notizen mit dem Tag #conflict. Für eine gründliche Suche „Alle Notizen nach Konfliktmarkern durchsuchen“ verwenden.',
	'sync.report.originalMissing': 'Das Original fehlt — es gibt nur noch diese Kopie',
	'sync.report.markerOne': '1 Konfliktblock',
	'sync.report.markerMany': '{count} Konfliktblöcke',
	'sync.report.markerLines': 'ab Zeile {line}',
	'sync.report.compare': 'Vergleichen',
	'sync.report.open': 'Öffnen',
	'sync.report.noDevices': 'Bisher hat sich kein anderes Gerät gemeldet.',

	'sync.device.self': 'dieses Gerät',
	'sync.device.justNow': 'gerade eben gesehen',
	'sync.device.hours': 'vor {hours} Std. gesehen',
	'sync.device.days': 'vor {days} Tagen gesehen',
	'sync.device.unknown': 'Zeitstempel unlesbar',

	'sync.compare.title': 'Konfliktkopie von „{name}“',
	'sync.compare.original': 'Original',
	'sync.compare.copy': 'Konfliktkopie',
	'sync.compare.identical':
		'Beide Dateien haben exakt denselben Inhalt, die Kopie ist überflüssig.',
	'sync.compare.hint':
		'Was du nicht behältst, wandert in den Papierkorb und lässt sich zurückholen.',
	'sync.compare.keepOriginal': 'Original behalten',
	'sync.compare.keepCopy': 'Diese Kopie behalten',
	'sync.compare.openBoth': 'Beide öffnen',

	'sync.double.title': 'Zwei Sync-Programme auf denselben Dateien',
	'sync.double.body':
		'{tool} synchronisiert einen Ordner oberhalb deines Vaults, und in Obsidian läuft {plugins}. Beide schreiben dieselben Dateien, und jedes hält die Schreibvorgänge des anderen für eine fremde Änderung — die übliche Ursache für Konfliktkopien, die niemand verursacht hat.',
	'sync.double.advice':
		'Obsidian empfiehlt genau einen Sync-Dienst pro Vault. Auf diesem Rechner entweder den Desktop-Client nutzen und das Plugin hier abschalten — oder umgekehrt.',
	'sync.double.folder': 'Gefunden in: {folder}',
	'sync.double.dismiss': 'Nicht mehr warnen',

	'sync.settings.checkOnStart': 'Beim Start von Obsidian prüfen',
	'sync.settings.checkOnStartDesc':
		'Meldet Konflikte einmal nach dem Laden, ohne etwas zu öffnen.',
	'sync.settings.staleAfter': 'Gerät gilt als abgemeldet nach',
	'sync.settings.staleAfterDesc': 'Stunden ohne Lebenszeichen. 0 bedeutet: nie warnen.',
	'sync.settings.heartbeatFolder': 'Ordner für Lebenszeichen',
	'sync.settings.heartbeatFolderDesc':
		'Jedes Gerät schreibt hier eine kleine Datei. Ein Schreiber pro Datei — damit können sie selbst keine Konflikte erzeugen.',
	'sync.settings.excluded': 'Diese Ordner überspringen',
	'sync.settings.excludedDesc': 'Ein Pfad pro Zeile. Praktisch für Archive voller alter Kopien.',
	'sync.settings.doubleSyncCheck': 'Vor einem zweiten Sync-Programm warnen',
	'sync.settings.doubleSyncCheckDesc':
		'Sieht in den Ordnern oberhalb deines Vaults nach einem weiteren Sync-Client. Nur am Desktop, und es werden ausschließlich Ordnernamen gelesen.',
};
