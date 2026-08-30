/**
 * Fehler der Container-Runtime.
 *
 * Wie im Fehlercode-Katalog des Backends (Pflichtenheft §5.1) gilt auch hier:
 * **kein Freitext-Fehler**, sondern ein benannter Code aus einem festen,
 * wachsenden Katalog (CLAUDE.md §5).
 *
 * Bewusste Abgrenzung: `ERROR_CATALOG` in `packages/contracts` beschreibt
 * HTTP-Fehler der REST-API. Die Codes hier sind agent-intern und tragen keinen
 * HTTP-Status - der Agent liefert keine HTTP-Antworten. Die Zuordnung
 * agent-interner Codes auf API-Fehlercodes gehoert in die Protokollschicht
 * (A1) bzw. in die Server-Orchestrierung (B3); siehe WORK_STATUS.md,
 * "Gefundene Punkte".
 */

export const RUNTIME_ERROR_CATALOG = {
  /** Container mit dieser ID/diesem Namen existiert nicht (mehr). */
  CONTAINER_NOT_FOUND: 'Der Container existiert nicht.',
  /** Das angeforderte Image liegt nicht lokal vor. */
  IMAGE_NOT_FOUND: 'Das Container-Image ist auf dem Host nicht vorhanden.',
  /** Es existiert bereits ein Container mit diesem Namen. */
  CONTAINER_NAME_CONFLICT: 'Es existiert bereits ein Container mit diesem Namen.',
  /** Operation setzt einen laufenden Container voraus (Konsole, Dateizugriff). */
  CONTAINER_NOT_RUNNING: 'Der Container laeuft nicht.',
  /** Der Container ist fuer diesen Vorgang im falschen Zustand (z. B. Loeschen waehrend er laeuft). */
  CONTAINER_STATE_CONFLICT: 'Der Container ist fuer diesen Vorgang im falschen Zustand.',
  /** Der uebergebene Container-Spec verletzt die Vorgaben (Ressourcen, Pfade, Ports). */
  INVALID_CONTAINER_SPEC: 'Die Container-Konfiguration ist ungueltig.',
  /** Pfad zeigt aus dem erlaubten Bereich heraus oder ist syntaktisch ungueltig. */
  INVALID_PATH: 'Der Pfad ist ungueltig oder liegt ausserhalb des erlaubten Bereichs.',
  /** Datei oder Verzeichnis im Container nicht gefunden. */
  FILE_NOT_FOUND: 'Die Datei existiert im Container nicht.',
  /** Datei ueberschreitet die zulaessige Groesse fuer Lesen/Schreiben. */
  FILE_TOO_LARGE: 'Die Datei ist groesser als das erlaubte Limit.',
  /**
   * Der Zielpfad eines Uploads ist bereits belegt und `overwrite` ist nicht
   * gesetzt (`FILE_UPLOAD`, Arbeitspaket P2).
   *
   * Bewusst nur beim Upload und nicht beim Schreiben: `writeFile` gehoert zum
   * eingebauten Editor und ueberschreibt still, weil dort genau die Datei
   * zurueckgespeichert wird, die vorher gelesen wurde. Ein Upload legt dagegen
   * eine neue Datei ab - dass dabei unbemerkt eine gleichnamige verschwindet,
   * waere ein Datenverlust ohne Rueckfrage.
   */
  FILE_EXISTS: 'Am Zielpfad existiert bereits eine Datei.',
  /** Container-Engine bzw. Docker-Socket-Proxy nicht erreichbar. */
  RUNTIME_UNAVAILABLE: 'Die Container-Engine ist nicht erreichbar.',
  /**
   * Ein gelesenes Archiv stimmt nicht mit der erwarteten SHA-256-Pruefsumme
   * ueberein (Backup-Wiederherstellung, Fundpunkt 99). Das Archiv ist beschaedigt
   * oder wurde veraendert und darf nicht zurueckgespielt werden.
   */
  CHECKSUM_MISMATCH: 'Die Pruefsumme des Archivs stimmt nicht mit der erwarteten ueberein.',
  /** Alles Uebrige, was die Engine als Fehler meldet. */
  RUNTIME_ERROR: 'Die Container-Engine hat den Vorgang abgelehnt.',
} as const satisfies Record<string, string>;

export type ContainerRuntimeErrorCode = keyof typeof RUNTIME_ERROR_CATALOG;

export const RUNTIME_ERROR_CODES = Object.keys(RUNTIME_ERROR_CATALOG) as [
  ContainerRuntimeErrorCode,
  ...ContainerRuntimeErrorCode[],
];

export function isContainerRuntimeErrorCode(value: string): value is ContainerRuntimeErrorCode {
  return Object.prototype.hasOwnProperty.call(RUNTIME_ERROR_CATALOG, value);
}

export interface ContainerRuntimeErrorOptions {
  /** Eigene Meldung; ohne Angabe greift die Fallback-Meldung aus dem Katalog. */
  readonly message?: string;
  readonly cause?: unknown;
  /** Zusatzangaben fuer das Log (Container-ID, Pfad, HTTP-Status der Engine, ...). */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Einziger Fehlertyp, den die Container-Runtime nach aussen wirft. */
export class ContainerRuntimeError extends Error {
  readonly code: ContainerRuntimeErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ContainerRuntimeErrorCode, options: ContainerRuntimeErrorOptions = {}) {
    super(options.message ?? RUNTIME_ERROR_CATALOG[code], { cause: options.cause });
    this.name = 'ContainerRuntimeError';
    this.code = code;
    this.details = options.details ?? {};
  }
}

export function isContainerRuntimeError(value: unknown): value is ContainerRuntimeError {
  return value instanceof ContainerRuntimeError;
}
