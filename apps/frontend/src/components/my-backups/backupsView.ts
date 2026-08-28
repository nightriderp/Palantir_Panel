import { type BackupDto, type BackupStatus, type BackupType } from '@palantir/contracts';
import { type Tone } from '@/components/shared';

/**
 * Reine Anzeige-Logik für „Meine Backups" (Arbeitspaket F4).
 *
 * Bewusst ohne React und ohne Datumsformatierung, damit alles hier direkt
 * testbar ist (siehe `backupsView.test.ts`). Die eigentliche Aufbewahrungsregel
 * (Lastenheft §3.3) wertet das Backend aus (B5) – hier wird ausschließlich das
 * Ergebnis am Datensatz (`retentionProtected`, `expiresAt`, `status`) in einen
 * Anzeigezustand übersetzt.
 */

export const BACKUP_TYPE_LABELS: Record<BackupType, string> = {
  manual: 'Manuell',
  automatic: 'Automatisch',
};

export const BACKUP_STATUS_META: Record<BackupStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Wartet', tone: 'warning' },
  running: { label: 'Läuft …', tone: 'warning' },
  completed: { label: 'Fertig', tone: 'success' },
  failed: { label: 'Fehlgeschlagen', tone: 'danger' },
};

/** Filter der Übersicht – „alle" plus die beiden fachlichen Typen aus §3.3. */
export type BackupTypeFilter = 'all' | BackupType;

/**
 * Anzeigezustand der Aufbewahrung eines einzelnen Backups.
 *
 * - `pending`  – Vorgang läuft noch, es gibt kein verwendbares Archiv.
 * - `failed`   – abgebrochen, kein Archiv.
 * - `protected`– von der automatischen Löschung ausgenommen (jedes manuelle
 *   Backup sowie das jeweils neueste automatische je Server, Lastenheft §3.3).
 * - `expiring` – automatisches Backup mit gesetztem Löschzeitpunkt.
 */
export type RetentionState = 'pending' | 'failed' | 'protected' | 'expiring';

export function retentionState(backup: BackupDto): RetentionState {
  if (backup.status === 'failed') return 'failed';
  if (backup.status === 'pending' || backup.status === 'running') return 'pending';
  if (backup.retentionProtected || backup.expiresAt === null) return 'protected';
  return 'expiring';
}

/** Kennzahlen des gesamten eigenen Backup-Bestands (Arbeitspaket F4). */
export interface OwnBackupsSummary {
  total: number;
  /** Gesamter belegter Speicher in Byte – die „eigene Speicherbelegung" aus F4. */
  totalSizeBytes: number;
  manualCount: number;
  automaticCount: number;
  /** Laufende oder wartende Vorgänge ohne nutzbares Archiv. */
  pendingCount: number;
  failedCount: number;
}

export function summarizeOwnBackups(backups: readonly BackupDto[]): OwnBackupsSummary {
  const summary: OwnBackupsSummary = {
    total: backups.length,
    totalSizeBytes: 0,
    manualCount: 0,
    automaticCount: 0,
    pendingCount: 0,
    failedCount: 0,
  };

  for (const backup of backups) {
    summary.totalSizeBytes += backup.sizeBytes;

    if (backup.type === 'manual') summary.manualCount += 1;
    else summary.automaticCount += 1;

    if (backup.status === 'pending' || backup.status === 'running') summary.pendingCount += 1;
    if (backup.status === 'failed') summary.failedCount += 1;
  }

  return summary;
}

/** Nur Backups des gewählten Typs; `all` lässt alles durch. */
export function filterByType(backups: readonly BackupDto[], filter: BackupTypeFilter): BackupDto[] {
  if (filter === 'all') return [...backups];
  return backups.filter((backup) => backup.type === filter);
}

/**
 * Neueste zuerst, stabil nach `createdAt`.
 *
 * Bewusst eine Kopie – die Eingabe (der geladene Zustand) wird nie mutiert.
 */
export function sortByNewest(backups: readonly BackupDto[]): BackupDto[] {
  return [...backups].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
