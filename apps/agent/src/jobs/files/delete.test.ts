import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DataVolumePaths } from '../../runtime/types.js';
import { deleteServerFile } from './delete.js';

let wurzel: string;
let volume: DataVolumePaths;

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-delete-'));
  volume = { containerPath: '/data', hostPath: wurzel };

  await fs.mkdir(path.join(wurzel, 'welt'), { recursive: true });
  await fs.mkdir(path.join(wurzel, 'leer'), { recursive: true });
  await fs.writeFile(path.join(wurzel, 'server.properties'), 'motd=x');
  await fs.writeFile(path.join(wurzel, 'welt', 'level.dat'), 'y');
});

afterEach(async () => {
  await fs.rm(wurzel, { recursive: true, force: true });
});

/** Existiert der Pfad noch? */
async function vorhanden(...teile: string[]): Promise<boolean> {
  return fs
    .stat(path.join(wurzel, ...teile))
    .then(() => true)
    .catch(() => false);
}

describe('deleteServerFile (Gefundener Punkt 105)', () => {
  it('entfernt eine Datei und rechnet den Container-Pfad auf den Host um', async () => {
    await deleteServerFile(volume, '/data/server.properties');

    expect(await vorhanden('server.properties')).toBe(false);
    // Der Rest des Datenordners bleibt unberuehrt.
    expect(await vorhanden('welt', 'level.dat')).toBe(true);
  });

  it('behandelt einen bereits fehlenden Pfad als folgenlos', async () => {
    await expect(deleteServerFile(volume, '/data/gibtesnicht.log')).resolves.toBeUndefined();
  });

  it('entfernt ein leeres Verzeichnis auch ohne recursive', async () => {
    await deleteServerFile(volume, '/data/leer');

    expect(await vorhanden('leer')).toBe(false);
  });

  it('entfernt ein nicht-leeres Verzeichnis nur mit recursive', async () => {
    await expect(deleteServerFile(volume, '/data/welt')).rejects.toMatchObject({
      code: 'RUNTIME_ERROR',
    });
    expect(await vorhanden('welt', 'level.dat')).toBe(true);

    await deleteServerFile(volume, '/data/welt', { recursive: true });
    expect(await vorhanden('welt')).toBe(false);
  });

  it('lehnt einen Pfad ausserhalb des Datenordners ab', async () => {
    await expect(deleteServerFile(volume, '/data/../etc/passwd')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  });

  it('lehnt den Datenordner selbst ab', async () => {
    await expect(deleteServerFile(volume, '/data')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    expect(await vorhanden('server.properties')).toBe(true);
  });

  it('loescht nichts, wenn der Datenordner ausserhalb der erlaubten Wurzel liegt', async () => {
    // Fehlkonfiguration oder untergeschobener Mount: Der Agent fasst nur an,
    // was unterhalb von AGENT_DATA_DIR liegt.
    const fremd = path.join(wurzel, 'anderswo');

    await expect(
      deleteServerFile(volume, '/data/server.properties', { allowedRoot: fremd }),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(await vorhanden('server.properties')).toBe(true);
  });

  it('laesst den Datenordner unterhalb der erlaubten Wurzel zu', async () => {
    await expect(
      deleteServerFile(volume, '/data/server.properties', { allowedRoot: path.dirname(wurzel) }),
    ).resolves.toBeUndefined();
    expect(await vorhanden('server.properties')).toBe(false);
  });
});
