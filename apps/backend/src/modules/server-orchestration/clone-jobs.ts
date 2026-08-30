/**
 * Klon-Aufträge mit Fortschritt (Pflichtenheft §9, Lastenheft §3.3;
 * Arbeitspaket P7).
 *
 * **Warum ein Auftrag und keine lange HTTP-Antwort.** Ein Klon **mit**
 * Weltdaten kopiert je nach Welt viele Gigabyte. Das Anlegen antwortet deshalb
 * sofort mit dem Auftrag; der Fortschritt läuft über `serverClone.progressed`
 * (Live-Kanal) und ist zusätzlich über `GET /api/servers/:id/clone/:jobId`
 * abrufbar – der Contract `ServerCloneJobDto` sieht genau das vor, und das
 * Frontend fragt beides schon ab.
 *
 * **Warum im Speicher und nicht in der Datenbank.** Ein Auftrag lebt Minuten
 * und beschreibt einen Vorgang, der einen Neustart des Backends ohnehin nicht
 * übersteht: Wird das Backend mittendrin beendet, ist der Klon halb angelegt –
 * ein persistierter Auftrag stünde danach für immer auf „läuft" und wäre eine
 * Lüge. Was den Neustart überlebt, ist der Server selbst, und den zeigt die
 * Übersicht. Abgeschlossene Aufträge werden nach einer Frist vergessen, damit
 * die Ablage nicht unbegrenzt wächst.
 */

import { randomUUID } from 'node:crypto';
import { type ServerCloneJobDto, type ServerJobStatus } from '@palantir/contracts';

/**
 * Wie lange ein abgeschlossener Auftrag noch abrufbar bleibt.
 *
 * Lang genug, dass die Oberfläche das Ergebnis noch holen kann, nachdem der
 * Nutzer den Reiter kurz verlassen hat – und kurz genug, dass niemand über
 * Stunden alte Aufträge findet.
 */
export const CLONE_JOB_RETENTION_MS = 15 * 60 * 1000;

export interface CreateCloneJobInput {
  readonly sourceServerId: string;
  readonly targetName: string;
  readonly targetSubdomain: string;
  readonly includeWorldData: boolean;
}

/** Fortschrittsmeldung eines laufenden Auftrags. */
export interface CloneJobProgress {
  readonly status?: ServerJobStatus;
  readonly progressPercent?: number;
  readonly step?: string;
  readonly statusMessage?: string | null;
  readonly targetServerId?: string | null;
  readonly copiedBytes?: number | null;
  readonly totalBytes?: number | null;
}

export interface CloneJobStore {
  create(input: CreateCloneJobInput): ServerCloneJobDto;
  /** Schreibt den Fortschritt fort; `null`, wenn es den Auftrag nicht (mehr) gibt. */
  update(jobId: string, progress: CloneJobProgress): ServerCloneJobDto | null;
  /** Beendet einen Auftrag – `completed` oder `failed`, in beiden Fällen mit Endzeit. */
  finish(
    jobId: string,
    status: 'completed' | 'failed',
    statusMessage?: string,
  ): ServerCloneJobDto | null;
  find(jobId: string): ServerCloneJobDto | null;
  /** Entfernt abgeschlossene Aufträge jenseits der Frist; liefert die Anzahl. */
  sweep(now?: Date): number;
}

export interface CloneJobStoreOptions {
  /** Nur für Tests: feste Uhr. */
  readonly now?: () => Date;
}

export function createCloneJobStore(options: CloneJobStoreOptions = {}): CloneJobStore {
  const now = options.now ?? ((): Date => new Date());
  const auftraege = new Map<string, ServerCloneJobDto>();

  function sweep(zeitpunkt?: Date): number {
    const grenze = (zeitpunkt ?? now()).getTime() - CLONE_JOB_RETENTION_MS;
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

      const job: ServerCloneJobDto = {
        id: randomUUID(),
        serverId: input.sourceServerId,
        status: 'queued',
        progressPercent: 0,
        step: 'Klon wird vorbereitet',
        statusMessage: null,
        startedAt: now().toISOString(),
        finishedAt: null,
        targetServerId: null,
        targetName: input.targetName,
        targetSubdomain: input.targetSubdomain,
        includeWorldData: input.includeWorldData,
        // Ohne Weltdaten gibt es nichts zu übertragen – `null` statt `0`
        // unterscheidet „kein Kopiervorgang" von „noch nichts kopiert".
        copiedBytes: input.includeWorldData ? 0 : null,
        totalBytes: null,
      };

      auftraege.set(job.id, job);

      return job;
    },

    update(jobId, progress) {
      const job = auftraege.get(jobId);

      if (job === undefined) {
        return null;
      }

      const aktualisiert: ServerCloneJobDto = { ...job, ...progress };
      auftraege.set(jobId, aktualisiert);

      return aktualisiert;
    },

    finish(jobId, status, statusMessage) {
      const job = auftraege.get(jobId);

      if (job === undefined) {
        return null;
      }

      const aktualisiert: ServerCloneJobDto = {
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
