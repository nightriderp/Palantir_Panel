import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isContainerRuntimeError } from '../../runtime/errors.js';
import { DirectoryExportJob, MAX_EXPORT_AGE_MS, archiveFileName } from './export.js';

/**
 * Ordner packen und blockweise ausliefern (Betreiber, 19.09.2026).
 *
 * Gegen das echte Dateisystem in einem Wegwerf-Ordner: Gepackt wird mit
 * derselben Funktion wie eine Sicherung, und was dabei herauskommt, muss eine
 * lesbare Datei sein – das prüft kein Fake.
 */

let arbeit: string;
let quelle: string;
let exportDir: string;

function job(now?: () => Date): DirectoryExportJob {
  return new DirectoryExportJob({
    exportDir,
    resolveHostPath: async (payload) => path.join(quelle, payload.path),
    maxBlockBytes: 16,
    ...(now === undefined ? {} : { now }),
  });
}

/**
 * Holt das ganze Archiv ab und liefert seine Bytes.
 *
 * Seit dem Strom-Umbau (Leistungsbericht 19.09.2026, Punkt 1.1) laeuft das
 * Packen noch, waehrend die ersten Bloecke schon kommen. Ein Block ohne Daten
 * und mit `pending` heisst deshalb „gleich nochmal", nicht „zu Ende".
 */
async function holeAlles(
  aufgabe: DirectoryExportJob,
  transferId: string,
): Promise<{ bytes: Buffer; totalBytes: number }> {
  const stuecke: Buffer[] = [];
  let offset = 0;

  for (;;) {
    const block = await aufgabe.archiveBlock({ transferId, offset, maxBytes: 1024 });

    stuecke.push(Buffer.from(block.contentBase64, 'base64'));
    offset += block.bytesRead;

    if (block.eof) {
      return { bytes: Buffer.concat(stuecke), totalBytes: block.totalBytes };
    }

    // Der Block haelt die eigene Grenze ein, nicht die des Aufrufers.
    expect(block.bytesRead).toBeLessThanOrEqual(16);

    if (block.bytesRead === 0) {
      expect(block.pending).toBe(true);
      await new Promise((weiter) => setTimeout(weiter, 5));
    }
  }
}

beforeEach(async () => {
  arbeit = await mkdtemp(path.join(tmpdir(), 'palantir-export-'));
  quelle = path.join(arbeit, 'daten');
  exportDir = path.join(arbeit, 'exports');

  await fs.mkdir(path.join(quelle, 'welt', 'region'), { recursive: true });
  await fs.writeFile(path.join(quelle, 'welt', 'level.dat'), 'x'.repeat(200));
  await fs.writeFile(path.join(quelle, 'welt', 'region', 'r.0.0.mca'), 'y'.repeat(200));
});

afterEach(async () => {
  await rm(arbeit, { recursive: true, force: true });
});

describe('archiveFileName()', () => {
  it('nimmt den letzten Teil des Pfades', () => {
    expect(archiveFileName('welt/region')).toBe('region.tar.gz');
    expect(archiveFileName('welt')).toBe('welt.tar.gz');
  });

  it('nennt die Wurzel „daten" und entschärft Sonderzeichen', () => {
    expect(archiveFileName('')).toBe('daten.tar.gz');
    expect(archiveFileName('mein ordner; rm -rf')).toBe('mein-ordner-rm-rf.tar.gz');
  });
});

describe('DirectoryExportJob', () => {
  it('meldet Namen und Kennung sofort, ohne das Packen abzuwarten', async () => {
    const ergebnis = await job().archive({ containerId: 'c-1', path: 'welt' });

    expect(ergebnis.fileName).toBe('welt.tar.gz');
    // Die Groesse steht erst mit dem letzten Block fest (Punkt 1.1).
    expect(ergebnis.pending).toBe(true);
    expect(ergebnis.sizeBytes).toBe(0);
  });

  it('lehnt eine Datei ab – die kommt einzeln', async () => {
    const fehler = await job()
      .archive({ containerId: 'c-1', path: 'welt/level.dat' })
      .catch((ursache: unknown) => ursache);

    expect(isContainerRuntimeError(fehler) ? fehler.code : null).toBe('INVALID_PATH');
  });

  it('meldet einen fehlenden Ordner als FILE_NOT_FOUND', async () => {
    const fehler = await job()
      .archive({ containerId: 'c-1', path: 'gibtsnicht' })
      .catch((ursache: unknown) => ursache);

    expect(isContainerRuntimeError(fehler) ? fehler.code : null).toBe('FILE_NOT_FOUND');
  });

  it('liefert das Archiv blockweise und räumt es mit dem letzten Block weg', async () => {
    const aufgabe = job();
    const gepackt = await aufgabe.archive({ containerId: 'c-1', path: 'welt' });

    const { bytes, totalBytes } = await holeAlles(aufgabe, gepackt.transferId);

    expect(bytes).toHaveLength(totalBytes);
    // gzip-Kennung: Was hier ankommt, ist ein Archiv und kein Textbrei.
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    await expect(fs.stat(path.join(exportDir, `${gepackt.transferId}.tar.gz`))).rejects.toThrow();
  });

  it('meldet einen abgeholten oder unbekannten Transfer als nicht vorhanden', async () => {
    const fehler = await job()
      .archiveBlock({
        transferId: '11111111-1111-4111-8111-000000000009',
        offset: 0,
        maxBytes: 16,
      })
      .catch((ursache: unknown) => ursache);

    expect(isContainerRuntimeError(fehler) ? fehler.code : null).toBe('FILE_NOT_FOUND');
  });

  it('lässt keine Kennung mit Pfadanteil zu', async () => {
    const fehler = await job()
      .archiveBlock({ transferId: '../../etc/passwd', offset: 0, maxBytes: 16 })
      .catch((ursache: unknown) => ursache);

    expect(isContainerRuntimeError(fehler) ? fehler.code : null).toBe('INVALID_PATH');
  });

  it('räumt liegengebliebene Zwischenstände nach der Frist weg', async () => {
    const jetzt = new Date('2026-09-19T12:00:00.000Z');
    const aufgabe = job(() => jetzt);
    const alt = await aufgabe.archive({ containerId: 'c-1', path: 'welt' });
    const altPfad = path.join(exportDir, `${alt.transferId}.tar.gz`);

    // Erst abwarten, bis das Packen durch ist: Sonst schreibt gzip noch,
    // waehrend der Test die Datei altern laesst.
    await holeAlles(aufgabe, alt.transferId);
    await fs.writeFile(altPfad, 'Rest eines abgebrochenen Downloads');

    // Datei künstlich altern lassen – ein abgebrochener Download von vorhin.
    const vergangen = new Date(jetzt.getTime() - MAX_EXPORT_AGE_MS - 1_000);
    await fs.utimes(altPfad, vergangen, vergangen);

    const entfernt = await aufgabe.raeumeAlteAuf();

    expect(entfernt).toBe(1);
    await expect(fs.stat(altPfad)).rejects.toThrow();
  });
});
