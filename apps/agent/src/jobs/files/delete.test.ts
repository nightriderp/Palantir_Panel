import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DataVolumePaths } from '../../runtime/types.js';
import { ServerFileJob, deleteServerFile, listServerDirectory } from './delete.js';

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

describe('ensureDataDirectory (Gefundener Punkt 117)', () => {
  /** Job mit echtem Datenverzeichnis; die Runtime wird dabei nicht gebraucht. */
  function job(): ServerFileJob {
    return new ServerFileJob({
      runtime: null as unknown as ConstructorParameters<typeof ServerFileJob>[0]['runtime'],
      dataDir: wurzel,
    });
  }

  it('legt einen fehlenden Datenordner an', async () => {
    const ziel = path.join(wurzel, 'neuer-server');

    await job().ensureDataDirectory(ziel);

    expect((await fs.stat(ziel)).isDirectory()).toBe(true);
  });

  it('laesst einen vorhandenen Ordner samt Inhalt in Ruhe', async () => {
    const ziel = path.join(wurzel, 'welt');

    await job().ensureDataDirectory(ziel);

    // `welt/level.dat` stammt aus dem Aufbau oben und muss den Lauf ueberstehen.
    expect(await vorhanden('welt', 'level.dat')).toBe(true);
  });

  it('lehnt einen Pfad ausserhalb des Datenverzeichnisses ab', async () => {
    await expect(
      job().ensureDataDirectory(path.join(wurzel, '..', 'woanders')),
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  it('vergibt nur dem eigenen Benutzer Rechte', async ({ skip }) => {
    // Rechte-Bits gibt es so nur auf POSIX; auf Windows ignoriert der Kern den
    // Modus, und der Homeserver ist Linux.
    if (process.platform === 'win32') {
      skip();

      return;
    }

    const ziel = path.join(wurzel, 'rechte-server');
    await job().ensureDataDirectory(ziel);

    expect((await fs.stat(ziel)).mode & 0o777).toBe(0o700);
  });

  it('nennt bei fehlenden Rechten Besitzer und Abhilfe (Fundpunkt 181)', async ({ skip }) => {
    // Braucht POSIX-Rechte und einen Benutzer, den sie treffen: root darf
    // ueberall schreiben, und unter Windows ignoriert der Kern den Modus.
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      skip();

      return;
    }

    const gesperrt = path.join(wurzel, 'gesperrt');
    await fs.mkdir(gesperrt);
    await fs.chmod(gesperrt, 0o500);
    const gesperrterJob = new ServerFileJob({
      runtime: null as unknown as ConstructorParameters<typeof ServerFileJob>[0]['runtime'],
      dataDir: gesperrt,
    });

    try {
      await expect(
        gesperrterJob.ensureDataDirectory(path.join(gesperrt, 'neuer-server')),
      ).rejects.toMatchObject({
        code: 'RUNTIME_ERROR',
        message: expect.stringContaining(`chown -R 1000:1000 ${gesperrt}`) as string,
      });
    } finally {
      await fs.chmod(gesperrt, 0o700);
    }
  });
});

/**
 * Fundpunkt 276: Auflisten lief bis hierher ueber die Container-Runtime, also
 * ueber `GET /archive` - und das packt den Ordner rekursiv **mit Inhalten** ein.
 * Daher kamen beide bisherigen Fehler: die Speichergrenze aus Fundpunkt 228 und
 * die Laufzeit aus Fundpunkt 275. Auf dem Host ist es ein `readdir`.
 */
describe('listServerDirectory (Fundpunkt 276)', () => {
  it('listet die direkte Ebene und rechnet auf Container-Pfade zurueck', async () => {
    const eintraege = await listServerDirectory(volume, '/data');

    expect(eintraege.map((eintrag) => eintrag.name)).toEqual(['leer', 'server.properties', 'welt']);
    expect(eintraege.map((eintrag) => eintrag.path)).toEqual([
      '/data/leer',
      '/data/server.properties',
      '/data/welt',
    ]);
  });

  it('steigt nicht in Unterverzeichnisse ab', async () => {
    // Der Unterschied zum Archiv-Weg: Dort kam der ganze Baum, und die Ebene
    // wurde hinterher herausgefiltert.
    const eintraege = await listServerDirectory(volume, '/data');

    expect(eintraege.map((eintrag) => eintrag.name)).not.toContain('level.dat');
  });

  it('listet auch ein Unterverzeichnis', async () => {
    const eintraege = await listServerDirectory(volume, '/data/welt');

    expect(eintraege.map((eintrag) => eintrag.name)).toEqual(['level.dat']);
    expect(eintraege[0]?.path).toBe('/data/welt/level.dat');
  });

  it('nennt Art, Groesse, Rechte und Zeitstempel', async () => {
    const eintraege = await listServerDirectory(volume, '/data');
    const datei = eintraege.find((eintrag) => eintrag.name === 'server.properties');
    const ordner = eintraege.find((eintrag) => eintrag.name === 'welt');

    expect(datei).toMatchObject({ type: 'file', sizeBytes: 'motd=x'.length });
    expect(ordner?.type).toBe('directory');
    expect(datei?.mode).toMatch(/^[0-7]{3,4}$/u);
    expect(Number.isNaN(Date.parse(datei?.modifiedAt ?? ''))).toBe(false);
  });

  it('meldet ein fehlendes Verzeichnis als FILE_NOT_FOUND', async () => {
    await expect(listServerDirectory(volume, '/data/gibtsnicht')).rejects.toMatchObject({
      code: 'FILE_NOT_FOUND',
    });
  });

  it('meldet eine Datei als ungueltigen Pfad', async () => {
    await expect(listServerDirectory(volume, '/data/server.properties')).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
  });

  it('laesst niemanden aus dem Datenordner heraus', async () => {
    await expect(
      listServerDirectory(volume, '/data/../../etc', { allowedRoot: wurzel }),
    ).rejects.toBeDefined();
  });

  it('bleibt bezahlbar, wenn die Dateien gross sind', async () => {
    /*
     * Der eigentliche Punkt. Ueber den Archiv-Endpunkt haette die Engine diese
     * Datei vollstaendig eingepackt und uebertragen, nur damit ihr Name in der
     * Liste steht. Hier wird sie nicht einmal geoeffnet.
     */
    const gross = path.join(wurzel, 'welt.dat');
    await fs.writeFile(gross, Buffer.alloc(8 * 1024 * 1024, 0x5a));

    const vorher = Date.now();
    const eintraege = await listServerDirectory(volume, '/data');
    const gedauert = Date.now() - vorher;

    expect(eintraege.find((eintrag) => eintrag.name === 'welt.dat')?.sizeBytes).toBe(
      8 * 1024 * 1024,
    );
    expect(gedauert).toBeLessThan(1000);
  });
});
