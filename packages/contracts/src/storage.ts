/**
 * Speicherverwaltung / Storage-Explorer (Lastenheft §3.8, Pflichtenheft §16).
 *
 * Der Agent liefert per `GET_STORAGE_BREAKDOWN` eine rohe Aufstellung des
 * belegten Speichers (`AgentStorageEntry` in `agent-commands.ts`). Das Backend
 * reichert sie mit dem an, was nur es weiß – ob ein Datenordner zu einem noch
 * existierenden Server gehört, ob ein Backup manuell erstellt wurde – und
 * liefert daraus die DTOs dieser Datei aus.
 *
 * **Kernregel (Lastenheft §3.8):** Aktive Server-Datenordner sind über diese
 * Ansicht **nicht** löschbar – nur über den dedizierten Server-Löschen-Vorgang.
 * Löschbar sind ausschließlich Backups, ungenutzte Docker-Images und eindeutig
 * verwaiste Daten. Die Entscheidung darüber trifft das Backend und liefert sie
 * als `permissions.canDelete` mit; das Frontend leitet nichts selbst ab.
 *
 * Der Scan läuft **on demand** und nicht dauerhaft im Hintergrund
 * (Pflichtenheft §16); das Ergebnis wird mit Zeitstempel zwischengespeichert.
 */

/**
 * Art eines Eintrags in der Speicherübersicht.
 *
 * - `serverData` – Datenordner eines Gameservers
 * - `backup` – Backup-Archiv eines Servers
 * - `dockerImage` – Container-Image auf dem Homeserver
 * - `orphaned` – eindeutig verwaiste Daten (kein Server, kein Backup dazu)
 * - `other` – belegter Speicher, der sich keiner Kategorie zuordnen lässt
 */
export type StorageEntryKind = 'serverData' | 'backup' | 'dockerImage' | 'orphaned' | 'other';

export const STORAGE_ENTRY_KINDS = [
  'serverData',
  'backup',
  'dockerImage',
  'orphaned',
  'other',
] as const satisfies readonly StorageEntryKind[];

export function isStorageEntryKind(value: string): value is StorageEntryKind {
  return (STORAGE_ENTRY_KINDS as readonly string[]).includes(value);
}

/**
 * Grund, warum ein Eintrag nicht löschbar ist.
 *
 * Benannter Code statt Freitext, damit das Frontend die Erklärung übersetzen
 * und nicht nur durchreichen muss (CLAUDE.md §5).
 */
export type StorageDeleteBlockReason =
  /** Datenordner eines noch existierenden Servers (Lastenheft §3.8). */
  | 'activeServerData'
  /** Docker-Image, das von mindestens einem Container benutzt wird. */
  | 'imageInUse'
  /** Kategorie `other`: nicht eindeutig zuzuordnen, deshalb nicht zum Löschen freigegeben. */
  | 'notClearlyOrphaned'
  /** Dem Aufrufer fehlt `node.manage`. */
  | 'permissionMissing';

/** `permissions`-Objekt eines Speicher-Eintrags (Pflichtenheft §5.2). */
export interface StorageEntryPermissions {
  canView: boolean;
  /**
   * Löschen über den Storage-Explorer. Bei `serverData` immer `false` – auch
   * für den Owner (Lastenheft §3.8).
   */
  canDelete: boolean;
}

/** Ein einzelner Posten der Speicherübersicht. */
export interface StorageEntryDto {
  /** Stabile Kennung des Eintrags innerhalb eines Scans (Pfad bzw. Image-Id). */
  id: string;
  kind: StorageEntryKind;
  /** Anzeigename, z. B. Servername, Backup-Bezeichnung oder Image-Tag. */
  label: string;
  /** Pfad auf dem Homeserver; `null` bei Docker-Images. */
  path: string | null;
  sizeBytes: number;
  /** Zugehöriger Gameserver, sofern zuordenbar. */
  serverId: string | null;
  /** Zugehöriges Backup, sofern zuordenbar. */
  backupId: string | null;
  /** Image-Tag bei `dockerImage`, sonst `null`. */
  imageTag: string | null;
  /** Ob der Posten aktuell benutzt wird (laufender Server, verwendetes Image). */
  inUse: boolean;
  /** Letzte Änderung als ISO-8601; `null`, wenn nicht ermittelbar. */
  lastModifiedAt: string | null;
  /** `null`, wenn der Eintrag löschbar ist. */
  deleteBlockedReason: StorageDeleteBlockReason | null;
  permissions: StorageEntryPermissions;
}

/** Summe je Kategorie – für die Übersicht ganz oben in F10. */
export interface StorageCategorySummaryDto {
  kind: StorageEntryKind;
  sizeBytes: number;
  entryCount: number;
}

/**
 * Vollständige Speicherübersicht einer Node zu einem Zeitpunkt.
 *
 * `scannedAt` ist der Zeitstempel des Agent-Scans, nicht der Abrufzeitpunkt –
 * die Oberfläche zeigt damit an, wie alt die Zahlen sind (Pflichtenheft §16).
 */
export interface StorageBreakdownDto {
  nodeId: string;
  /** ISO-8601-Zeitstempel des Scans. */
  scannedAt: string;
  /** Gesamtgröße des Datenträgers auf dem Homeserver. */
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  categories: StorageCategorySummaryDto[];
  entries: StorageEntryDto[];
}

/** `permissions`-Objekt der Speicherübersicht (Pflichtenheft §5.2). */
export interface StorageSnapshotPermissions {
  canView: boolean;
  /** Neuen Scan anstoßen (`node.manage`). */
  canScan: boolean;
}

/**
 * Zwischengespeicherte Speicherübersicht.
 *
 * `breakdown` ist `null`, solange für diese Node noch nie ein Scan gelaufen ist –
 * das ist der Normalfall direkt nach der Ersteinrichtung, kein Fehler.
 */
export interface StorageSnapshotDto {
  nodeId: string;
  breakdown: StorageBreakdownDto | null;
  /** Alter des Scans in Sekunden; `null`, wenn noch keiner gelaufen ist. */
  ageSeconds: number | null;
  permissions: StorageSnapshotPermissions;
}
