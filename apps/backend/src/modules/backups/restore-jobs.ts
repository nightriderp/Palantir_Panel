/**
 * Wiederherstellungs-Aufträge mit Fortschritt (Fundpunkt 225).
 *
 * **Warum ein Auftrag und keine lange HTTP-Antwort.** Ein Archiv von zwanzig
 * Gigabyte braucht Minuten zum Entpacken, und die Frist des Agent-Befehls steht
 * auf zwei Stunden (`BACKUP_COMMAND_TIMEOUT_MS`). Genau so lange hing die
 * Anfrage: Jeder Vermittler davor – Browser, Traefik – gab vorher auf, und der
 * Nutzer sah einen Fehlschlag, während die Wiederherstellung in Ruhe zu Ende
 * lief. Dieselbe Überlegung steht seit P7 am Klon-Auftrag.
 *
 * **Warum im Speicher und nicht in der Datenbank.** Wortgleich zu
 * `server-orchestration/clone-jobs.ts`: Ein Auftrag lebt Minuten und beschreibt
 * einen Vorgang, der einen Neustart des Backends ohnehin nicht übersteht. Ein
 * persistierter Auftrag stünde danach für immer auf „läuft" und wäre eine Lüge.
 * Was den Neustart überlebt, sind die Daten im Datenordner – und die zeigt der
 * Server selbst.
 *
 * Bewusst **keine** gemeinsame Fassung mit den Klon-Aufträgen: Die beiden
 * Speicher teilen zwar die Form, aber nicht den Besitzer (B5 gegen B3), und ein
 * gemeinsamer generischer Speicher hinge zwischen zwei Modulen, ohne einem zu
 * gehören. Die Gemeinsamkeit steht im Vertrag (`ServerJobBase`), wo sie hin
 * gehört.
 */

import { randomUUID } from 'node:crypto';
import { type BackupRestoreJobDto, type ServerJobStatus } from '@palantir/contracts';

/**
 * Wie lange ein abgeschlossener Auftrag noch abrufbar bleibt.
 *
 * Dieselben fünfzehn Minuten wie beim Klon: lang genug, dass die Oberfläche das
 * Ergebnis noch holen kann, nachdem der Nutzer den Reiter kurz verlassen hat.
 */
export const RESTORE_JOB_RETENTION_MS = 15 * 60 * 1000;

export interface CreateRestoreJobInput {
  readonly serverId: string;
  readonly backupId: string;
}

/** Fortschrittsmeldung eines laufenden Auftrags. */
export interface RestoreJobProgress {
  readonly status?: ServerJobStatus;
  readonly progressPercent?: number;
  readonly step?: string;
  readonly statusMessage?: string | null;
}

export interface RestoreJobStore {
  create(input: CreateRestoreJobInput): BackupRestoreJobDto;
  /** Schreibt den Fortschritt fort; `null`, wenn es den Auftrag nicht (mehr) gibt. */
  update(jobId: string, progress: RestoreJobProgress): BackupRestoreJobDto | null;
  /** Beendet einen Auftrag – `completed` oder `failed`, in beiden Fällen mit Endzeit. */
  finish(
    jobId: string,
    status: 'completed' | 'failed',
    statusMessage?: string,
  ): BackupRestoreJobDto | null;
  find(jobId: string): BackupRestoreJobDto | null;
  /** Entfernt abgeschlossene Aufträge jenseits der Frist; liefert die Anzahl. */
  sweep(now?: Date): number;
}

export interface RestoreJobStoreOptions {
  /** Nur für Tests: feste Uhr. */
  readonly now?: () => Date;
}

export function createRestoreJobStore(options: RestoreJobStoreOptions = {}): RestoreJobStore {
  const now = options.now ?? ((): Date => new Date());
  const auftraege = new Map<string, BackupRestoreJobDto>();

  function sweep(zeitpunkt?: Date): number {
    const grenze = (zeitpunkt ?? now()).getTime() - RESTORE_JOB_RETENTION_MS;
    let entfernt = 0;

    for (const [id, job] of auftraege) {
      if (job.finishedAt !== null && Date.parse(job.finishedAt) <= grenze) {
        auftraege.delete(id);
        entfernt += 1;
      }
    }

    return entfernt;
  }

  return {
    sweep,

    create(input) {
      sweep();

      const job: BackupRestoreJobDto = {
        id: randomUUID(),
        serverId: input.serverId,
        backupId: input.backupId,
        status: 'queued',
        // Der Agent meldet beim Entpacken keinen Fortschritt; der Schritt sagt
        // trotzdem, was gerade läuft.
        progressPercent: 0,
        step: 'Wiederherstellung wird vorbereitet',
        statusMessage: null,
        startedAt: now().toISOString(),
        finishedAt: null,
      };

      auftraege.set(job.id, job);

      return job;
    },

    update(jobId, progress) {
      const job = auftraege.get(jobId);

      if (job === undefined) {
        return null;
      }

      const aktualisiert: BackupRestoreJobDto = { ...job, ...progress };
      auftraege.set(jobId, aktualisiert);

      return aktualisiert;
    },

    finish(jobId, status, statusMessage) {
      const job = auftraege.get(jobId);

      if (job === undefined) {
        return null;
      }

      const aktualisiert: BackupRestoreJobDto = {
        ...job,
        status,
        progressPercent: status === 'completed' ? 100 : job.progressPercent,
        step: status === 'completed' ? 'Fertig' : job.step,
        statusMessage: statusMessage ?? (status === 'completed' ? null : job.statusMessage),
        finishedAt: now().toISOString(),
      };

      auftraege.set(jobId, aktualisiert);

      return aktualisiert;
    },

    find(jobId) {
      return auftraege.get(jobId) ?? null;
    },
  };
}
