/**
 * B5 – Backup-Verwaltung (Lastenheft §3.3 und §3.7, Pflichtenheft §6, STRUKTUR.md).
 *
 * Umfang:
 * - manuelle Backups auf Knopfdruck und geplante, automatische Backups
 * - die Aufbewahrungsregel aus Lastenheft §3.3 (`retention.ts`, mit Tests)
 * - Wiederherstellen eines Backups
 * - vollständiger Export/Download aller Serverdaten
 * - globale Übersicht inklusive Speicherverbrauch (Admin-Ansicht F10)
 * - Ereignis `backup.failed` (Konsument: B6)
 *
 * **Was dieses Modul nicht tut:** Es fasst keine Datei des Homeservers an. Jede
 * Ausführung läuft über den Agent (`CREATE_BACKUP`, `RESTORE_BACKUP`,
 * `DOWNLOAD_BACKUP`, `DELETE_BACKUP` aus `@palantir/contracts`); das Backend
 * orchestriert nur.
 *
 * **Abgrenzung zum Storage-Explorer (B8, Pflichtenheft §16):** Die Übersicht
 * hier zählt Backups aus der eigenen Tabelle. Der Storage-Explorer misst das
 * Dateisystem des Homeservers (`GET_STORAGE_BREAKDOWN`) inklusive
 * Server-Datenordnern, Docker-Images und verwaisten Daten. Beide Sichten
 * ergänzen sich. Löscht B8 ein Backup über seine Oberfläche, läuft das über
 * `BackupService.remove()` – damit bleiben Datensatz und Archiv im Gleichschritt
 * und die Rechteprüfung greift an einer Stelle.
 *
 * **Offene Anschlüsse** (in WORK_STATUS.md unter „Gefundene Punkte“ vermerkt):
 * `ServerDirectory` und `BackupAgentGateway` erwarten ihre Umsetzung aus B3,
 * `BackupEventPublisher` seine aus B6.
 */

export { BackupError, ScheduleError, isBackupError, isScheduleError } from './errors.js';

export {
  type ParsedCronExpression,
  cronMatches,
  isValidCronExpression,
  nextCronRun,
  parseCronExpression,
} from './cron.js';

export {
  type RetentionCandidate,
  type RetentionOptions,
  isRetentionProtected,
  newestProtectedAutomaticBackup,
  retentionCutoff,
  retentionExpiresAt,
  selectExpiredBackups,
} from './retention.js';

export {
  type BackupAgentGateway,
  type BackupEventPublisher,
  type BackupServerRecord,
  type Clock,
  type JobRunner,
  type ServerDirectory,
  type ServerExportManifestSource,
  type UserDirectory,
  fireAndForgetJobRunner,
  noopEventPublisher,
  systemClock,
} from './ports.js';

export {
  canManageBackupsOf,
  computeBackupOverviewPermissions,
  computeBackupPermissions,
  computeBackupSchedulePermissions,
  isOwnServer,
} from './permissions.js';

export {
  type BackupFilter,
  type BackupRecord,
  type BackupRepository,
  type BackupScheduleRecord,
  type BackupTotals,
  type CreateBackupData,
  type StorageAggregate,
  type UpdateBackupData,
  type UpsertBackupScheduleData,
  createDrizzleBackupRepository,
  createDrizzleUserDirectory,
} from './repository.js';

export {
  DOWNLOAD_CHUNK_BYTES,
  type BackupDownload,
  type BackupDownloadChunk,
  type BackupService,
  type BackupServiceOptions,
  type RetentionOutcome,
  createBackupService,
} from './service.js';

export {
  type BackupScheduleService,
  type BackupScheduleServiceOptions,
  type ScheduleTickResult,
  createBackupScheduleService,
} from './schedules.js';

export { type BackupRoutesOptions, registerBackupRoutes } from './routes.js';
