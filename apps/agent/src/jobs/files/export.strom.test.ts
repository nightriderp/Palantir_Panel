/**
 * Blöcke fließen, während noch gepackt wird (Leistungsbericht 19.09.2026,
 * Punkt 1.1).
 *
 * Eigene Datei mit gefälschtem `packDirectory`: Nur so lässt sich der
 * Zwischenzustand festhalten, auf den es ankommt – Archiv halb geschrieben,
 * Packen noch unterwegs. Gegen das echte gzip wäre das ein Wettlauf, der mal
 * so und mal anders ausgeht.
 *
 * Dass ein echtes Archiv dabei herauskommt, prüft `export.test.ts`.
 */

import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isContainerRuntimeError } from '../../runtime/errors.js';
import { DirectoryExportJob } from './export.js';

const packen = vi.hoisted(() => ({
  /** Wird beim Aufruf von `packDirectory` gesetzt: der Zielpfad. */
  ziel: null as string | null,
  fertig: null as ((sizeBytes: number) => void) | null,
  gescheitert: null as ((fehler: Error) => void) | null,
}));

vi.mock('../backup/tar-gz.js', () => ({
  packDirectory: (_quelle: string, ziel: string) => {
    packen.ziel = ziel;

    return new Promise((aufloesen, ablehnen) => {
      packen.fertig = (sizeBytes: number): void => {
        aufloesen({ sizeBytes, checksumSha256: 'x'.repeat(64), fileCount: 1 });
      };
      packen.gescheitert = ablehnen;
    });
  },
}));

let arbeit: string;
let quelle: string;
let exportDir: string;

function job(): DirectoryExportJob {
  return new DirectoryExportJob({
    exportDir,
    resolveHostPath: async (payload) => path.join(quelle, payload.path),
    maxBlockBytes: 4,
  });
}

/** Schreibt weitere Bytes in das halbfertige Archiv, so wie gzip es täte. */
async function anhaengen(inhalt: string): Promise<void> {
  await fs.appendFile(packen.ziel ?? '', inhalt);
}

beforeEach(async () => {
  arbeit = await mkdtemp(path.join(tmpdir(), 'palantir-strom-'));
  quelle = path.join(arbeit, 'daten');
  exportDir = path.join(arbeit, 'exports');
  packen.ziel = null;
  packen.fertig = null;
  packen.gescheitert = null;

  // Den Ablageordner legt sonst das echte packDirectory an.
  await fs.mkdir(exportDir, { recursive: true });
  await fs.mkdir(path.join(quelle, 'welt'), { recursive: true });
  await fs.writeFile(path.join(quelle, 'welt', 'level.dat'), 'x');
});

afterEach(async () => {
  await rm(arbeit, { recursive: true, force: true });
});

describe('Ordner-Download während des Packens', () => {
  it('antwortet auf FILE_ARCHIVE, bevor das Packen durch ist', async () => {
    const ergebnis = await job().archive({ containerId: 'c-1', path: 'welt' });

    expect(ergebnis.pending).toBe(true);
    expect(ergebnis.sizeBytes).toBe(0);
    // Der Beweis, dass nicht gewartet wurde: Das Packen laeuft noch.
    expect(packen.fertig).not.toBeNull();
  });

  it('liefert, was schon geschrieben ist, und meldet den Rest als ausstehend', async () => {
    const aufgabe = job();
    const gepackt = await aufgabe.archive({ containerId: 'c-1', path: 'welt' });

    // Noch keine Datei: „gleich nochmal", nicht „gibt es nicht".
    const leer = await aufgabe.archiveBlock({
      transferId: gepackt.transferId,
      offset: 0,
      maxBytes: 64,
    });

    expect(leer).toMatchObject({ bytesRead: 0, eof: false, pending: true });

    await anhaengen('ABCD');

    const erster = await aufgabe.archiveBlock({
      transferId: gepackt.transferId,
      offset: 0,
      maxBytes: 64,
    });

    expect(Buffer.from(erster.contentBase64, 'base64').toString()).toBe('ABCD');
    expect(erster.eof).toBe(false);
    expect(erster.pending).toBe(true);

    // Alles Geschriebene ist abgeholt, das Packen laeuft weiter.
    const zweiter = await aufgabe.archiveBlock({
      transferId: gepackt.transferId,
      offset: 4,
      maxBytes: 64,
    });

    expect(zweiter).toMatchObject({ bytesRead: 0, eof: false, pending: true });
  });

  it('schließt mit eof ab, sobald das Packen fertig ist, und räumt die Datei weg', async () => {
    const aufgabe = job();
    const gepackt = await aufgabe.archive({ containerId: 'c-1', path: 'welt' });

    await anhaengen('ABCD');
    packen.fertig?.(4);

    const letzter = await aufgabe.archiveBlock({
      transferId: gepackt.transferId,
      offset: 4,
      maxBytes: 64,
    });

    expect(letzter).toMatchObject({ bytesRead: 0, eof: true, totalBytes: 4 });
    expect(letzter.pending).toBeUndefined();
    await expect(fs.stat(packen.ziel ?? '')).rejects.toThrow();
  });

  it('reicht einen Fehler des Packens beim nächsten Blockabruf durch', async () => {
    const aufgabe = job();
    const gepackt = await aufgabe.archive({ containerId: 'c-1', path: 'welt' });

    await anhaengen('AB');
    packen.gescheitert?.(new Error('Kein Platz mehr auf dem Gerät'));
    // Der Fehlerzweig raeumt die Datei ab; der Rueckstand darf nicht als
    // gueltiges Archiv durchgehen.
    await new Promise((weiter) => setImmediate(weiter));

    const fehler = await aufgabe
      .archiveBlock({ transferId: gepackt.transferId, offset: 2, maxBytes: 64 })
      .catch((ursache: unknown) => ursache);

    expect(fehler).toBeInstanceOf(Error);
    expect((fehler as Error).message).toContain('Kein Platz mehr');
  });

  it('meldet einen unbekannten Transfer weiterhin als nicht vorhanden', async () => {
    const fehler = await job()
      .archiveBlock({
        transferId: '11111111-1111-4111-8111-000000000009',
        offset: 0,
        maxBytes: 16,
      })
      .catch((ursache: unknown) => ursache);

    expect(isContainerRuntimeError(fehler) ? fehler.code : null).toBe('FILE_NOT_FOUND');
  });
});
