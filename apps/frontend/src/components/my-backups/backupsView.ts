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

/**
 * Kennzeichnung „Vollständig / Unklar" (WORK_STATUS.md, Gefundener Punkt 38).
 *
 * Ein bei gestopptem Server gezogenes Archiv ist in sich stimmig; eines aus dem
 * laufenden Betrieb kann eine Welt mitten im Schreiben erwischt haben. Das ist
 * kein Fehler, sondern eine Einschränkung – deshalb `neutral` statt `warning`
 * und der Zusatz im Titel, statt die Zeile rot zu färben.
 *
 * `null` für Backups ohne Archiv: Was nicht fertig ist, ist weder vollständig
 * noch unklar.
 */
export function consistencyMeta(
  backup: BackupDto,
): { label: string; title: string; tone: Tone } | null {
  if (backup.status !== 'completed') {
    return null;
  }

  return backup.containerStopped
    ? {
        label: 'Vollständig',
        title: 'Der Server war beim Sichern gestoppt – das Archiv ist in sich stimmig.',
        tone: 'success',
      }
    : {
        label: 'Unklar',
        title:
          'Im laufenden Betrieb gesichert. Brauchbar, aber Dateien können mitten im Schreiben erfasst worden sein.',
        tone: 'neutral',
      };
}

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

/** Ein Server, für den es keine einzige Sicherung gibt. */
export interface ServerOhneSicherung {
  id: string;
  name: string;
}

/**
 * Eigene Server, zu denen keine Sicherung vorliegt.
 *
 * Das Mockup führt in seiner Tabelle **jeden** Server auf, auch ohne Sicherung
 * („—"). Genau die fehlen in der Liste der Sicherungen zwangsläufig – und das
 * ist die Angabe, auf die es ankommt: welcher Server steht ohne Netz da.
 *
 * Gezählt wird jede Sicherung, auch eine laufende oder fehlgeschlagene: Ein
 * fehlgeschlagener Lauf ist kein „nie versucht", und der Fehler steht bereits
 * an der Sicherung selbst.
 */
export function serversWithoutBackup(
  servers: ReadonlyArray<{ id: string; name: string; ownerId: string }>,
  backups: readonly BackupDto[],
  ownerId: string | null,
): ServerOhneSicherung[] {
  if (ownerId === null) return [];

  const gesichert = new Set(
    backups.map((backup) => backup.serverId).filter((id): id is string => id !== null),
  );

  return servers
    .filter((server) => server.ownerId === ownerId && !gesichert.has(server.id))
    .map((server) => ({ id: server.id, name: server.name }));
}
