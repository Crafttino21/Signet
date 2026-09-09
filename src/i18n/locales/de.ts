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
		'Unter „{path}“ liegt noch keine Ring-Datei. Erst auf dem Host veröffentlichen, dann dieses Gerät fertig synchronisieren lassen.',
	'ring.notice.noRingFile': 'In diesem Vault gibt es unter „{path}“ keine Ring-Datei.',
	'ring.notice.publishFailed': 'Ring-Datei „{path}“ konnte nicht geschrieben werden: {message}',
	'ring.notice.foreignFileHost':
		'Die Datei „{path}“ gehört zu einem anderen Ring. Drücke „Jetzt veröffentlichen“, um sie beiseitezulegen und diesen Ring zu schreiben.',
	'ring.notice.codeMismatch': 'Dieser Code gehört nicht zum Ring in diesem Vault.',
	'ring.notice.wrongRing':
		'Dieser Snapshot gehört nicht zu deinem Ring oder wurde nachträglich verändert.',
	'ring.notice.joined': 'Dem Ring von „{host}“ beigetreten.',
	'ring.notice.joinedWithServer':
		'Beigetreten. Der Code enthielt die Serveradresse, dieses Gerät verbindet sich gerade damit.',
	'ring.notice.joinedWaiting':
		'Code übernommen. Warte darauf, dass der Snapshot des Hosts unter „{path}“ ankommt — dieses Gerät meldet sich, sobald er da ist.',
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
	'ring.notice.newerCode':
		'Dieser Code stammt aus einer neueren Toolbox-Version. Aktualisiere zuerst das Plugin auf diesem Gerät.',
	'ring.notice.replacedRingFile': 'Die alte Ring-Datei „{path}“ liegt jetzt im Papierkorb.',
	'ring.notice.ringFileBusy':
		'Die Datei „{path}“ steht noch nicht in Obsidians Index und lässt sich deshalb nicht sicher verschieben. Versuch es gleich noch einmal.',

	'ring.conflict.title': 'Hier liegt schon eine Ring-Datei',
	'ring.conflict.foreign':
		'Die Datei „{path}“ gehört zu einem anderen Ring. Dieses Gerät kann sie weder lesen noch überschreiben.',
	'ring.conflict.corrupt':
		'Die Datei „{path}“ gehört zu diesem Ring, lässt sich aber nicht öffnen. Möglicherweise ist sie beschädigt.',
	'ring.conflict.trashHint':
		'Beim Ersetzen wandert sie in den Papierkorb und ist wiederherstellbar. Am anderen Ring ändert das nichts — es macht nur den Pfad frei.',
	'ring.conflict.keep': 'Unverändert lassen',
	'ring.conflict.replace': 'In den Papierkorb',

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
	'ring.code.includeServer': 'Serveradresse mitgeben',
	'ring.code.includeServerDesc':
		'Ausschalten, wenn das andere Gerät den Server unter einer anderen Adresse erreicht — über ein VPN oder unter einem Namen, den dieses Netz nicht kennt.',
	'ring.code.hintWithServer':
		'Gib diesen Code auf einem anderen Gerät ein, um es in den Ring aufzunehmen. Er enthält die Adresse des Sync-Servers, dort ist also nichts weiter einzutragen. Wer ihn hat, kann den Ring lesen und darin veröffentlichen — behandle ihn wie ein Passwort.',
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
	'vaultSync.name': 'Vault-Sync',
	'vaultSync.description':
		'Synchronisiert deine Notizen mit deinem eigenen Server, verschlüsselt auf diesem Gerät, bevor sie es verlassen. Nutzt denselben Ring-Code wie der Plugin-Ring.',

	'vaultSync.ribbon': 'Vault synchronisieren',
	'vaultSync.command.sync': 'Vault jetzt synchronisieren',
	'vaultSync.command.preview': 'Anzeigen, was eine Synchronisierung täte',
	'vaultSync.command.forget': 'Vergessen, was dieses Gerät zuletzt synchronisiert hat',

	'vaultSync.settings.needsRing':
		'Zuerst einen Plugin-Ring erstellen oder beitreten. Der Ring-Code verschlüsselt deine Notizen und weist deinen Vault gegenüber dem Server aus.',
	'vaultSync.settings.status': 'Status',
	'vaultSync.settings.statusReady': 'Eingerichtet. Dieses Gerät kann synchronisieren.',
	'vaultSync.settings.statusNotSetUp': 'Auf diesem Server noch nicht eingerichtet.',
	'vaultSync.settings.server': 'Serveradresse',
	'vaultSync.settings.serverDesc':
		'Kommt normalerweise aus dem Ring und muss nicht angefasst werden. Nur ändern, wenn dieses Gerät den Server unter einer anderen Adresse erreicht.',
	'vaultSync.settings.connect': 'Server verbinden',
	'vaultSync.settings.connectDesc':
		'Nur auf diesem Gerät und nur einmal. Alle anderen Geräte im Ring bekommen die Adresse von hier. Im Heimnetz ist das eine Adresse wie http://192.168.1.10:8787; bitte https, sobald der Server von außen erreichbar ist, denn die Notizen sind verschlüsselt, das Zugriffstoken nicht.',
	'vaultSync.settings.fromRing': 'Kommt aus dem Ring',
	'vaultSync.settings.fromRingWaiting':
		'Server: {url}. Hier ist nichts einzutragen — warte darauf, dass der Host den Vault dort anlegt.',
	'vaultSync.settings.fromRingNoServer':
		'Hier ist nichts einzutragen. Der Host veröffentlicht die Server-Adresse im Ring, und dieses Gerät richtet sich damit selbst ein.',
	'vaultSync.settings.registration': 'Registrierungsschlüssel',
	'vaultSync.settings.registrationDesc':
		'Vom Server, einmalig nötig, um den Vault anzulegen. Wird direkt danach gelöscht und verlässt dieses Gerät nie.',
	'vaultSync.settings.setUp': 'Einrichten',
	'vaultSync.settings.moreAfterSetup':
		'Die übrigen Einstellungen erscheinen, sobald der Server für diesen Vault geantwortet hat.',
	'vaultSync.settings.confirm': 'Vor Änderungen auf diesem Gerät fragen',
	'vaultSync.settings.confirmDesc':
		'Zeigt, was hier ankommt, ersetzt oder in den Papierkorb wandert, und wartet. Beim Hochladen wird nie gefragt.',
	'vaultSync.settings.interval': 'Automatisch synchronisieren alle',
	'vaultSync.settings.intervalDesc': 'Minuten. 0 schaltet es ab. Wirkt nach einem Neustart.',
	'vaultSync.settings.excluded': 'Diese Ordner nicht synchronisieren',
	'vaultSync.settings.excludedDesc':
		'Ein Pfad pro Zeile. Obsidians Konfigurationsordner bleibt immer außen vor.',
	'vaultSync.settings.actions': 'Ausführen',
	'vaultSync.settings.test': 'Verbindung testen',
	'vaultSync.settings.codeWarning':
		'Der Server kann nichts davon lesen und kann dir deshalb auch nicht helfen, wenn der Ring-Code verloren geht. Bewahre ihn sicher und getrennt auf.',

	'vaultSync.plan.title': 'Was diese Synchronisierung täte',
	'vaultSync.plan.firstRun':
		'Dieses Gerät hat noch nie synchronisiert. Alles, was sich unterscheidet, gilt deshalb als Konflikt, statt geraten zu werden.',
	'vaultSync.plan.hereChanges': 'Änderungen auf diesem Gerät',
	'vaultSync.plan.serverChanges': 'Änderungen auf dem Server',
	'vaultSync.plan.conflictNote':
		'Wo beide Seiten geändert wurden, wird nichts überschrieben: Die ankommende Fassung landet als Konfliktkopie neben deiner.',
	'vaultSync.plan.confirm': 'Jetzt synchronisieren',

	'vaultSync.action.upload': 'geht an den Server',
	'vaultSync.action.download': 'kommt hier an',
	'vaultSync.action.deleteLocal': 'wandert hier in den Papierkorb',
	'vaultSync.action.deleteRemote': 'wird auf dem Server entfernt',
	'vaultSync.action.conflict': 'beide geändert, beide bleiben',
	'vaultSync.action.resurrect': 'woanders gelöscht, bleibt weil du es bearbeitet hast',

	'vaultSync.result.upToDate': 'Alles ist bereits synchron.',
	'vaultSync.result.uploaded': '{count} gesendet',
	'vaultSync.result.downloaded': '{count} empfangen',
	'vaultSync.result.trashed': '{count} in den Papierkorb verschoben',
	'vaultSync.result.conflicts': '{count} als Konfliktkopie behalten',
	'vaultSync.result.partial':
		'{done} synchronisiert, {failed} fehlgeschlagen. Verloren ist nichts, der Rest wird beim nächsten Mal erneut versucht.',

	'vaultSync.notice.needsRing': 'Zuerst einen Plugin-Ring erstellen oder beitreten.',
	'vaultSync.notice.portAdded':
		'Keine Portangabe, deshalb wurde der übliche ergänzt: {url}. Unter „Erweitert“ änderbar, falls dein Server woanders lauscht.',
	'vaultSync.notice.unreachable':
		'Toolbox: {url} war nicht erreichbar. {message} Prüfe die Adresse samt Port — der Server lauscht auf 8787, sofern du das nicht geändert hast.',
	'vaultSync.notice.badServerUrl':
		'Das ist keine vollständige Adresse. Sie muss mit http:// oder https:// beginnen, zum Beispiel http://192.168.1.10:8787.',
	'vaultSync.notice.needsServer': 'Zuerst die Serveradresse eintragen.',
	'vaultSync.notice.serverFromRing': 'Sync-Server aus dem Ring übernommen: {url}',
	'vaultSync.notice.readyFromRing':
		'Dieses Gerät ist für den Sync eingerichtet. Mehr als der Ring-Code war nicht nötig.',
	'vaultSync.notice.notOnServerYet':
		'Der Server kennt diesen Ring noch nicht. Zuerst auf dem Host-Gerät einrichten.',
	'vaultSync.notice.needsRegistrationSecret':
		'Zuerst den Registrierungsschlüssel deines Servers eintragen.',
	'vaultSync.notice.notSetUp': 'Diesen Vault zuerst auf dem Server einrichten.',
	'vaultSync.notice.reachable': 'Server erreicht. Protokollversion {protocol}.',
	'vaultSync.notice.created': 'Vault auf dem Server angelegt.',
	'vaultSync.notice.joined':
		'Dieser Vault war auf dem Server bereits vorhanden, dieses Gerät ist beigetreten.',
	'vaultSync.notice.forgotten':
		'Vergessen. Die nächste Synchronisierung behandelt jeden Unterschied als Konflikt und behält beide Seiten.',
	'vaultSync.notice.failed': 'Synchronisierung fehlgeschlagen:',
	'vaultSync.settings.live': 'Offene Geräte gleich halten',
	'vaultSync.settings.liveDesc':
		'Hält eine Anfrage beim Server offen, sodass eine Änderung von einem anderen offenen Gerät binnen einer Sekunde ankommt. Läuft nur, solange Obsidian sichtbar ist, und wendet Ankommendes ohne Rückfrage an — bei Konflikten bleiben weiterhin beide Fassungen, Löschungen gehen weiterhin in den Papierkorb.',
	'vaultSync.settings.syncOnStart': 'Beim Öffnen von Obsidian aufholen',
	'vaultSync.settings.syncOnStartDesc':
		'Läuft auch, wenn die App wieder in den Vordergrund kommt — so holt sich ein Handy, was es verpasst hat.',
	'vaultSync.notice.restartNeeded':
		'Wirkt, nachdem das Modul aus- und wieder eingeschaltet wurde.',

	'common.advanced': 'Erweitert',

	'panel.title': 'Toolbox',
	'panel.open': 'Toolbox-Leiste öffnen',
	'panel.available': 'In den Einstellungen einschaltbar: {names}.',
	'panel.version': 'Toolbox {version}',
	'panel.nothing': 'Es ist kein Modul eingeschaltet. In den Einstellungen eines aktivieren.',

	'ring.panel.title': 'Plugin-Ring',
	'ring.panel.none': 'Noch in keinem Ring.',
	'ring.panel.host': 'Host · veröffentlicht bis {seq}',
	'ring.panel.client': 'Folgt · angewendet bis {seq}',
	'ring.panel.waitingForHost':
		'Warte darauf, dass der Snapshot des Hosts hierher synchronisiert wird.',
	'ring.panel.noFileHost':
		'Keine Ring-Datei unter „{path}“. Veröffentliche, damit die anderen Geräte etwas zum Beitreten haben.',
	'ring.panel.foreignFile':
		'Die Datei „{path}“ gehört zu einem anderen Ring. Beim Veröffentlichen wird angeboten, sie beiseitezulegen.',
	'ring.panel.corruptFile':
		'Die Ring-Datei „{path}“ lässt sich nicht öffnen. Möglicherweise ist sie beschädigt.',
	'ring.panel.nothingPublished':
		'Noch nichts veröffentlicht — die anderen Geräte finden keine Ring-Datei. Auf „Jetzt veröffentlichen“ drücken.',

	'vaultSync.panel.title': 'Vault-Sync',
	'vaultSync.panel.waitingForRing':
		'Richtet sich über den Ring selbst ein — hier ist nichts zu tun.',
	'vaultSync.panel.notSetUp': 'Noch nicht eingerichtet.',
	'vaultSync.panel.ready': 'Bereit · Stand {seq}',
	'vaultSync.panel.live': 'Live',
	'vaultSync.panel.liveOff': 'Manuell',
	'vaultSync.panel.serverFromRing': 'Server: {url} · aus dem Ring',
	'vaultSync.panel.serverManual': 'Server: {url} · auf diesem Gerät gesetzt',
	'vaultSync.panel.never': 'Auf diesem Gerät noch nicht synchronisiert.',
	'vaultSync.panel.lastRun': 'Zuletzt: {summary}',

	'vaultSync.status.idle': 'Sync: bereit',
	'vaultSync.status.syncing': 'Sync: läuft',
	'vaultSync.status.live': 'Sync: live',
	'vaultSync.status.error': 'Sync: Problem',
	'vaultSync.status.off': 'Sync: aus',
	'vaultSync.indicator.liveNote': 'Diese Notiz wird gerade gemeinsam bearbeitet',
	'vaultSync.status.tooltip': 'Toolbox Vault-Sync — klicken öffnet die Leiste',

	'sync.panel.title': 'Sync-Gesundheit',
	'sync.panel.clean': 'Keine Konflikte gefunden.',
	'sync.panel.conflicts': '{count} Konflikte gefunden.',
	'sync.panel.unchecked': 'Noch nicht geprüft.',
	'sync.panel.devices': 'Geräte',
	'sync.panel.check': 'Jetzt prüfen',
	'sync.panel.report': 'Bericht öffnen',
	'ring.reason.cannotInstall': 'Installieren ist auf diesem Gerät nicht möglich',
	'ring.kind.install': 'Installieren',
	'ring.settings.install': 'Fehlende Plugins installieren',
	'ring.settings.installDesc':
		'Holt Plugins, die der Host hat und dieses Gerät nicht. Installiert wird ausschließlich, was in Obsidians eigenem Community-Verzeichnis steht — eine ID im Snapshot allein genügt nie.',
	'ring.settings.installUnsupported':
		'Diese Obsidian-Version stellt den Plugin-Installer nicht bereit, fehlende Plugins können deshalb nur aufgelistet werden.',
	'ring.result.installed': '{count} installiert.',
	'setup.title': 'Toolbox einrichten',
	'setup.command': 'Toolbox einrichten',
	'setup.nothing': 'Es gibt nichts einzurichten. Zuerst ein Modul einschalten.',
	'setup.allDone': 'Alles eingerichtet. Du kannst schließen.',
	'setup.finish': 'Fertig',

	'panel.setupNeeded': 'Noch {count} Schritt(e), bis das läuft.',

	'ring.setup.title': 'Ring erstellen oder beitreten',
	'ring.setup.hint':
		'Der Ring-Code ist der Schlüssel zu allem Weiteren: Er verschlüsselt deine Notizen und weist deinen Vault aus. Auf dem ersten Gerät einen erstellen, auf den anderen mit diesem Code beitreten.',

	'vaultSync.setup.title': 'Mit deinem Server verbinden',
	'vaultSync.setup.hint':
		'Die Adresse deines Sync-Servers und der Registrierungsschlüssel aus seiner Konfiguration. Der Schlüssel wird einmal benutzt und danach vergessen.',
	'vaultSync.setup.waitingForHost':
		'Hier ist nichts zu tun. Der Host veröffentlicht die Server-Adresse im Ring, und dieses Gerät richtet sich damit selbst ein.',
	'vaultSync.setup.waitingForServer':
		'Server aus dem Ring: {url}. Warte darauf, dass der Host den Vault dort anlegt.',
	'vaultSync.setup.checkAgain': 'Jetzt prüfen',
	'vaultSync.setup.connect': 'Verbinden',
	'collab.name': 'Gemeinsames Bearbeiten',
	'collab.description':
		'Lässt zwei Geräte dieselbe Notiz gleichzeitig bearbeiten und führt die Tastenanschläge zusammen, statt zwei Fassungen zu behalten. Nutzt denselben Ring und Server wie der Sync.',
	'collab.panel.title': 'Gemeinsames Bearbeiten',
	'collab.panel.needsSync': 'Braucht zuerst einen Ring und einen verbundenen Server.',
	'collab.panel.idle': 'Keine Notiz zum gemeinsamen Bearbeiten geöffnet.',
	'collab.panel.alone': 'verbunden, sonst niemand da',
	'collab.panel.peers': 'verbunden · {count} weitere(s) Gerät(e)',
	'collab.panel.offline': 'nicht verbunden',
	'collab.settings.enabled': 'Notizen gemeinsam bearbeiten',
	'collab.settings.enabledDesc':
		'Solange eine Notiz offen ist, wird sie Anschlag für Anschlag mit allen abgeglichen, die sie ebenfalls offen haben. Diese Notiz bleibt so lange aus dem normalen Dateisync heraus, damit beide sich nicht gegenseitig überschreiben.',
	'collab.settings.excluded': 'Diese Ordner nie gemeinsam bearbeiten',
	'collab.settings.excludedDesc': 'Ein Pfad pro Zeile.',
	'collab.notice.failed': 'Toolbox: Gemeinsames Bearbeiten konnte für diese Notiz nicht starten.',
};
