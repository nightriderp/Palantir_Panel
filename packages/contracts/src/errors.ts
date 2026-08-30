/**
 * Fehlercode-Katalog (Pflichtenheft §5.1).
 *
 * Der Katalog ist bewusst **wachsend**: neue Fehlerfälle werden hier als
 * benannter Code mit HTTP-Status-Zuordnung ergänzt – niemals als Freitext-String
 * am Aufrufort (CLAUDE.md §5). Ergänzungen sind additiv; das Entfernen oder
 * Umbenennen eines bestehenden Codes ist ein Breaking Change und im Commit/PR
 * als solcher zu kennzeichnen (CLAUDE.md §3).
 *
 * Der Startsatz stammt aus Pflichtenheft §5.1. Die HTTP-Status-Zuordnung ist
 * dort nicht festgelegt und wird hier definiert (siehe Kommentare je Eintrag).
 */

export interface ErrorDefinition {
  /** HTTP-Status, mit dem das Backend diesen Fehler ausliefert. */
  readonly httpStatus: number;
  /** Fallback-Meldung, wenn der Aufrufer keine eigene mitgibt. */
  readonly defaultMessage: string;
}

export const ERROR_CATALOG = {
  /** Login mit falschen Zugangsdaten (Pflichtenheft §7). 401: nicht authentifiziert. */
  AUTH_INVALID_CREDENTIALS: {
    httpStatus: 401,
    defaultMessage: 'Benutzername oder Passwort ist falsch.',
  },
  /**
   * Konto ist gesperrt (Lastenheft §3.1, „Ban").
   * 403: Zugangsdaten stimmen, der Zugriff ist trotzdem dauerhaft untersagt –
   * bewusst getrennt von `AUTH_INVALID_CREDENTIALS`, damit die Oberfläche nicht
   * zum wiederholten Eingeben des Passworts einlädt.
   */
  AUTH_ACCOUNT_BANNED: {
    httpStatus: 403,
    defaultMessage: 'Dieses Konto ist gesperrt. Bitte wende dich an einen Administrator.',
  },
  /**
   * IP-basiertes Rate-Limit auf Anmeldung oder Registrierung greift
   * (Pflichtenheft §7). 429: derselbe Versuch kann später erfolgreich sein.
   */
  AUTH_RATE_LIMITED: {
    httpStatus: 429,
    defaultMessage: 'Zu viele Versuche. Bitte warte einen Moment und versuche es erneut.',
  },
  /** Falscher TOTP- oder Backup-Code im zweiten Anmeldeschritt (Pflichtenheft §7). 401. */
  AUTH_TWO_FACTOR_INVALID: {
    httpStatus: 401,
    defaultMessage: 'Der eingegebene Code ist nicht gültig.',
  },
  /**
   * Der kurzlebige Zwischen-Token des zweiten Anmeldeschritts ist abgelaufen
   * (Pflichtenheft §7). 401: die Anmeldung muss von vorn beginnen – bewusst
   * getrennt vom falschen Code, damit die Oberfläche zurück zum ersten Schritt
   * führen kann statt eine erneute Code-Eingabe anzubieten.
   */
  AUTH_TWO_FACTOR_EXPIRED: {
    httpStatus: 401,
    defaultMessage: 'Die Anmeldung ist abgelaufen. Bitte melde dich erneut an.',
  },
  /** ALTCHA-Prüfung der Registrierung fehlgeschlagen (Pflichtenheft §3, §7). 400. */
  AUTH_CAPTCHA_INVALID: {
    httpStatus: 400,
    defaultMessage: 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte versuche es erneut.',
  },
  /** Benutzername bei der Registrierung bereits vergeben. 409: Konflikt mit vorhandenem Zustand. */
  AUTH_USERNAME_TAKEN: {
    httpStatus: 409,
    defaultMessage: 'Dieser Benutzername ist bereits vergeben.',
  },
  /** Passwort erfüllt die Mindestanforderungen aus Pflichtenheft §7 nicht. 400. */
  AUTH_PASSWORD_TOO_WEAK: {
    httpStatus: 400,
    defaultMessage: 'Das Passwort muss mindestens 12 Zeichen lang sein.',
  },
  /**
   * Anmeldung über Discord, Twitch oder Steam ist fehlgeschlagen – abgebrochen,
   * ungültige Rückgabe oder Provider nicht erreichbar (Lastenheft §3.1).
   * 502: der Fehler liegt bei der vorgelagerten Gegenstelle, nicht bei der Eingabe.
   */
  AUTH_PROVIDER_ERROR: {
    httpStatus: 502,
    defaultMessage: 'Die Anmeldung über den externen Dienst ist fehlgeschlagen.',
  },

  // -- Ergänzt in B1 (Backend, Pflichtenheft §7) -----------------------------
  // Die Codes oben stammen aus F1 und decken Login, Registrierung und 2FA ab.
  // Hier kommen die Fälle dazu, die erst im Backend entstehen: Sitzungen,
  // Methoden-Verknüpfung, CSRF und die Admin-Eingriffe.

  /**
   * Zustandsändernder Request ohne gültiges CSRF-Token (Pflichtenheft §7, §18).
   * 403: die Sitzung ist gültig, der Request wird trotzdem abgelehnt.
   */
  AUTH_CSRF_INVALID: {
    httpStatus: 403,
    defaultMessage: 'Das Sicherheitstoken des Requests ist ungültig oder fehlt.',
  },
  /**
   * Refresh-Token abgelaufen, widerrufen oder unbekannt (Pflichtenheft §7).
   * 401: bewusst getrennt von `AUTH_REQUIRED`, damit das Frontend eine
   * abgelaufene Sitzung von einem nie angemeldeten Zugriff unterscheiden kann.
   */
  AUTH_SESSION_EXPIRED: {
    httpStatus: 401,
    defaultMessage: 'Die Sitzung ist abgelaufen. Bitte erneut anmelden.',
  },
  /** Sitzung existiert nicht oder gehört zu einem anderen Konto. 404. */
  AUTH_SESSION_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Sitzung existiert nicht.',
  },
  /** Für dieses Konto ist 2FA bereits aktiv (Pflichtenheft §7). 409. */
  AUTH_TWO_FACTOR_ALREADY_ENABLED: {
    httpStatus: 409,
    defaultMessage: 'Die Zwei-Faktor-Authentifizierung ist für dieses Konto bereits aktiv.',
  },
  /** Vorgang setzt aktive 2FA voraus, das Konto hat aber keine. 409. */
  AUTH_TWO_FACTOR_NOT_ENABLED: {
    httpStatus: 409,
    defaultMessage: 'Für dieses Konto ist keine Zwei-Faktor-Authentifizierung eingerichtet.',
  },
  /**
   * Dieses Anmeldeverfahren ist bereits mit einem Konto verknüpft – dem eigenen
   * oder einem fremden (Lastenheft §3.1). 409.
   */
  AUTH_METHOD_ALREADY_LINKED: {
    httpStatus: 409,
    defaultMessage: 'Dieses Anmeldeverfahren ist bereits mit einem Konto verknüpft.',
  },
  /** Das angeforderte Verfahren ist mit diesem Konto nicht verknüpft. 404. */
  AUTH_METHOD_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieses Anmeldeverfahren ist mit dem Konto nicht verknüpft.',
  },
  /**
   * Letztes verbliebenes Anmeldeverfahren soll getrennt werden. 409: das Konto
   * hätte danach keinen Weg mehr hinein – wer es loswerden will, löscht es
   * (Lastenheft §3.1).
   */
  AUTH_METHOD_LAST_REMAINING: {
    httpStatus: 409,
    defaultMessage:
      'Das letzte verbleibende Anmeldeverfahren kann nicht getrennt werden. Verknüpfe zuerst ein weiteres.',
  },
  /**
   * Rückkehr vom Provider ohne gültigen `state` (Pflichtenheft §7 –
   * Absicherung gegen untergeschobene Logins). 400.
   */
  AUTH_OAUTH_STATE_INVALID: {
    httpStatus: 400,
    defaultMessage: 'Der Login-Vorgang ist ungültig oder abgelaufen. Bitte erneut starten.',
  },
  /**
   * Für diesen Provider fehlen die Zugangsdaten in der zentralen `.env`
   * (Pflichtenheft §12.1). 501: die Instanz bietet diesen Weg nicht an.
   */
  AUTH_PROVIDER_NOT_CONFIGURED: {
    httpStatus: 501,
    defaultMessage: 'Dieser Anmelde-Anbieter ist auf dieser Instanz nicht eingerichtet.',
  },
  /**
   * Ein Admin hat das Passwort zurückgesetzt; bis zur Änderung sind andere
   * Vorgänge gesperrt (Lastenheft §3.1). 403.
   */
  AUTH_PASSWORD_CHANGE_REQUIRED: {
    httpStatus: 403,
    defaultMessage: 'Das Passwort muss zuerst geändert werden.',
  },
  /**
   * Vorgang würde den Owner aussperren – etwa die Selbst-Löschung des
   * Owner-Kontos (Lastenheft §2: genau ein Konto trägt diesen Status). 403:
   * unabhängig von Berechtigungen unzulässig.
   */
  AUTH_OWNER_PROTECTED: {
    httpStatus: 403,
    defaultMessage:
      'Das Owner-Konto ist geschützt: Es kann sich nicht selbst löschen oder aussperren.',
  },
  /**
   * Nutzer-Kontingent oder freie Node-Kapazität reicht nicht (Pflichtenheft §10).
   * 403: Request ist verstanden und authentifiziert, wird aber wegen eines
   * Limits abgelehnt – ein Retry ohne Änderung hilft nicht.
   */
  RESOURCE_LIMIT_EXCEEDED: {
    httpStatus: 403,
    defaultMessage: 'Das zulässige Ressourcen-Kontingent ist ausgeschöpft.',
  },
  /** Gewünschte Subdomain ist belegt oder reserviert (Pflichtenheft §13). 409: Konflikt mit vorhandenem Zustand. */
  SUBDOMAIN_TAKEN: {
    httpStatus: 409,
    defaultMessage: 'Diese Subdomain ist bereits vergeben.',
  },
  /**
   * Subdomain verletzt das Format (Pflichtenheft §13).
   * 400: bewusst getrennt von `SUBDOMAIN_TAKEN`, damit der Wizard „so nicht
   * erlaubt" von „schon vergeben" unterscheiden und passend zurückmelden kann.
   */
  SUBDOMAIN_INVALID: {
    httpStatus: 400,
    defaultMessage: 'Diese Subdomain entspricht nicht dem erlaubten Format.',
  },
  /**
   * Lifecycle-Befehl passt nicht zum aktuellen Zustand, z. B. Start auf einem
   * bereits laufenden Server (Pflichtenheft §9). 409: Konflikt mit dem
   * vorhandenen Zustand – erst nach Zustandswechsel sinnvoll wiederholbar.
   */
  SERVER_STATE_CONFLICT: {
    httpStatus: 409,
    defaultMessage: 'Der Server ist für diesen Vorgang im falschen Zustand.',
  },
  /**
   * Hochgeladene Datei überschreitet `MAX_UPLOAD_SIZE_BYTES` (Pflichtenheft
   * §12.1). 413: Gegenstück zu `AGENT_FILE_TOO_LARGE`, aber für den
   * REST-Upload des Datei-Managers statt für den Agent-Kanal.
   */
  FILE_TOO_LARGE: {
    httpStatus: 413,
    defaultMessage: 'Die Datei überschreitet die zulässige Upload-Größe.',
  },
  /**
   * Zugriff ohne gültige Sitzung (Pflichtenheft §7, §8).
   * 401: nicht authentifiziert – ein erneuter Versuch nach Anmeldung kann erfolgreich sein.
   */
  AUTH_REQUIRED: {
    httpStatus: 401,
    defaultMessage: 'Für diesen Zugriff ist eine Anmeldung erforderlich.',
  },
  /**
   * Angemeldet, aber die nötige Permission fehlt (Pflichtenheft §8).
   * 403: bewusst getrennt von `AUTH_REQUIRED`, damit das Frontend zwischen
   * „neu anmelden" und „fehlende Berechtigung" unterscheiden kann.
   */
  PERMISSION_DENIED: {
    httpStatus: 403,
    defaultMessage: 'Für diese Aktion fehlt die nötige Berechtigung.',
  },
  /**
   * Konto existiert nicht (Pflichtenheft §6, Entität `User`).
   * 404: Zielobjekt nicht vorhanden – z. B. beim Setzen eines Kontingents (§10)
   * für ein inzwischen gelöschtes Konto.
   */
  USER_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieses Konto existiert nicht.',
  },
  /**
   * Node existiert nicht (Pflichtenheft §6, Entität `HostNode`).
   * 404: Zielobjekt nicht vorhanden – z. B. bei der Kapazitätsprüfung (§10) für
   * eine Node, die zwischenzeitlich entfernt wurde.
   */
  NODE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Node existiert nicht.',
  },
  /** Rolle existiert nicht (Pflichtenheft §8). 404: Zielobjekt nicht vorhanden. */
  ROLE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Rolle existiert nicht.',
  },
  /** Rollenname bereits vergeben (Pflichtenheft §8). 409: Konflikt mit vorhandenem Zustand. */
  ROLE_NAME_TAKEN: {
    httpStatus: 409,
    defaultMessage: 'Eine Rolle mit diesem Namen existiert bereits.',
  },
  /**
   * Änderung an einer geschützten Systemrolle („Gast", Pflichtenheft §8).
   * 403: die Aktion ist grundsätzlich unzulässig, unabhängig von Berechtigungen –
   * auch der Owner darf sie nicht ausführen (Schutz vor Selbst-Aussperrung).
   */
  ROLE_PROTECTED: {
    httpStatus: 403,
    defaultMessage: 'Diese Systemrolle ist geschützt und kann nicht geändert oder gelöscht werden.',
  },

  /**
   * Eingabe verletzt das vereinbarte Schema (Pfad-, Query- oder Körperwert).
   * 400: Der Aufrufer müsste die Anfrage ändern, ein Retry mit demselben
   * Inhalt hilft nicht. Die Meldung nennt das beanstandete Feld; der Code
   * bleibt derselbe, damit Freitext-Fehler gar nicht erst entstehen.
   */
  VALIDATION_FAILED: {
    httpStatus: 400,
    defaultMessage: 'Die Anfrage enthält ungültige Werte.',
  },

  // -- Server & Backups (Pflichtenheft §6, Lastenheft §3.3) ------------------

  /**
   * Gameserver existiert nicht (Pflichtenheft §6). 404: Zielobjekt nicht vorhanden.
   *
   * Bewusst derselbe Code, egal ob der Server nie existierte oder der Aufrufer
   * ihn nicht sehen darf – sonst verriete die Antwort die Existenz fremder Server.
   */
  SERVER_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieser Server existiert nicht.',
  },
  /** Backup existiert nicht (Pflichtenheft §6). 404, aus demselben Grund wie `SERVER_NOT_FOUND`. */
  BACKUP_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Sicherung existiert nicht.',
  },
  /**
   * Vorgang setzt ein abgeschlossenes Backup voraus (Wiederherstellen,
   * Herunterladen, Löschen). 409: Der Zustand passt gerade nicht, später kann
   * derselbe Aufruf klappen.
   */
  BACKUP_NOT_READY: {
    httpStatus: 409,
    defaultMessage: 'Diese Sicherung ist noch nicht abgeschlossen.',
  },
  /**
   * Für diesen Server läuft bereits ein Backup. 409: zwei gleichzeitige Läufe
   * würden denselben Datenordner lesen, während er sich ändert.
   */
  BACKUP_ALREADY_RUNNING: {
    httpStatus: 409,
    defaultMessage: 'Für diesen Server läuft bereits eine Sicherung.',
  },
  /**
   * Die beim Anlegen gebildete SHA-256-Prüfsumme (`Backup.checksumSha256`) stimmt
   * beim Wiederherstellen oder Herunterladen nicht mit dem tatsächlich gelesenen
   * Archiv überein (Lastenheft §3.3/§3.7, Fundpunkt 99). Das Archiv ist beschädigt
   * oder wurde verändert und darf nicht zurückgespielt bzw. als vollständig
   * ausgeliefert werden.
   * 422: Die Anfrage ist wohlgeformt und berechtigt, aber das referenzierte
   * Archiv ist nicht verarbeitbar – ein Retry mit demselben Archiv hilft nicht,
   * es muss neu gesichert werden. Bewusst getrennt von `AGENT_COMMAND_FAILED`
   * (unerwarteter Ausführungsfehler): Hier greift eine gezielte Integritätsprüfung.
   */
  BACKUP_CHECKSUM_MISMATCH: {
    httpStatus: 422,
    defaultMessage:
      'Die Prüfsumme des Archivs stimmt nicht mit der gespeicherten Sicherung überein. Das Backup ist beschädigt oder wurde verändert.',
  },
  /** Cron-Ausdruck einer geplanten Aufgabe ist ungültig (Pflichtenheft §6). 400. */
  SCHEDULE_INVALID_CRON: {
    httpStatus: 400,
    defaultMessage: 'Der Zeitplan ist kein gültiger Cron-Ausdruck.',
  },

  // -- Server-Orchestrierung (Pflichtenheft §9, §11, §13) --------------------
  // Arbeitspaket B3. Die Codes decken den Lifecycle, die Spiele-Registry und
  // die Subdomain-/DNS-Vergabe ab. Bereits weiter oben stehen und werden von B3
  // unverändert benutzt: `SERVER_NOT_FOUND` und `SUBDOMAIN_TAKEN` (B5),
  // `SERVER_STATE_CONFLICT` und `SUBDOMAIN_INVALID` (F3), `PORT_POOL_EXHAUSTED`
  // (B8). `RESOURCE_LIMIT_EXCEEDED` gehört zur Prüfung aus B4 (§10).

  /**
   * Der Crash-Loop-Schutz hat abgeschaltet: zu viele Abstürze im Zeitfenster
   * (Pflichtenheft §9). 409, nicht 503 – der Server bleibt bewusst aus, bis
   * jemand hinsieht; automatisches Wiederholen ist genau das, was verhindert
   * werden soll.
   */
  SERVER_CRASH_LOOP: {
    httpStatus: 409,
    defaultMessage: 'Der Server ist zu oft hintereinander abgestürzt und wurde deshalb angehalten.',
  },
  /**
   * Der Server wurde gestartet, war aber innerhalb der Startfrist nicht
   * erreichbar (Health-Check, Pflichtenheft §9). 504: Zeitüberschreitung
   * gegenüber einem nachgelagerten System.
   */
  SERVER_HEALTH_CHECK_FAILED: {
    httpStatus: 504,
    defaultMessage: 'Der Server war nach dem Start nicht erreichbar.',
  },
  /** Spiele-Definition existiert nicht (Pflichtenheft §11). 404. */
  GAME_TYPE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieser Spiel-Typ existiert nicht.',
  },
  /**
   * Spiele-Definition existiert, ist in dieser Ausbaustufe aber noch nicht
   * nutzbar (Lastenheft §3.5). 409 statt 404, damit das Frontend „gibt es
   * nicht" von „kommt später" unterscheiden kann.
   */
  GAME_TYPE_NOT_AVAILABLE: {
    httpStatus: 409,
    defaultMessage: 'Dieser Spiel-Typ steht in dieser Ausbaustufe noch nicht zur Verfügung.',
  },
  /**
   * Der DNS-Eintrag konnte bei Cloudflare nicht angelegt oder entfernt werden
   * (Pflichtenheft §13). 502: der Fehler liegt beim nachgelagerten Dienst.
   */
  DNS_UPDATE_FAILED: {
    httpStatus: 502,
    defaultMessage: 'Der DNS-Eintrag konnte nicht aktualisiert werden.',
  },
  // `PORT_POOL_EXHAUSTED` steht weiter unten bei den Admin-Funktionen (B8) –
  // dort liegt der Port-Pool. B3 benutzt den Code beim Anlegen eines Servers.

  // -- Agent-Protokoll (Pflichtenheft §2.2 / §5.3) ---------------------------
  // Der Agent-Kanal ist kein REST-Endpunkt; die HTTP-Status-Zuordnung gilt hier
  // für den WebSocket-Handshake bzw. dient dem Backend als Vorlage, wenn es
  // einen Agent-Fehler an eine REST-Antwort weiterreicht.

  /** Pre-Shared-Token fehlt oder ist falsch (Pflichtenheft §2.2). 401: nicht authentifiziert. */
  AGENT_UNAUTHORIZED: {
    httpStatus: 401,
    defaultMessage: 'Der Agent konnte sich nicht gegenüber dem Backend authentifizieren.',
  },
  /**
   * Agent und Backend sprechen unterschiedliche Protokollversionen
   * (`AGENT_PROTOCOL_VERSION`). 400: Die Gegenseite müsste den Frame ändern,
   * ein Retry mit demselben Inhalt hilft nicht.
   */
  AGENT_PROTOCOL_VERSION_MISMATCH: {
    httpStatus: 400,
    defaultMessage: 'Agent und Backend nutzen unterschiedliche Protokollversionen.',
  },
  /** Befehls-Frame verletzt das Schema (fehlende Korrelations-ID, falscher Typ, ...). 400. */
  AGENT_COMMAND_INVALID: {
    httpStatus: 400,
    defaultMessage: 'Der Agent-Befehl entspricht nicht dem vereinbarten Format.',
  },
  /** Ausführung des Befehls in der Container-Runtime ist fehlgeschlagen. 500. */
  AGENT_COMMAND_FAILED: {
    httpStatus: 500,
    defaultMessage: 'Die Ausführung des Befehls auf dem Homeserver ist fehlgeschlagen.',
  },
  /**
   * Befehl steht im Protokoll, ist auf dem Agent aber noch nicht gebaut
   * (aktuell: `CREATE_BACKUP`, `RESTORE_BACKUP`, `DOWNLOAD_BACKUP`,
   * `DELETE_BACKUP`, `GET_STORAGE_BREAKDOWN` – A3).
   * 501: bewusst getrennt von einem Ausführungsfehler, damit das Backend
   * „noch nicht gebaut" von „hat nicht funktioniert" unterscheiden kann.
   */
  AGENT_COMMAND_NOT_IMPLEMENTED: {
    httpStatus: 501,
    defaultMessage: 'Dieser Befehl wird vom Agent noch nicht unterstützt.',
  },

  // -- Zuordnung der Runtime-Fehler auf den API-Katalog ----------------------
  // Die Container-Runtime (A2) führt einen eigenen, agent-internen Katalog
  // (`RUNTIME_ERROR_CATALOG`) ohne HTTP-Status, weil sie keine HTTP-Antworten
  // liefert. Die Übersetzung auf die Codes hier passiert an genau einer Stelle:
  // `apps/agent/src/connection/runtime-adapter.ts`. Ohne diese Codes bliebe
  // jeder Runtime-Fehler ein pauschales AGENT_COMMAND_FAILED, und das Backend
  // könnte „Container weg" nicht von „Engine nicht erreichbar" unterscheiden.

  /** Container existiert nicht (mehr). 404: Zielobjekt nicht vorhanden. */
  AGENT_CONTAINER_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Der Container existiert auf dem Homeserver nicht.',
  },
  /** Vorgang setzt einen laufenden Container voraus (Konsole, Dateizugriff). 409. */
  AGENT_CONTAINER_NOT_RUNNING: {
    httpStatus: 409,
    defaultMessage: 'Der Server läuft nicht.',
  },
  /** Container ist für diesen Vorgang im falschen Zustand. 409: Konflikt mit vorhandenem Zustand. */
  AGENT_CONTAINER_STATE_CONFLICT: {
    httpStatus: 409,
    defaultMessage: 'Der Server ist für diesen Vorgang im falschen Zustand.',
  },
  /** Es existiert bereits ein Container mit diesem Namen. 409. */
  AGENT_CONTAINER_NAME_CONFLICT: {
    httpStatus: 409,
    defaultMessage: 'Auf dem Homeserver existiert bereits ein Container mit diesem Namen.',
  },
  /** Das angeforderte Container-Image liegt auf dem Homeserver nicht vor. 404. */
  AGENT_IMAGE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Das Container-Image ist auf dem Homeserver nicht vorhanden.',
  },
  /** Pfad ist ungültig oder zeigt aus dem erlaubten Bereich heraus. 400. */
  AGENT_INVALID_PATH: {
    httpStatus: 400,
    defaultMessage: 'Der Pfad ist ungültig oder liegt außerhalb des erlaubten Bereichs.',
  },
  /** Datei oder Verzeichnis im Container nicht gefunden. 404. */
  AGENT_FILE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Die Datei existiert auf dem Server nicht.',
  },
  /** Datei überschreitet die zulässige Größe (Pflichtenheft §12.1). 413. */
  AGENT_FILE_TOO_LARGE: {
    httpStatus: 413,
    defaultMessage: 'Die Datei ist größer als das erlaubte Limit.',
  },
  /**
   * Für die Ziel-Node ist derzeit kein Agent verbunden (Pflichtenheft §2.2).
   * 503: sobald der Agent sich wieder meldet, kann derselbe Aufruf klappen.
   */
  AGENT_NOT_CONNECTED: {
    httpStatus: 503,
    defaultMessage: 'Der Homeserver ist derzeit nicht verbunden.',
  },
  /**
   * Der Agent hat einen Befehl nicht innerhalb der Frist beantwortet
   * (Pflichtenheft §5.3). 504: Zeitüberschreitung gegenüber einem
   * nachgelagerten System – bewusst getrennt von `AGENT_COMMAND_FAILED`, denn
   * der Befehl kann auf dem Homeserver trotzdem noch laufen.
   */
  AGENT_COMMAND_TIMEOUT: {
    httpStatus: 504,
    defaultMessage: 'Der Homeserver hat auf den Befehl nicht rechtzeitig geantwortet.',
  },
  /** Container-Engine bzw. Docker-Socket-Proxy nicht erreichbar. 503: vorübergehend, ein Retry kann klappen. */
  AGENT_RUNTIME_UNAVAILABLE: {
    httpStatus: 503,
    defaultMessage: 'Die Container-Engine auf dem Homeserver ist nicht erreichbar.',
  },

  // -- Admin-Funktionen (Lastenheft §3.7 und §3.8) ---------------------------
  // Arbeitspaket B8: Nodes, öffentlicher Port-Pool (Pflichtenheft §2.4),
  // Audit-Log (§6), Storage-Explorer (§16) und Freischalt-Warteliste.

  /** Node-Name oder WireGuard-Adresse bereits vergeben. 409: Konflikt mit vorhandenem Zustand. */
  NODE_ADDRESS_TAKEN: {
    httpStatus: 409,
    defaultMessage: 'Name oder WireGuard-Adresse sind bereits für eine andere Node vergeben.',
  },
  /**
   * Node soll entfernt werden, trägt aber noch Gameserver. 409: erst die Server
   * löschen – sonst blieben Container ohne zuständige Node zurück.
   */
  NODE_IN_USE: {
    httpStatus: 409,
    defaultMessage: 'Auf dieser Node liegen noch Gameserver.',
  },
  /** Port-Bereich existiert nicht. 404. */
  PORT_RANGE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieser Port-Bereich existiert nicht.',
  },
  /**
   * Bereichsgrenzen sind unzulässig (Anfang größer als Ende, außerhalb des
   * erlaubten Fensters). 400: der Aufrufer müsste die Eingabe ändern.
   */
  PORT_RANGE_INVALID: {
    httpStatus: 400,
    defaultMessage: 'Der Port-Bereich ist ungültig.',
  },
  /**
   * Überschneidung mit einem bestehenden Bereich desselben Protokolls. 409:
   * sonst wäre nicht eindeutig, aus welchem Bereich ein Port stammt.
   */
  PORT_RANGE_OVERLAP: {
    httpStatus: 409,
    defaultMessage: 'Der Port-Bereich überschneidet sich mit einem bestehenden Bereich.',
  },
  /**
   * Bereich soll gelöscht oder verkleinert werden, obwohl daraus noch Ports
   * vergeben sind. 409: laufende Server verlören sonst ihre Adresse.
   */
  PORT_RANGE_IN_USE: {
    httpStatus: 409,
    defaultMessage: 'Aus diesem Port-Bereich sind noch Ports vergeben.',
  },
  /**
   * Im Pool ist kein freier Port mehr übrig (Pflichtenheft §2.4). 409: bewusst
   * getrennt von RESOURCE_LIMIT_EXCEEDED – hier fehlt kein Nutzer-Kontingent,
   * sondern der öffentliche Adressraum der VPS.
   */
  PORT_POOL_EXHAUSTED: {
    httpStatus: 409,
    defaultMessage: 'Im öffentlichen Port-Bereich ist kein freier Port mehr verfügbar.',
  },
  /** Port-Zuordnung existiert nicht. 404. */
  PORT_ALLOCATION_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Port-Zuordnung existiert nicht.',
  },
  /**
   * Für diese Node liegt noch keine Speicherübersicht vor (Pflichtenheft §16:
   * Scan on demand). 409: erst einen Scan anstoßen, dann erneut abrufen.
   */
  STORAGE_SCAN_MISSING: {
    httpStatus: 409,
    defaultMessage: 'Für diese Node liegt noch keine Speicherübersicht vor.',
  },
  /** Eintrag steht nicht in der zwischengespeicherten Speicherübersicht. 404. */
  STORAGE_ENTRY_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieser Eintrag steht nicht in der Speicherübersicht.',
  },
  /**
   * Eintrag ist über den Storage-Explorer nicht löschbar – insbesondere der
   * Datenordner eines aktiven Servers (Lastenheft §3.8). 403: die Aktion ist
   * grundsätzlich unzulässig, unabhängig von Berechtigungen; auch der Owner
   * darf sie nicht. Server-Datenordner verschwinden ausschließlich über den
   * dedizierten Server-Löschen-Vorgang.
   */
  STORAGE_ENTRY_NOT_DELETABLE: {
    httpStatus: 403,
    defaultMessage:
      'Dieser Eintrag kann über die Speicherverwaltung nicht gelöscht werden. Aktive Server-Datenordner werden ausschließlich über den Server-Löschen-Vorgang entfernt.',
  },
  /**
   * Versuch, einen Audit-Eintrag zu ändern oder zu löschen. 403: das Log ist
   * append-only (Pflichtenheft §6 und §18) – für niemanden, auch nicht
   * vorübergehend. Einträge verlassen die aktive Tabelle einzig über den
   * Archivierungsprozess.
   */
  AUDIT_ENTRY_IMMUTABLE: {
    httpStatus: 403,
    defaultMessage: 'Einträge im Audit-Log können nicht geändert oder gelöscht werden.',
  },
  /**
   * Der Archivierungslauf konnte die Archivdatei nicht schreiben. 500: die
   * aktive Tabelle bleibt in diesem Fall unverändert.
   */
  AUDIT_ARCHIVE_FAILED: {
    httpStatus: 500,
    defaultMessage: 'Das Archiv des Audit-Logs konnte nicht geschrieben werden.',
  },
  /**
   * Aktion am Owner-Konto, die dieses aussperren würde (sperren, Rollen
   * entziehen). 403: der Owner-Sonderstatus schützt genau davor
   * (Lastenheft §2, Pflichtenheft §8).
   */
  OWNER_PROTECTED: {
    httpStatus: 403,
    defaultMessage: 'Das Owner-Konto kann nicht gesperrt oder herabgestuft werden.',
  },
  /**
   * Es gibt bereits ein Owner-Konto und ein zweites soll den Status bekommen
   * (Lastenheft §2: genau ein Konto trägt ihn). 409: Konflikt mit vorhandenem
   * Zustand – der Vorgang ist nicht wiederholbar erfolgreich, solange der
   * bestehende Owner steht. Bewusst getrennt von `OWNER_PROTECTED`: dort geht
   * es um Aktionen *gegen* den Owner, hier um die Vergabe des Status selbst
   * (Ersteinrichtung, Pflichtenheft §12.3).
   */
  OWNER_ALREADY_EXISTS: {
    httpStatus: 409,
    defaultMessage: 'Es gibt bereits ein Owner-Konto. Genau ein Konto trägt diesen Status.',
  },
  /**
   * Wartelisten-Aktion passt nicht zum Zustand des Kontos, etwa die Freigabe
   * eines bereits freigegebenen Kontos. 409: Konflikt mit vorhandenem Zustand.
   */
  REGISTRATION_REQUEST_INVALID_STATE: {
    httpStatus: 409,
    defaultMessage: 'Das Konto ist für diese Aktion im falschen Zustand.',
  },

  // -- Notification-Engine (B6, Pflichtenheft §14) ----------------------------

  /** Benachrichtigungskanal existiert nicht. 404. */
  NOTIFICATION_CHANNEL_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Dieser Benachrichtigungskanal existiert nicht.',
  },
  /** Kanalname bereits vergeben. 409: Namen tragen die Auswahl im Regel-Editor. */
  NOTIFICATION_CHANNEL_NAME_TAKEN: {
    httpStatus: 409,
    defaultMessage: 'Ein Kanal mit diesem Namen existiert bereits.',
  },
  /**
   * Kanal ist nicht versandfähig: Er nutzt die Vorgabe aus der zentralen
   * `.env`, und `DISCORD_WEBHOOK_URL` ist dort nicht gesetzt (Pflichtenheft
   * §12.1). 409: Der Datensatz stimmt, die Umgebung nicht.
   */
  NOTIFICATION_CHANNEL_NOT_CONFIGURED: {
    httpStatus: 409,
    defaultMessage: 'Für diesen Kanal ist kein Ziel hinterlegt.',
  },
  /**
   * Kanal wird noch von mindestens einer Regel genutzt. 409: erst die Regeln
   * lösen, dann den Kanal entfernen – sonst verlöre eine Regel still ihr Ziel.
   */
  NOTIFICATION_CHANNEL_IN_USE: {
    httpStatus: 409,
    defaultMessage: 'Dieser Kanal wird noch von Benachrichtigungsregeln genutzt.',
  },
  /** Benachrichtigungsregel existiert nicht. 404. */
  NOTIFICATION_RULE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Benachrichtigungsregel existiert nicht.',
  },
  /**
   * Es gibt bereits eine Regel mit derselben Kombination aus Ereignis, Kanal
   * und Empfängerkreis. 409: Die zweite Regel würde nur Doppelmeldungen
   * erzeugen.
   */
  NOTIFICATION_RULE_DUPLICATE: {
    httpStatus: 409,
    defaultMessage: 'Für diese Kombination existiert bereits eine Regel.',
  },
  /**
   * Regel soll auf ein Ereignis hören, das keine Benachrichtigung auslöst –
   * etwa `server.statsUpdated` (Pflichtenheft §14, `NOTIFIABLE_EVENTS`). 400.
   */
  NOTIFICATION_EVENT_NOT_NOTIFIABLE: {
    httpStatus: 400,
    defaultMessage: 'Dieses Ereignis kann keine Benachrichtigung auslösen.',
  },
  /** Meldung existiert nicht oder gehört zu einem anderen Konto. 404. */
  NOTIFICATION_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Benachrichtigung existiert nicht.',
  },
  /**
   * Zustellung an den externen Kanal ist gescheitert (Discord nicht erreichbar
   * oder hat abgelehnt). 502: Der Fehler liegt beim nachgelagerten Dienst.
   *
   * Dieser Code erscheint ausschließlich dort, wo jemand die Zustellung
   * **selbst** angestoßen hat – bei der Testnachricht eines Admins. Beim
   * Zustellen zu einem ausgelösten Ereignis wird er nur protokolliert und
   * niemals weitergeworfen: Ein nicht erreichbarer Webhook darf einen
   * Serverstart oder ein Backup nicht scheitern lassen (Pflichtenheft §14).
   */
  NOTIFICATION_DELIVERY_FAILED: {
    httpStatus: 502,
    defaultMessage: 'Die Nachricht konnte nicht zugestellt werden.',
  },
  /** Systemweite Ankündigung existiert nicht. 404. */
  ANNOUNCEMENT_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Ankündigung existiert nicht.',
  },

  // -- Chat & Moderation (B7, Pflichtenheft §15) ------------------------------

  /**
   * Konversation existiert nicht **oder** der Aufrufer nimmt nicht an ihr teil.
   * 404 und bewusst nicht 403: Dass es zwischen zwei anderen Konten eine
   * Unterhaltung gibt, ist selbst schon eine Information (Pflichtenheft §15).
   */
  CONVERSATION_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Unterhaltung existiert nicht.',
  },
  /**
   * Empfänger einer Direktnachricht ist unzulässig – etwa das eigene Konto.
   * 400: die Anfrage selbst ergibt keinen Sinn.
   */
  CONVERSATION_RECIPIENT_INVALID: {
    httpStatus: 400,
    defaultMessage: 'Mit diesem Konto lässt sich keine Unterhaltung beginnen.',
  },
  /**
   * Empfänger ist nicht freigeschaltet oder gesperrt (Lastenheft §3.6:
   * Direktnachrichten „zwischen freigeschalteten Nutzern"). 403: das Konto
   * existiert, darf aber nicht angeschrieben werden.
   */
  CONVERSATION_RECIPIENT_NOT_ALLOWED: {
    httpStatus: 403,
    defaultMessage: 'Dieses Konto ist für Direktnachrichten nicht freigeschaltet.',
  },
  /**
   * Nachricht existiert nicht oder liegt in einer Konversation, an der der
   * Aufrufer nicht teilnimmt. 404, aus demselben Grund wie
   * `CONVERSATION_NOT_FOUND`.
   */
  MESSAGE_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Nachricht existiert nicht.',
  },
  /** Nachricht ist bereits gelöscht. 409: Konflikt mit vorhandenem Zustand. */
  MESSAGE_ALREADY_DELETED: {
    httpStatus: 409,
    defaultMessage: 'Diese Nachricht wurde bereits gelöscht.',
  },
  /**
   * Meldung existiert nicht. 404 – auch für Aufrufer mit `message.moderate`,
   * denn eine fremde Meldung ohne Berechtigung gibt es aus deren Sicht nicht.
   */
  MESSAGE_REPORT_NOT_FOUND: {
    httpStatus: 404,
    defaultMessage: 'Diese Meldung existiert nicht.',
  },
  /**
   * Dieselbe Nachricht wurde von demselben Konto bereits gemeldet. 409:
   * eine zweite Meldung bringt der Moderation nichts.
   */
  MESSAGE_REPORT_DUPLICATE: {
    httpStatus: 409,
    defaultMessage: 'Diese Nachricht hast du bereits gemeldet.',
  },
  /**
   * Melden ist an dieser Stelle nicht vorgesehen – etwa beim eigenen Beitrag.
   * 403: Die Nachricht ist sichtbar, die Meldung ergäbe trotzdem keinen Sinn.
   */
  MESSAGE_REPORT_NOT_ALLOWED: {
    httpStatus: 403,
    defaultMessage: 'Diese Nachricht lässt sich nicht melden.',
  },
  /** Über die Meldung wurde bereits entschieden. 409: Konflikt mit vorhandenem Zustand. */
  MESSAGE_REPORT_ALREADY_RESOLVED: {
    httpStatus: 409,
    defaultMessage: 'Über diese Meldung wurde bereits entschieden.',
  },
} as const satisfies Record<string, ErrorDefinition>;

/** Alle gültigen Fehlercodes als Typ – verhindert Freitext-Codes. */
export type ErrorCode = keyof typeof ERROR_CATALOG;

/**
 * Alle Fehlercodes zur Laufzeit (z. B. für Tests oder Admin-Übersichten).
 *
 * Bewusst als nicht-leeres Tupel typisiert, damit `@palantir/validation` die
 * Liste direkt an `z.enum()` übergeben kann.
 */
export const ERROR_CODES = Object.keys(ERROR_CATALOG) as [ErrorCode, ...ErrorCode[]];

/** HTTP-Status zu einem Fehlercode. */
export function httpStatusForErrorCode(code: ErrorCode): number {
  return ERROR_CATALOG[code].httpStatus;
}

/** Fallback-Meldung zu einem Fehlercode. */
export function defaultMessageForErrorCode(code: ErrorCode): string {
  return ERROR_CATALOG[code].defaultMessage;
}

/** Prüft, ob ein beliebiger String ein bekannter Fehlercode ist. */
export function isErrorCode(value: string): value is ErrorCode {
  return Object.prototype.hasOwnProperty.call(ERROR_CATALOG, value);
}
