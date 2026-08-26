/**
 * Backup-DTOs (Pflichtenheft §5.2 und §6, Lastenheft §3.3).
 *
 * Ein `Backup` ist die Sicherung **eines** Gameservers. Erzeugt wird sie immer
 * auf dem Homeserver durch den Agent (`CREATE_BACKUP`); das Backend orchestriert
 * nur und greift selbst nie auf Dateien zu (Pflichtenheft §2.3, STRUKTUR.md B5/A3).
 *
 * **Aufbewahrungsregel (Lastenheft §3.3), wörtlich:**
 * - automatische Backups älter als 7 Tage werden gelöscht
 * - das neueste automatische Backup bleibt immer erhalten, auch wenn es älter ist
 * - manuell erstellte Backups sind von der automatischen Löschung ausgenommen
 *   und müssen aktiv entfernt werden
 *
 * Die Auswertung dieser Regel liegt an genau einer Stelle im Backend
 * (`apps/backend/src/modules/backups/retention.ts`). Hier steht nur, was das
 * Frontend braucht, um sie anzuzeigen: `type`, `retentionProtected` und
 * `expiresAt`.
 *
 * Änderungen sind bevorzugt additiv (neue optionale Felder).
 */

import { type ErrorCode } from './errors.js';

/**
 * Auslöser eines Backups (Pflichtenheft §6, Feld `Backup.type`).
 *
 * Genau diese Unterscheidung trägt die Aufbewahrungsregel aus Lastenheft §3.3 –
 * deshalb sind es bewusst nur zwei Werte und nicht etwa zusätzlich „Export".
 * Ein Datenexport ist ein manuelles Backup mit gesetztem `isExport`.
 */
export const BACKUP_TYPES = ['manual', 'automatic'] as const;

export type BackupType = (typeof BACKUP_TYPES)[number];

/**
 * Zustand eines Backup-Vorgangs.
 *
 * `pending` → der Auftrag steht, der Agent hat ihn noch nicht angenommen;
 * `running` → der Agent arbeitet; `completed` → Archiv liegt vor;
 * `failed` → abgebrochen, es gibt kein verwendbares Archiv (Event `backup.failed`).
 */
export const BACKUP_STATUSES = ['pending', 'running', 'completed', 'failed'] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];

/** Zustände, in denen der Vorgang noch läuft und das Archiv nicht nutzbar ist. */
export const PENDING_BACKUP_STATUSES = ['pending', 'running'] as const;

export type PendingBackupStatus = (typeof PENDING_BACKUP_STATUSES)[number];

/**
 * Aufbewahrungsfrist automatischer Backups in Tagen (Lastenheft §3.3).
 *
 * Bewusst eine Konstante im Vertrag und keine Konfigurationsvariable: das
 * Lastenheft nennt die sieben Tage als feste fachliche Regel. Das Frontend
 * beschriftet damit die Backup-Ansichten (F3, F4, F10), ohne die Zahl selbst zu
 * kennen.
 */
export const AUTOMATIC_BACKUP_RETENTION_DAYS = 7;

/**
 * Serverseitig berechnetes `permissions`-Objekt eines Backups (Pflichtenheft §5.2).
 *
 * Grundlage sind `backup.manage.own` / `backup.manage.any` (Pflichtenheft §8);
 * zusätzlich fließt der Zustand ein – ein noch laufendes Backup lässt sich weder
 * wiederherstellen noch herunterladen.
 */
export interface BackupPermissions {
  canView: boolean;
  /** Wiederherstellen; setzt `status === 'completed'` voraus. */
  canRestore: boolean;
  canDelete: boolean;
  /** Archiv herunterladen – der vollständige Datenexport aus Lastenheft §3.3. */
  canDownload: boolean;
}

/** Backup (Pflichtenheft §6, Entität `Backup`). */
export interface BackupDto {
  id: string;
  /**
   * Gesicherter Server.
   *
   * `null`, sobald der Server gelöscht wurde: Der Fremdschlüssel auf
   * `game_servers` löscht bewusst **nicht** mit, sondern setzt die Spalte auf
   * `NULL` (`ON DELETE SET NULL`) – ein Backup soll seinen Server überleben
   * (Lastenheft §3.3). Maßgeblich für `.own`/`.any` ist dann `ownerId`.
   */
  serverId: string | null;
  /** Anzeigename des Servers; `null`, wenn für den Aufrufer nicht auflösbar oder der Server gelöscht ist. */
  serverName: string | null;
  /** Besitzer des gesicherten Servers – maßgeblich für `.own`/`.any`. */
  ownerId: string;
  ownerDisplayName: string | null;
  type: BackupType;
  status: BackupStatus;
  /**
   * Vom Nutzer angestoßener Volldatenexport („Datenmitnahme ohne Abhängigkeit",
   * Lastenheft §3.3). Technisch ein manuelles Backup – die Kennzeichnung dient
   * allein der Beschriftung in der Oberfläche.
   */
  isExport: boolean;
  /** Größe des Archivs in Byte; `0`, solange der Vorgang läuft. */
  sizeBytes: number;
  /**
   * Ablageort des Archivs auf dem Homeserver.
   *
   * `null`, solange kein Archiv existiert, und `null` für Aufrufer ohne
   * `backup.manage.any`: der Pfad ist Betriebswissen der Node und gehört nicht
   * in die Nutzeransicht.
   */
  storagePath: string | null;
  /** SHA-256 des Archivs; `null`, solange kein Archiv existiert. */
  checksumSha256: string | null;
  /** Auslösender Nutzer; `null` bei geplanten (automatischen) Backups. */
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Benannter Fehlercode bei `status === 'failed'`, sonst `null` – nie Freitext (CLAUDE.md §5). */
  failureCode: ErrorCode | null;
  failureMessage: string | null;
  /**
   * Von der automatischen Löschung ausgenommen (Lastenheft §3.3): jedes manuelle
   * Backup sowie das jeweils neueste automatische Backup des Servers.
   */
  retentionProtected: boolean;
  /**
   * Zeitpunkt, ab dem die automatische Löschung greift (ISO-8601).
   * `null` bei `retentionProtected === true`.
   */
  expiresAt: string | null;
  permissions: BackupPermissions;
}

// ---------------------------------------------------------------------------
// Globale Backup-Übersicht (Lastenheft §3.7, Admin-Ansicht F10)
// ---------------------------------------------------------------------------

/**
 * Speicherverbrauch einer Gruppe (ein Nutzer bzw. ein Server).
 *
 * **Abgrenzung zum Storage-Explorer (B8, Pflichtenheft §16):** Die Zahlen hier
 * stammen aus der Backup-Tabelle des Backends und beschreiben ausschließlich
 * Backups. Der Storage-Explorer misst dagegen das Dateisystem des Homeservers
 * (`GET_STORAGE_BREAKDOWN`) inklusive Server-Datenordnern, Docker-Images und
 * verwaisten Daten. Beide Sichten ergänzen sich; keine ersetzt die andere.
 */
export interface BackupStorageBucket {
  /**
   * Nutzer- bzw. Server-Id.
   *
   * In `perServer` `null` für die Sammelgruppe der Backups, deren Server bereits
   * gelöscht ist (`BackupDto.serverId === null`). In `perUser` nie `null` –
   * `owner_id` hängt am Konto und bleibt erhalten.
   */
  id: string | null;
  /** Anzeigename; `null`, wenn nicht auflösbar. */
  name: string | null;
  backupCount: number;
  totalSizeBytes: number;
}

/** `permissions`-Objekt der globalen Übersicht (Pflichtenheft §5.2). */
export interface BackupOverviewPermissions {
  /** Backups fremder Nutzer löschen und wiederherstellen (`backup.manage.any`). */
  canManageAny: boolean;
}

/**
 * Globale Backup-Übersicht inklusive Speicherverbrauch (Lastenheft §3.7).
 *
 * Enthält immer den vollständigen Datensatz (Pflichtenheft §5.2); welche Kacheln
 * die Admin-Ansicht daraus baut, entscheidet das Frontend.
 */
export interface BackupOverviewDto {
  totalCount: number;
  totalSizeBytes: number;
  manualCount: number;
  manualSizeBytes: number;
  automaticCount: number;
  automaticSizeBytes: number;
  /** Fehlgeschlagene Backups – Aufhänger für die Fehlersuche in F10. */
  failedCount: number;
  /** Backups, die gerade laufen oder auf den Agent warten. */
  pendingCount: number;
  perUser: BackupStorageBucket[];
  perServer: BackupStorageBucket[];
  /** ISO-8601-Zeitstempel der Auswertung. */
  generatedAt: string;
  permissions: BackupOverviewPermissions;
}
