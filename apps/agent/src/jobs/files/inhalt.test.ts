import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DataVolumePaths } from '../../runtime/types.js';
import { readServerFile, writeServerFile } from './inhalt.js';

/**
 * Lesen und Schreiben host-seitig (Fundpunkt 281).
 *
 * Geprüft wird, was den Unterschied zum Archiv-Endpunkt ausmacht: die Grenzen
 * greifen **vor** dem Lesen, die Pfad-Schranken gelten wie beim Löschen, und
 * das Anlegen ohne `overwrite` entscheidet selbst, statt vorher zu fragen.
 */

const GRENZE = 1024;

let wurzel: string;
let volume: DataVolumePaths;

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-inhalt-'));
  volume = { containerPath: '/data', hostPath: wurzel };

  await fs.mkdir(path.join(wurzel, 'welt'), { recursive: true });
  await fs.writeFile(path.join(wurzel, 'server.properties'), 'motd=Palantir\n');
});

afterEach(async () => {
  await fs.rm(wurzel, { recursive: true, force: true });
});

describe('readServerFile (Fundpunkt 281)', () => {
  it('liest eine Datei und rechnet den Container-Pfad auf den Host um', async () => {
    const inhalt = await readServerFile(volume, '/data/server.properties', GRENZE);

    expect(inhalt.toString('utf8')).toBe('motd=Palantir\n');
  });

  it('meldet eine fehlende Datei als FILE_NOT_FOUND', async () => {
    await expect(readServerFile(volume, '/data/gibt-es-nicht', GRENZE)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('meldet ein Verzeichnis als FILE_NOT_FOUND, nicht als leere Datei', async () => {
    await expect(readServerFile(volume, '/data/welt', GRENZE)).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('lehnt den Datenordner selbst ab', async () => {
    await expect(readServerFile(volume, '/data', GRENZE)).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  });

  it('prueft die Groesse VOR dem Lesen', async () => {
    // Der Punkt der Grenze: Eine zu grosse Datei soll den Agent nicht erst
    // fuellen und dann abgewiesen werden.
    await fs.writeFile(path.join(wurzel, 'gross.bin'), 'x'.repeat(GRENZE + 1));

    await expect(readServerFile(volume, '/data/gross.bin', GRENZE)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });

  it('laesst nicht aus dem Datenordner ausbrechen', async () => {
    await expect(
      readServerFile(volume, '/data/../../etc/shadow', GRENZE, { allowedRoot: wurzel }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });
});

describe('writeServerFile (Fundpunkt 281)', () => {
  it('legt eine neue Datei an', async () => {
    await writeServerFile(volume, '/data/neu.txt', Buffer.from('hallo'), GRENZE);

    await expect(fs.readFile(path.join(wurzel, 'neu.txt'), 'utf8')).resolves.toBe('hallo');
  });

  it('weist eine vorhandene Datei ab, ohne sie anzutasten', async () => {
    // Das ist der Fall, um den es geht: Wer versehentlich auf einen belegten
    // Namen laedt, soll die vorhandene Datei nicht unbemerkt verlieren.
    await expect(
      writeServerFile(volume, '/data/server.properties', Buffer.from('weg damit'), GRENZE),
    ).rejects.toMatchObject({ code: 'FILE_EXISTS' });

    await expect(fs.readFile(path.join(wurzel, 'server.properties'), 'utf8')).resolves.toBe(
      'motd=Palantir\n',
    );
  });

  it('ueberschreibt mit overwrite', async () => {
    await writeServerFile(volume, '/data/server.properties', Buffer.from('neu'), GRENZE, {
      overwrite: true,
    });

    await expect(fs.readFile(path.join(wurzel, 'server.properties'), 'utf8')).resolves.toBe('neu');
  });

  it('prueft die Groesse, bevor irgendetwas angefasst wird', async () => {
    await expect(
      writeServerFile(volume, '/data/neu.txt', Buffer.alloc(GRENZE + 1), GRENZE),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    // Und zwar wirklich vorher: Die Datei ist nicht angelegt worden.
    await expect(fs.stat(path.join(wurzel, 'neu.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('laesst nicht aus dem Datenordner ausbrechen', async () => {
    await expect(
      writeServerFile(volume, '/data/../ausbruch.txt', Buffer.from('x'), GRENZE, {
        allowedRoot: wurzel,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('haelt zwei gleichzeitige Anlagen auseinander', async () => {
    /*
     * Der eigentliche Gewinn gegenueber dem Archiv-Endpunkt: Dort lagen
     * Pruefung und Schreiben auseinander, und zwischen beiden passte ein
     * zweiter Upload. `open(..., 'wx')` ist ein Aufruf - genau einer der
     * beiden kommt durch.
     */
    const ergebnisse = await Promise.allSettled([
      writeServerFile(volume, '/data/gleichzeitig.txt', Buffer.from('a'), GRENZE),
      writeServerFile(volume, '/data/gleichzeitig.txt', Buffer.from('b'), GRENZE),
    ]);

    expect(ergebnisse.filter((e) => e.status === 'fulfilled')).toHaveLength(1);
    expect(ergebnisse.filter((e) => e.status === 'rejected')).toHaveLength(1);
  });
});
