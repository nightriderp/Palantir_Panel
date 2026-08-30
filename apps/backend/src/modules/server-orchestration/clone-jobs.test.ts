/**
 * Klon-Aufträge (Arbeitspaket P7).
 *
 * Geprüft wird die Ablage für sich: Anlegen, Fortschreiben, Abschließen und die
 * Frist, nach der ein abgeschlossener Auftrag vergessen wird. Was der Dienst
 * damit tut, prüft `service.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { CLONE_JOB_RETENTION_MS, createCloneJobStore } from './clone-jobs.js';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';

function eingabe(includeWorldData = false) {
  return {
    sourceServerId: SOURCE_ID,
    targetName: 'Klon',
    targetSubdomain: 'klon',
    includeWorldData,
  };
}

describe('Anlegen', () => {
  it('startet mit Status queued und ohne Ziel-Server', () => {
    const jetzt = new Date('2026-09-01T10:00:00.000Z');
    const store = createCloneJobStore({ now: () => jetzt });

    const job = store.create(eingabe());

    expect(job).toMatchObject({
      serverId: SOURCE_ID,
      status: 'queued',
      progressPercent: 0,
      targetServerId: null,
      targetName: 'Klon',
      targetSubdomain: 'klon',
      includeWorldData: false,
      finishedAt: null,
    });
    expect(job.startedAt).toBe(jetzt.toISOString());
  });

  it('unterscheidet „kein Kopiervorgang" von „noch nichts kopiert"', () => {
    const store = createCloneJobStore();

    expect(store.create(eingabe(false)).copiedBytes).toBeNull();
    expect(store.create(eingabe(true)).copiedBytes).toBe(0);
  });

  it('vergibt je Auftrag eine eigene Id', () => {
    const store = createCloneJobStore();

    expect(store.create(eingabe()).id).not.toBe(store.create(eingabe()).id);
  });
});

describe('Fortschreiben', () => {
  it('übernimmt nur die angegebenen Felder', () => {
    const store = createCloneJobStore();
    const job = store.create(eingabe(true));

    const aktualisiert = store.update(job.id, {
      status: 'running',
      progressPercent: 60,
      step: 'Weltdaten werden übertragen',
      totalBytes: 4_096,
    });

    expect(aktualisiert).toMatchObject({
      status: 'running',
      progressPercent: 60,
      step: 'Weltdaten werden übertragen',
      totalBytes: 4_096,
      targetName: 'Klon',
    });
  });

  it('kennt einen unbekannten Auftrag nicht', () => {
    expect(createCloneJobStore().update('gibt-es-nicht', { progressPercent: 10 })).toBeNull();
  });
});

describe('Abschließen', () => {
  it('setzt bei Erfolg 100 Prozent und eine Endzeit', () => {
    const jetzt = new Date('2026-09-01T10:05:00.000Z');
    const store = createCloneJobStore({ now: () => jetzt });
    const job = store.create(eingabe());

    const fertig = store.finish(job.id, 'completed');

    expect(fertig).toMatchObject({
      status: 'completed',
      progressPercent: 100,
      statusMessage: null,
      finishedAt: jetzt.toISOString(),
    });
  });

  it('behält bei Fehlschlag den erreichten Fortschritt und nennt den Grund', () => {
    const store = createCloneJobStore();
    const job = store.create(eingabe(true));
    store.update(job.id, { progressPercent: 60, step: 'Weltdaten werden übertragen' });

    const gescheitert = store.finish(job.id, 'failed', 'Platte voll.');

    expect(gescheitert).toMatchObject({
      status: 'failed',
      progressPercent: 60,
      step: 'Weltdaten werden übertragen',
      statusMessage: 'Platte voll.',
    });
    expect(gescheitert?.finishedAt).not.toBeNull();
  });
});

describe('Frist', () => {
  it('vergisst abgeschlossene Aufträge jenseits der Frist', () => {
    let jetzt = new Date('2026-09-01T10:00:00.000Z');
    const store = createCloneJobStore({ now: () => jetzt });
    const job = store.create(eingabe());
    store.finish(job.id, 'completed');

    expect(store.sweep()).toBe(0);
    expect(store.find(job.id)).not.toBeNull();

    jetzt = new Date(jetzt.getTime() + CLONE_JOB_RETENTION_MS + 1_000);

    expect(store.sweep()).toBe(1);
    expect(store.find(job.id)).toBeNull();
  });

  it('lässt einen laufenden Auftrag unangetastet, egal wie lange er dauert', () => {
    let jetzt = new Date('2026-09-01T10:00:00.000Z');
    const store = createCloneJobStore({ now: () => jetzt });
    const job = store.create(eingabe(true));

    jetzt = new Date(jetzt.getTime() + 10 * CLONE_JOB_RETENTION_MS);

    expect(store.sweep()).toBe(0);
    expect(store.find(job.id)).not.toBeNull();
  });
});
