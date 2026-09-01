/**
 * Sicherungen des Panels selbst (Mockup-Abgleich 12.5.1 und 12.5.2).
 *
 * **Abgrenzung, die im Namen nicht steckt:** Gesichert wird die
 * **Panel-Datenbank** – Konten, Rollen, Server-Datensätze, Kontingente, das
 * Audit-Log. Die Weltdaten der Gameserver sind das **nicht**: Die liegen auf
 * dem Homeserver und haben mit den Server-Backups (Lastenheft §3.3) einen
 * eigenen, vollständigen Weg. Zwei Mechanismen für dieselben Daten wären zwei
 * Wahrheiten über den Stand einer Sicherung.
 *
 * Das Panel läuft auf der VPS, die Weltdaten auf dem Homeserver – die Trennung
 * folgt also der Betriebswirklichkeit und nicht nur einer Vorliebe.
 *
 * Eine Erweiterung des Funktionsumfangs: Das Lastenheft verlangt eine globale
 * Backup-Übersicht (§3.7), nicht die Sicherung des Panels. Ausdrücklich vom
 * Betreiber beauftragt.
 */

/** Wer den Lauf ausgelöst hat. */
export type PanelBackupTrigger = 'manual' | 'scheduled';

/**
 * Zustand eines Laufs.
 *
 * `running` ist ein echter Zustand und kein Zwischenschritt: Ein Dump der
 * Datenbank dauert, und die Übersicht soll ihn währenddessen zeigen.
 */
export type PanelBackupStatus = 'running' | 'completed' | 'failed';

export const PANEL_BACKUP_STATUSES: readonly PanelBackupStatus[] = [
  'running',
  'completed',
  'failed',
] as const;

/** Was der Aufrufer mit einer Sicherung tun darf (Pflichtenheft §5.2). */
export interface PanelBackupPermissions {
  /** Löschen – verlangt `admin.backup.manage` und einen abgeschlossenen Lauf. */
  canDelete: boolean;
}

export interface PanelBackupDto {
  id: string;
  status: PanelBackupStatus;
  trigger: PanelBackupTrigger;
  /**
   * Ablageort auf der VPS.
   *
   * Steht bewusst nur in der Admin-Ansicht und wird **nicht** zum Herunterladen
   * angeboten: Der Dump enthält jedes Konto, jede Rolle und jedes Geheimnis der
   * Instanz. Wer ihn braucht, holt ihn über den Weg, über den er auch die VPS
   * verwaltet – nicht über eine Web-Route.
   */
  storagePath: string | null;
  /** Größe der Datei in Byte; `0`, solange der Lauf läuft. */
  sizeBytes: number;
  /** Klartext-Grund bei `failed`; `null` sonst. */
  failureMessage: string | null;
  /** ISO-8601-Zeitstempel. */
  startedAt: string;
  completedAt: string | null;
  permissions: PanelBackupPermissions;
}
