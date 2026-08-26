/**
 * Datei-Manager eines Servers (Lastenheft §3.3).
 *
 * Der Agent liefert Verzeichnisinhalte als `AgentFileEntry` (Container-Sicht).
 * Was das Frontend sieht, ist bewusst ein eigener DTO: er trägt zusätzlich die
 * Grenzen, die für die Oberfläche gelten – vor allem die **maximale
 * Upload-Größe pro Datei**, die laut Pflichtenheft §12.1 über die
 * Umgebungsvariable `MAX_UPLOAD_SIZE_BYTES` konfiguriert wird und deshalb
 * niemals im Frontend hartkodiert werden darf.
 */

export const SERVER_FILE_ENTRY_TYPES = ['file', 'directory', 'symlink'] as const;

export type ServerFileEntryType = (typeof SERVER_FILE_ENTRY_TYPES)[number];

export interface ServerFileEntryDto {
  name: string;
  /** Pfad relativ zum Datenordner des Servers, z. B. `world/level.dat`. */
  path: string;
  type: ServerFileEntryType;
  sizeBytes: number;
  /** ISO-8601-Zeitstempel der letzten Änderung. */
  modifiedAt: string;
  /** Im eingebauten Editor bearbeitbar (Textdatei innerhalb der Größengrenze). */
  editable: boolean;
  /** Einzeln herunterladbar. */
  downloadable: boolean;
}

/** Inhalt eines Verzeichnisses samt der Grenzen, die dort gelten. */
export interface ServerFileListDto {
  serverId: string;
  /** Aufgelistetes Verzeichnis, relativ zum Datenordner; `''` ist die Wurzel. */
  path: string;
  /** Übergeordnetes Verzeichnis; `null` in der Wurzel. */
  parentPath: string | null;
  entries: ServerFileEntryDto[];
  /** Darf der Aufrufer hier schreiben (hochladen, bearbeiten, löschen)? */
  writable: boolean;
  /**
   * Maximale Upload-Größe **pro Datei** in Bytes (Pflichtenheft §12.1,
   * `MAX_UPLOAD_SIZE_BYTES`). Kommt immer vom Backend.
   */
  maxUploadBytes: number;
  /** Obergrenze, bis zu der eine Datei im Editor geöffnet wird. */
  maxEditableBytes: number;
}

/** Inhalt einer einzelnen Datei für den eingebauten Editor. */
export interface ServerFileContentDto {
  serverId: string;
  path: string;
  content: string;
  sizeBytes: number;
  /** ISO-8601-Zeitstempel der letzten Änderung beim Lesen. */
  modifiedAt: string;
  writable: boolean;
}
