/**
 * Zwischenspeicher der hochgeladenen Weltdaten-Archive (Arbeitspaket P4).
 *
 * Geprüft wird gegen ein echtes Verzeichnis unter `os.tmpdir()`: Der Speicher
 * ist genau deshalb dateibasiert, weil er nichts im Arbeitsspeicher halten
 * soll – ein Test gegen eine Attrappe würde das Verhalten prüfen, das gerade
 * nicht gebaut wurde.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WORLD_ARCHIVE_TTL_MS,
  createFileSystemWorldArchiveStore,
  detectWorldArchiveFormat,
} from './world-import.js';

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);
const TAR_GZ = gzipSync(Buffer.alloc(64, 2));

/** Ein Upload, wie ihn `@fastify/multipart` liefert: ein Strom von Blöcken. */
async function* strom(...bloecke: Buffer[]): AsyncGenerator<Buffer> {
  for (const block of bloecke) {
    yield block;
  }
}

let verzeichnis = '';
let jetzt = new Date('2026-09-01T10:00:00.000Z');

function store(maxBytes = 1024) {
  return createFileSystemWorldArchiveStore({
    directory: verzeichnis,
    maxBytes,
    now: () => jetzt,
  });
}

beforeEach(async () => {
  jetzt = new Date('2026-09-01T10:00:00.000Z');
  verzeichnis = await mkdtemp(path.join(os.tmpdir(), 'palantir-welt-test-'));
});

afterEach(async () => {
  await rm(verzeichnis, { recursive: true, force: true });
});

describe('Formaterkennung', () => {
  it('erkennt ZIP und tar.gz an den ersten Bytes', () => {
    expect(detectWorldArchiveFormat(ZIP)).toBe('zip');
    expect(detectWorldArchiveFormat(TAR_GZ)).toBe('tar.gz');
  });

  it('erkennt sonst nichts', () => {
    expect(detectWorldArchiveFormat(Buffer.from('nur Text'))).toBeNull();
    expect(detectWorldArchiveFormat(Buffer.alloc(0))).toBeNull();
  });
});

describe('Ablegen und Abholen', () => {
  it('nimmt ein ZIP an und gibt es unverändert wieder heraus', async () => {
    const speicher = store();

    const upload = await speicher.save('welt.zip', strom(ZIP));

    expect(upload).toMatchObject({ fileName: 'welt.zip', sizeBytes: ZIP.length, format: 'zip' });
    expect(Date.parse(upload.expiresAt)).toBe(jetzt.getTime() + WORLD_ARCHIVE_TTL_MS);

    const abgeholt = await speicher.take(upload.uploadId);

    expect(abgeholt?.content).toEqual(ZIP);
    expect(abgeholt?.format).toBe('zip');
  });

  it('setzt das Format nach dem Inhalt, nicht nach der Endung', async () => {
    const speicher = store();

    const upload = await speicher.save('welt.zip', strom(TAR_GZ));

    expect(upload.format).toBe('tar.gz');
  });

  it('gibt ein Archiv nur einmal heraus', async () => {
    const speicher = store();
    const upload = await speicher.save('welt.zip', strom(ZIP));

    expect(await speicher.take(upload.uploadId)).not.toBeNull();
    expect(await speicher.take(upload.uploadId)).toBeNull();
  });

  it('kennt einen unbekannten Verweis nicht', async () => {
    expect(await store().take('11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('setzt den Strom aus mehreren Blöcken korrekt zusammen', async () => {
    const speicher = store();
    const upload = await speicher.save(
      'welt.zip',
      strom(ZIP.subarray(0, 2), ZIP.subarray(2, 10), ZIP.subarray(10)),
    );

    expect((await speicher.take(upload.uploadId))?.content).toEqual(ZIP);
  });
});

describe('Abweisen', () => {
  it('lehnt ein zu großes Archiv ab und lässt nichts liegen', async () => {
    const speicher = store(32);

    await expect(speicher.save('welt.zip', strom(ZIP))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(await readdir(verzeichnis)).toEqual([]);
  });

  it('lehnt ein fremdes Format ab und lässt nichts liegen', async () => {
    const speicher = store();

    await expect(speicher.save('welt.exe', strom(Buffer.from('MZ nope')))).rejects.toMatchObject({
      code: 'WORLD_ARCHIVE_INVALID',
    });
    expect(await readdir(verzeichnis)).toEqual([]);
  });
});

describe('Frist', () => {
  it('gibt ein abgelaufenes Archiv nicht mehr heraus', async () => {
    const speicher = store();
    const upload = await speicher.save('welt.zip', strom(ZIP));

    jetzt = new Date(jetzt.getTime() + WORLD_ARCHIVE_TTL_MS + 1);

    expect(await speicher.take(upload.uploadId)).toBeNull();
    expect(await readdir(verzeichnis)).toEqual([]);
  });

  it('räumt abgelaufene Archive beim nächsten Upload weg', async () => {
    const speicher = store();
    await speicher.save('alt.zip', strom(ZIP));

    jetzt = new Date(jetzt.getTime() + WORLD_ARCHIVE_TTL_MS + 1);
    const neu = await speicher.save('neu.zip', strom(ZIP));

    const inhalt = await readdir(verzeichnis);

    expect(inhalt).toHaveLength(1);
    expect(inhalt[0]).toContain(neu.uploadId);
  });

  it('lässt ein noch gültiges Archiv beim Aufräumen stehen', async () => {
    const speicher = store();
    const upload = await speicher.save('welt.zip', strom(ZIP));

    expect(await speicher.sweep()).toBe(0);
    expect(await speicher.take(upload.uploadId)).not.toBeNull();
  });
});
