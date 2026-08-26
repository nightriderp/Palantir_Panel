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
   * (aktuell: `CREATE_BACKUP`, `RESTORE_BACKUP`, `GET_STORAGE_BREAKDOWN` – A3).
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
