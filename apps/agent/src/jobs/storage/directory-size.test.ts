import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directorySize } from './directory-size.js';

let wurzel: string;

async function schreibe(relativ: string, bytes: number): Promise<string> {
  const pfad = path.join(wurzel, relativ);
  await fs.mkdir(path.dirname(pfad), { recursive: true });
  await fs.writeFile(pfad, Buffer.alloc(bytes, 1));

  return pfad;
}

/**
 * Legt eine symbolische Verknüpfung an – oder meldet, dass die Plattform sie
 * nicht zulässt.
 *
 * Unter Windows braucht das Anlegen ein Recht, das ein gewöhnlicher Benutzer
 * nicht hat. Der Test überspringt sich dann selbst, statt auf dem
 * Entwicklungsrechner rot zu sein; in der CI (Linux) läuft er immer.
 */
async function verknuepfe(ziel: string, unter: string): Promise<boolean> {
  try {
    await fs.symlink(ziel, path.join(wurzel, unter));

    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-baumgroesse-'));
});

afterEach(async () => {
  await fs.rm(wurzel, { recursive: true, force: true });
});

describe('directorySize', () => {
  it('summiert die Dateigrößen eines Ordnerbaums', async () => {
    await schreibe('welt/region/r.0.0.mca', 4_096);
    await schreibe('welt/level.dat', 1_024);
    await schreibe('server.properties', 512);

    await expect(directorySize(wurzel)).resolves.toMatchObject({ sizeBytes: 5_632 });
  });

  it('zählt einen leeren Ordner als 0', async () => {
    const leer = path.join(wurzel, 'leer');
    await fs.mkdir(leer);

    await expect(directorySize(leer)).resolves.toMatchObject({ sizeBytes: 0 });
  });

  it('meldet die jüngste Änderung des Baums', async () => {
    const datei = await schreibe('welt/level.dat', 8);
    // Bewusst in der Zukunft: Sonst wäre die jüngste Änderung die des gerade
    // angelegten Ordners, nicht die der Datei.
    const spaeter = new Date('2027-01-01T00:00:00.000Z');
    await fs.utimes(datei, spaeter, spaeter);

    const groesse = await directorySize(path.join(wurzel, 'welt'));

    expect(groesse?.lastModifiedAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('liefert null statt zu werfen, wenn der Ordner fehlt', async () => {
    await expect(directorySize(path.join(wurzel, 'gibt-es-nicht'))).resolves.toBeNull();
  });

  it('liefert null, wenn die Wurzel gar kein Verzeichnis ist', async () => {
    const datei = await schreibe('datei.txt', 16);

    await expect(directorySize(datei)).resolves.toBeNull();
  });

  it('überspringt einen unlesbaren Unterordner, statt den Lauf abzubrechen', async (ctx) => {
    await schreibe('lesbar/a.bin', 2_048);
    const gesperrt = path.join(wurzel, 'gesperrt');
    await schreibe('gesperrt/b.bin', 1_024);
    await fs.chmod(gesperrt, 0o000);

    // Unter Windows ist `chmod` wirkungslos, und als root greift die Sperre
    // ebenfalls nicht. Dann gibt es hier nichts zu prüfen.
    const gesperrtWirkt = await fs
      .readdir(gesperrt)
      .then(() => false)
      .catch(() => true);

    if (!gesperrtWirkt) {
      await fs.chmod(gesperrt, 0o700);
      ctx.skip();

      return;
    }

    try {
      // Die 1 KiB hinter der Sperre fehlt, die 2 KiB davor sind trotzdem da.
      await expect(directorySize(wurzel)).resolves.toMatchObject({ sizeBytes: 2_048 });
    } finally {
      await fs.chmod(gesperrt, 0o700);
    }
  });

  describe('symbolische Verknüpfungen', () => {
    it('folgt keiner Verknüpfung aus dem Ordner heraus', async (ctx) => {
      const draussen = path.join(wurzel, 'draussen');
      await fs.mkdir(draussen);
      await fs.writeFile(path.join(draussen, 'gross.bin'), Buffer.alloc(65_536, 7));

      const drinnen = path.join(wurzel, 'drinnen');
      await fs.mkdir(drinnen);
      await fs.writeFile(path.join(drinnen, 'klein.bin'), Buffer.alloc(1_024, 1));

      if (!(await verknuepfe(draussen, 'drinnen/raus'))) {
        ctx.skip();

        return;
      }

      // Nur die eigene Datei zählt – die 64 KiB hinter der Verknüpfung nicht.
      await expect(directorySize(drinnen)).resolves.toMatchObject({ sizeBytes: 1_024 });
    });

    it('läuft nicht endlos, wenn eine Verknüpfung auf einen Vorfahren zeigt', async (ctx) => {
      const drinnen = path.join(wurzel, 'drinnen');
      await fs.mkdir(drinnen);
      await fs.writeFile(path.join(drinnen, 'klein.bin'), Buffer.alloc(2_048, 1));

      if (!(await verknuepfe(drinnen, 'drinnen/ich-selbst'))) {
        ctx.skip();

        return;
      }

      await expect(directorySize(drinnen)).resolves.toMatchObject({ sizeBytes: 2_048 });
    });

    it('zählt eine Verknüpfung auf eine Datei nicht doppelt', async (ctx) => {
      await schreibe('drinnen/echt.bin', 4_096);

      if (!(await verknuepfe(path.join(wurzel, 'drinnen/echt.bin'), 'drinnen/kopie.bin'))) {
        ctx.skip();

        return;
      }

      await expect(directorySize(path.join(wurzel, 'drinnen'))).resolves.toMatchObject({
        sizeBytes: 4_096,
      });
    });
  });
});
