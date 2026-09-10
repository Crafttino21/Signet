import type { Translations } from './en';

/**
 * German. Typed as a complete `Translations` on purpose: adding a key to `en.ts`
 * breaks this file until it is translated too, which is what keeps the two in step.
 */
export const de: Translations = {
	'common.enable': 'Aktiviert',
	'common.cancel': 'Abbrechen',
	'common.copy': 'Kopieren',

	'module.loadFailed': 'Signet: „{name}“ konnte nicht geladen werden und wurde abgeschaltet.',

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
		'Signet: Der Plugin-Ring wird von dieser Obsidian-Version nicht unterstützt.',
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
	'ring.notice.codeMismatch':
		'Die Datei „{path}“ gehört zu einem anderen Ring als dieser Code. Beides ist heil — es sind schlicht zwei verschiedene Ringe, und dieser Vault kann an diesem Pfad nur einen halten. Tritt erneut bei und lass die alte Datei beiseitelegen, oder nimm den Code, der zu ihr gehört.',
	'ring.notice.wrongRing':
		'Dieser Snapshot gehört nicht zu deinem Ring oder wurde nachträglich verändert.',
	'ring.notice.joined': 'Dem Ring von „{host}“ beigetreten.',
	'ring.notice.joinedWithServer':
		'Beigetreten. Der Code enthielt die Serveradresse, dieses Gerät verbindet sich gerade damit.',
	'ring.notice.joinedWaiting':
		'Code übernommen. Warte darauf, dass der Snapshot des Hosts unter „{path}“ ankommt — dieses Gerät meldet sich, sobald er da ist.',
	'ring.notice.createCancelled':
		'Es wurde kein Ring erstellt. Auf diesem Gerät hat sich nichts geändert.',
	'ring.notice.removedFromRing':
		'„{host}“ hat dieses Gerät aus dem Ring entfernt. An den installierten Plugins wurde nichts geändert.',
	'ring.notice.becameHost': 'Dieses Gerät ist jetzt Host des Rings.',
	'ring.notice.handedOver': 'Der Ring gehört jetzt „{name}“. Dieses Gerät folgt ihm von nun an.',
	'ring.notice.left': 'Ring verlassen. An den installierten Plugins wurde nichts geändert.',
	'ring.notice.raced':
		'Der Ring wurde von „{host}“ geändert, seit dieses Gerät zuletzt veröffentlicht hat. Es wurde nichts überschrieben.',
	'ring.notice.published': '{count} Plugins im Ring veröffentlicht.',
	'ring.notice.unknownFormat': 'Der Ring-Snapshot hat ein Format, das diese Version nicht kennt.',
	'ring.notice.unreadable': 'Der Ring-Snapshot konnte nicht gelesen werden.',
	'ring.notice.retryLater': '{message} Gleich noch einmal versuchen.',
	'ring.notice.hasChanges': 'Signet: Im Plugin-Ring gibt es Änderungen von einem anderen Gerät.',
	'ring.notice.conflictCopies':
		'Signet: {count} Konfliktkopien der Ring-Datei gefunden. Womöglich veröffentlichen zwei Geräte gleichzeitig.',
	'ring.notice.newerCode':
		'Dieser Code stammt aus einer neueren Signet-Version. Aktualisiere zuerst das Plugin auf diesem Gerät.',
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

	'ring.device.unknownTime': 'unlesbarer Zeitstempel',
	'ring.device.now': 'gerade da',
	'ring.device.minutes': 'vor {count} Min. gesehen',
	'ring.device.hours': 'vor {count} Std. gesehen',
	'ring.device.days': 'vor {count} Tagen gesehen',
	'ring.device.mobile': 'Mobilgerät',
	'ring.device.desktop': 'Desktop',

	'ring.join.title': 'Einem Plugin-Ring beitreten',
	'ring.join.hint':
		'Gib den Code ein, der auf dem Host-Gerät angezeigt wird. Es wird nichts geändert, bevor du gesehen hast, was passieren würde.',
	'ring.join.label': 'Ring-Code',
	'ring.join.placeholder': 'Ring-Code einfügen',
	'ring.join.submit': 'Beitreten',

	'ring.remove.title': '„{name}“ aus dem Ring entfernen?',
	'ring.remove.body':
		'Es verschwindet aus dieser Liste und verlässt den Ring beim nächsten Sync von selbst. Das ist eine Mitteilung, kein Schloss: der Ring-Code ist der Schlüssel, ein Gerät mit dem Code kann den Ring also weiterhin lesen. Um den Zugriff wirklich zu entziehen, erstelle einen neuen Ring und gib den neuen Code nur an die Geräte, die bleiben sollen.',
	'ring.handOver.title': 'Den Ring an „{name}“ übergeben?',
	'ring.handOver.body':
		'„{name}“ wird Host und veröffentlicht von da an; dieses Gerät folgt dem Ring wie jedes andere. Es greift, sobald das Gerät das nächste Mal synchronisiert. Zurückgeben geht genauso.',
	'ring.code.title': 'Dein Ring-Code',
	'ring.code.noServerYet':
		'Dieser Code enthält keine Serveradresse, weil noch keine eingerichtet ist. Richte zuerst den Sync-Server ein und zeig den Code dann erneut — jedes Gerät, das damit beitritt, braucht danach nichts weiter. Einem Gerät, das mit diesem Code schon beigetreten ist, musst du die Adresse von Hand nennen.',
	'ring.code.addressNotInCode':
		'Die Adresse {url} passt nicht in einen Code. Ein Code trägt eine schlichte Adresse wie http://192.168.1.10:8787 — keine mit Pfad, Abfrage oder IPv6-Host. Jedem Gerät, das mit diesem Code beitritt, musst du die Adresse von Hand nennen, in seinen Sync-Einstellungen unter „Erweitert".',
	'ring.code.parts':
		'Die ersten vier Gruppen sind der Ring selbst und ändern sich nie. Der graue Rest ist die Serveradresse, die dazukam, als der Server verbunden wurde — ein vorher notierter, kürzerer Code ist also nicht veraltet: er führt weiterhin in diesen Ring, das Gerät wird dann nur nach der Adresse gefragt.',
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

	'vaultSync.name': 'Vault-Sync',
	'vaultSync.description':
		'Synchronisiert deine Notizen mit deinem eigenen Server, verschlüsselt auf diesem Gerät, bevor sie es verlassen. Nutzt denselben Ring-Code wie der Plugin-Ring.',

	'vaultSync.ribbon': 'Vault synchronisieren',
	'vaultSync.command.sync': 'Vault jetzt synchronisieren',
	'vaultSync.command.preview': 'Anzeigen, was eine Synchronisierung täte',
	'vaultSync.command.forget': 'Vergessen, was dieses Gerät zuletzt synchronisiert hat',

	'vaultSync.settings.needsRing':
		'Zuerst einen Plugin-Ring erstellen oder beitreten. Der Ring-Code verschlüsselt deine Notizen und weist deinen Vault gegenüber dem Server aus.',
	'vaultSync.connect.title': 'Sync-Server verbinden',
	'vaultSync.connect.hint':
		'Der Ring-Code wird gleich erstellt und trägt diese Adresse zu jedem anderen Gerät. Den Server zuerst einzurichten ist das, was den Beitritt überall sonst zu einem einzigen Schritt macht.',
	'vaultSync.connect.serverDesc':
		'Im Heimnetz etwa http://192.168.1.10:8787. Der Port zählt: ohne ihn bedeutet die Adresse Port 80, wo nichts lauscht.',
	'vaultSync.connect.secretDesc':
		'Vom Server, einmalig nötig, um den Vault anzulegen. Er verlässt dieses Gerät nicht und wird nicht gespeichert.',
	'vaultSync.connect.connect': 'Verbinden',
	'vaultSync.connect.working': 'Verbinde…',
	'vaultSync.connect.without': 'Ohne Server',
	'vaultSync.connect.withoutHint':
		'Ohne Server hält der Ring weiterhin die Plugins deiner Geräte im Gleichschritt. Du kannst später einen verbinden — die vorher weitergegebenen Codes tragen die Adresse dann aber nicht.',
	'vaultSync.settings.status': 'Status',
	'vaultSync.settings.statusReady': 'Eingerichtet. Dieses Gerät kann synchronisieren.',
	'vaultSync.settings.statusNotSetUp': 'Auf diesem Server noch nicht eingerichtet.',
	'vaultSync.settings.server': 'Serveradresse',
	'vaultSync.settings.serverDesc':
		'Kommt normalerweise aus dem Ring und muss nicht angefasst werden. Nur ändern, wenn dieses Gerät den Server unter einer anderen Adresse erreicht.',
	'vaultSync.settings.strandedClient':
		'Es kommt nichts mehr. Dieses Gerät ist mit einem Code beigetreten, der von vor der Servereinrichtung stammt — es hat nie erfahren, wo der Server steht.',
	'vaultSync.settings.strandedServerDesc':
		'Zwei Wege, beide in Ordnung: hol dir einen frischen Code vom Host — der enthält jetzt die Adresse — und tritt damit erneut bei, oder trag die Adresse hier ein.',
	'vaultSync.settings.connect': 'Server verbinden',
	'vaultSync.settings.connectDesc':
		'Nur auf diesem Gerät und nur einmal. Alle anderen Geräte im Ring bekommen die Adresse von hier. Im Heimnetz ist das eine Adresse wie http://192.168.1.10:8787; bitte https, sobald der Server von außen erreichbar ist, denn die Notizen sind verschlüsselt, das Zugriffstoken nicht.',
	'vaultSync.settings.fromRing': 'Kommt aus dem Ring',
	'vaultSync.settings.fromRingWaiting':
		'Server: {url}. Hier ist nichts einzutragen — warte darauf, dass der Host den Vault dort anlegt.',
	'vaultSync.settings.registration': 'Registrierungsschlüssel',
	'vaultSync.settings.registrationDesc':
		'Vom Server, einmalig nötig, um den Vault anzulegen. Wird direkt danach gelöscht und verlässt dieses Gerät nie.',
	'vaultSync.settings.setUp': 'Einrichten',
	'vaultSync.settings.moreAfterSetup':
		'Die übrigen Einstellungen erscheinen, sobald der Server für diesen Vault geantwortet hat.',
	'vaultSync.settings.conflicts':
		'{count} Konfliktkopien in diesem Vault. Beide Fassungen einer Notiz wurden behalten, und seitdem hat keine davon jemand angesehen.',
	'vaultSync.settings.confirm': 'Vor Änderungen auf diesem Gerät fragen',
	'vaultSync.settings.confirmDesc':
		'Zeigt, was hier ankommt, ersetzt oder in den Papierkorb wandert, und wartet. Beim Hochladen wird nie gefragt.',
	'vaultSync.settings.announce': 'Jeden automatischen Sync melden',
	'vaultSync.settings.announceDesc':
		'Eine Meldung, sobald ein Sync, den niemand angestoßen hat, etwas bewegt. Aus, weil das mit Live-Sync eine Meldung alle paar Sekunden ist. Was ein Lauf getan hat, steht ohnehin im Panel und in der Titelleiste der Notiz, und was fehlschlägt, meldet sich in jedem Fall.',
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
	'vaultSync.notice.addressPublished':
		'{url} antwortet für diesen Vault und wurde in den Ring veröffentlicht. Jedes Gerät, das seine Adresse aus dem Ring hat, wechselt beim nächsten Sync dorthin.',
	'vaultSync.notice.portAdded':
		'Keine Portangabe, deshalb wurde der übliche ergänzt: {url}. Unter „Erweitert“ änderbar, falls dein Server woanders lauscht.',
	'vaultSync.notice.unreachable':
		'Signet: {url} war nicht erreichbar. {message} Prüfe die Adresse samt Port — der Server lauscht auf 8787, sofern du das nicht geändert hast.',
	'vaultSync.notice.foundOnDefaultPort':
		'Unter {url} antwortet aber ein Sync-Server — das ist ziemlich sicher die Adresse, die du willst.',
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

	'rename.movedIn':
		'Dieses Plugin hieß bis eben Toolbox. Deine Einstellungen, dein Ring und der Sync-Stand dieses Geräts wurden aus „{from}“ übernommen — den Ordner kannst du löschen, sobald alles stimmt.',
	'panel.title': 'Signet',
	'panel.open': 'Signet-Leiste öffnen',
	'panel.available': 'In den Einstellungen einschaltbar: {names}.',
	'panel.version': 'Signet {version}',
	'panel.nothing': 'Es ist kein Modul eingeschaltet. In den Einstellungen eines aktivieren.',

	'ring.panel.title': 'Plugin-Ring',
	'ring.panel.none': 'Noch in keinem Ring.',
	'ring.panel.host': 'Host · veröffentlicht bis {seq}',
	'ring.panel.client': 'Folgt · angewendet bis {seq}',
	'ring.panel.waitingForHost':
		'Warte darauf, dass der Snapshot des Hosts hierher synchronisiert wird.',
	'ring.panel.noFileHost':
		'Keine Ring-Datei unter „{path}“. Veröffentliche, damit die anderen Geräte etwas zum Beitreten haben.',
	'ring.panel.foreignFileClient':
		'Die Datei „{path}“ gehört zu einem anderen Ring als dem, dem dieses Gerät beigetreten ist. Tritt mit dem richtigen Code erneut bei und lass sie beiseitelegen.',
	'ring.panel.foreignFile':
		'Die Datei „{path}“ gehört zu einem anderen Ring. Beim Veröffentlichen wird angeboten, sie beiseitezulegen.',
	'ring.panel.corruptFile':
		'Die Ring-Datei „{path}“ lässt sich nicht öffnen. Möglicherweise ist sie beschädigt.',
	'ring.panel.devices': 'Geräte',
	'ring.panel.noDevices': 'Noch hat sich kein Gerät in den Ring eingetragen.',
	'ring.panel.thisDevice': 'dieses Gerät',
	'ring.panel.isHost': 'Host',
	'ring.panel.makeHost': 'Zum Host machen',
	'ring.panel.remove': 'Entfernen',
	'ring.panel.nothingPublished':
		'Noch nichts veröffentlicht — die anderen Geräte finden keine Ring-Datei. Auf „Jetzt veröffentlichen“ drücken.',

	'vaultSync.panel.title': 'Vault-Sync',
	'vaultSync.panel.waitingForRing':
		'Richtet sich über den Ring selbst ein — hier ist nichts zu tun.',
	'vaultSync.panel.strandedClient':
		'Keine Serveradresse. Tritt mit einem frischen Code erneut bei, oder trag die Adresse in den Einstellungen ein.',
	'vaultSync.panel.notSetUp': 'Noch nicht eingerichtet.',
	'vaultSync.panel.ready': 'Bereit · Stand {seq}',
	'vaultSync.panel.live': 'Live',
	'vaultSync.panel.liveOff': 'Manuell',
	'vaultSync.panel.serverFromRing': 'Server: {url} · aus dem Ring',
	'vaultSync.panel.serverManual': 'Server: {url} · auf diesem Gerät gesetzt',
	'vaultSync.panel.conflicts':
		'{count} Konfliktkopien in diesem Vault. Beide Fassungen einer Notiz wurden behalten, und keine davon wurde angesehen.',
	'vaultSync.panel.never': 'Auf diesem Gerät noch nicht synchronisiert.',
	'vaultSync.panel.lastRun': 'Zuletzt: {summary}',

	'vaultSync.status.idle': 'Sync: bereit',
	'vaultSync.status.syncing': 'Sync: läuft',
	'vaultSync.status.live': 'Sync: live',
	'vaultSync.status.error': 'Sync: Problem',
	'vaultSync.status.off': 'Sync: aus',
	'vaultSync.indicator.liveNote': 'Diese Notiz wird gerade gemeinsam bearbeitet',
	'vaultSync.status.tooltip': 'Signet Vault-Sync — klicken öffnet die Leiste',

	'ring.reason.cannotInstall': 'Installieren ist auf diesem Gerät nicht möglich',
	'ring.kind.install': 'Installieren',
	'ring.settings.install': 'Fehlende Plugins installieren',
	'ring.settings.installDesc':
		'Holt Plugins, die der Host hat und dieses Gerät nicht. Installiert wird ausschließlich, was in Obsidians eigenem Community-Verzeichnis steht — eine ID im Snapshot allein genügt nie.',
	'ring.settings.installUnsupported':
		'Diese Obsidian-Version stellt den Plugin-Installer nicht bereit, fehlende Plugins können deshalb nur aufgelistet werden.',
	'ring.result.installed': '{count} installiert.',
	'setup.title': 'Signet einrichten',
	'setup.command': 'Signet einrichten',
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
	'collab.notice.failed': 'Signet: Gemeinsames Bearbeiten konnte für diese Notiz nicht starten.',
};
