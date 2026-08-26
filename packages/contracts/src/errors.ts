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
  /** Cron-Ausdruck einer geplanten Aufgabe ist ungültig (Pflichtenheft §6). 400. */
  SCHEDULE_INVALID_CRON: {
    httpStatus: 400,
    defaultMessage: 'Der Zeitplan ist kein gültiger Cron-Ausdruck.',
  },

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
   * Wartelisten-Aktion passt nicht zum Zustand des Kontos, etwa die Freigabe
   * eines bereits freigegebenen Kontos. 409: Konflikt mit vorhandenem Zustand.
   */
  REGISTRATION_REQUEST_INVALID_STATE: {
    httpStatus: 409,
    defaultMessage: 'Das Konto ist für diese Aktion im falschen Zustand.',
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
