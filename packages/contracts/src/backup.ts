/**
 * Sicherungen eines Servers (Lastenheft §3.3, `Backup` in Pflichtenheft §6).
 *
 * Die Aufbewahrungsregel steht im Lastenheft: **automatische** Sicherungen älter
 * als sieben Tage werden gelöscht, die jeweils neueste bleibt immer erhalten;
 * **manuell** erstellte sind davon ausgenommen und müssen aktiv entfernt werden.
 * Der DTO trägt das Ergebnis dieser Regel als `expiresAt` mit, damit das
 * Frontend sie nicht nachbilden muss.
 */

/** Auslöser einer Sicherung (`Backup.type`). */
export const BACKUP_TRIGGERS = ['manual', 'scheduled', 'automatic'] as const;

export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** Verarbeitungszustand einer Sicherung. */
export const BACKUP_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];

/** Was der Aufrufer mit dieser Sicherung tun darf (Pflichtenheft §5.2). */
export interface BackupPermissions {
  canRestore: boolean;
  canDelete: boolean;
  /** Herunterladen als Teil der Datenmitnahme (Lastenheft §4). */
  canDownload: boolean;
}

export interface BackupDto {
  id: string;
  serverId: string;
  /** Anzeigename des Servers – trägt die globale Ansicht „Meine Backups" (F4). */
  serverName: string;
  trigger: BackupTrigger;
  status: BackupStatus;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  /** Größe in Bytes; `null`, solange die Sicherung noch läuft. */
  sizeBytes: number | null;
  /** Fehlertext bei `status === 'failed'`; sonst `null`. */
  statusMessage: string | null;
  /**
   * Zeitpunkt der automatischen Löschung als ISO-8601. `null` bedeutet: bleibt
   * erhalten, bis sie aktiv entfernt wird (manuelle Sicherung oder die jeweils
   * neueste automatische).
   */
  expiresAt: string | null;
  permissions: BackupPermissions;
}
