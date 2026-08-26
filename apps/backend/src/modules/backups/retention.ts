/**
 * Aufbewahrungsregel für Backups – Lastenheft §3.3, wörtlich:
 *
 * > Backups: manuell und automatisch geplant; **automatische** Backups älter
 * > als 7 Tage werden gelöscht (neuestes bleibt immer erhalten); **manuell
 * > erstellte Backups sind von dieser automatischen Löschung ausgenommen** und
 * > müssen aktiv entfernt werden
 *
 * Daraus folgen genau drei Regeln, die diese Datei umsetzt:
 *
 * 1. Nur `type === 'automatic'` kommt überhaupt in Frage.
 * 2. Das neueste automatische Backup eines Servers bleibt immer erhalten – auch
 *    wenn es älter als sieben Tage ist.
 * 3. Manuelle Backups (inklusive Datenexporten) werden nie automatisch gelöscht.
 *
 * Zwei Fälle lässt der Wortlaut offen; die Auslegung steht hier an einer Stelle
 * und ist in WORK_STATUS.md sowie im PR vermerkt:
 *
 * - **Noch laufende Backups** (`pending`/`running`) werden nie angefasst. Sie
 *   sind noch kein Backup, und ein Abbruch mittendrin ließe eine halbe Datei
 *   zurück.
 * - **„Das neueste automatische Backup"** meint das neueste **abgeschlossene**.
 *   Ein fehlgeschlagenes Backup enthält keine Daten; würde es den Schutz für
 *   sich beanspruchen, könnte die Regel das letzte brauchbare Backup löschen
 *   und der Server stünde ohne jede Sicherung da – das Gegenteil dessen, was
 *   der Satz bezweckt. Fehlgeschlagene Läufe werden nach Ablauf der Frist wie
 *   jedes andere automatische Backup entfernt.
 *
 * Die Datei kennt bewusst weder Datenbank noch HTTP: sie arbeitet auf reinen
 * Werten und ist damit vollständig ohne Infrastruktur testbar (CLAUDE.md §4).
 */

import {
  AUTOMATIC_BACKUP_RETENTION_DAYS,
  type BackupStatus,
  type BackupType,
} from '@palantir/contracts';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ein Backup, soweit die Aufbewahrungsregel es braucht. */
export interface RetentionCandidate {
  readonly id: string;
  readonly type: BackupType;
  readonly status: BackupStatus;
  readonly createdAt: Date;
}

export interface RetentionOptions {
  /** Abweichende Frist in Tagen – ausschließlich für Tests. */
  readonly maxAgeDays?: number;
}

/** Zeitpunkt, ab dem ein automatisches Backup als abgelaufen gilt. */
export function retentionCutoff(now: Date, maxAgeDays = AUTOMATIC_BACKUP_RETENTION_DAYS): Date {
  return new Date(now.getTime() - maxAgeDays * MILLISECONDS_PER_DAY);
}

/**
 * Das neueste abgeschlossene automatische Backup – es bleibt immer erhalten
 * (Lastenheft §3.3, zweite Regel).
 *
 * Bei gleichem Zeitstempel entscheidet die Id, damit die Auswahl über mehrere
 * Läufe hinweg dieselbe bleibt und nicht von der Sortierung der Datenbank
 * abhängt.
 */
export function newestProtectedAutomaticBackup<T extends RetentionCandidate>(
  backups: readonly T[],
): T | null {
  let newest: T | null = null;

  for (const backup of backups) {
    if (backup.type !== 'automatic' || backup.status !== 'completed') {
      continue;
    }

    if (
      newest === null ||
      backup.createdAt.getTime() > newest.createdAt.getTime() ||
      (backup.createdAt.getTime() === newest.createdAt.getTime() && backup.id < newest.id)
    ) {
      newest = backup;
    }
  }

  return newest;
}

/**
 * Ist dieses Backup von der automatischen Löschung ausgenommen?
 *
 * Genau dann, wenn es manuell erstellt wurde, noch läuft oder das neueste
 * abgeschlossene automatische Backup seines Servers ist. Speist das Feld
 * `BackupDto.retentionProtected`, damit die Oberfläche erklären kann, warum ein
 * Backup nicht von selbst verschwindet.
 */
export function isRetentionProtected(
  backup: RetentionCandidate,
  backupsOfSameServer: readonly RetentionCandidate[],
): boolean {
  if (backup.type === 'manual') {
    return true;
  }

  if (backup.status === 'pending' || backup.status === 'running') {
    return true;
  }

  return newestProtectedAutomaticBackup(backupsOfSameServer)?.id === backup.id;
}

/**
 * Zeitpunkt der automatischen Löschung, oder `null` bei geschützten Backups.
 * Speist das Feld `BackupDto.expiresAt`.
 */
export function retentionExpiresAt(
  backup: RetentionCandidate,
  backupsOfSameServer: readonly RetentionCandidate[],
  maxAgeDays = AUTOMATIC_BACKUP_RETENTION_DAYS,
): Date | null {
  if (isRetentionProtected(backup, backupsOfSameServer)) {
    return null;
  }

  return new Date(backup.createdAt.getTime() + maxAgeDays * MILLISECONDS_PER_DAY);
}

/**
 * Wählt die Backups **eines Servers** aus, die die Aufbewahrungsregel entfernt.
 *
 * Bewusst je Server: „das neueste automatische Backup bleibt erhalten" gilt pro
 * Server, nicht instanzweit – sonst verlöre jeder Server bis auf einen seine
 * letzte Sicherung.
 *
 * „Älter als 7 Tage" ist streng gemeint: ein Backup, das exakt sieben Tage alt
 * ist, bleibt.
 */
export function selectExpiredBackups<T extends RetentionCandidate>(
  backupsOfOneServer: readonly T[],
  now: Date,
  options: RetentionOptions = {},
): T[] {
  const maxAgeDays = options.maxAgeDays ?? AUTOMATIC_BACKUP_RETENTION_DAYS;
  const cutoff = retentionCutoff(now, maxAgeDays).getTime();
  const protectedId = newestProtectedAutomaticBackup(backupsOfOneServer)?.id ?? null;

  return backupsOfOneServer.filter((backup) => {
    // Regel 3: manuelle Backups – und damit auch Datenexporte – nie automatisch.
    if (backup.type !== 'automatic') {
      return false;
    }

    // Ein laufender Vorgang ist noch kein Backup.
    if (backup.status === 'pending' || backup.status === 'running') {
      return false;
    }

    // Regel 2: das neueste abgeschlossene automatische Backup bleibt immer.
    if (backup.id === protectedId) {
      return false;
    }

    // Regel 1: älter als die Frist.
    return backup.createdAt.getTime() < cutoff;
  });
}
