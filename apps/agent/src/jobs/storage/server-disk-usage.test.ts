import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DISK_USAGE_TTL_MS, ServerDiskUsage } from './server-disk-usage.js';

const SERVER_A = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';
const SERVER_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const MB = 1024 * 1024;

let wurzel: string;
let dataDir: string;

/** Steuerbare Uhr – der Takt wird geprüft, nicht abgewartet. */
class Uhr {
  #jetzt = new Date('2026-09-06T12:00:00.000Z').getTime();

  readonly now = (): Date => new Date(this.#jetzt);

  vor(ms: number): void {
    this.#jetzt += ms;
  }
}

async function schreibe(relativ: string, bytes: number): Promise<void> {
  const pfad = path.join(dataDir, relativ);
  await fs.mkdir(path.dirname(pfad), { recursive: true });
  await fs.writeFile(pfad, Buffer.alloc(bytes, 1));
}

beforeEach(async () => {
  wurzel = await fs.mkdtemp(path.join(os.tmpdir(), 'palantir-serverdisk-'));
  dataDir = path.join(wurzel, 'servers');
  await fs.mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(wurzel, { recursive: true, force: true });
});

describe('ServerDiskUsage – Messung auf der Platte', () => {
  it('meldet die Belegung des Datenordners in MB', async () => {
    await schreibe(`${SERVER_A}/welt/region.mca`, 3 * MB);
    await schreibe(`${SERVER_A}/server.properties`, 1 * MB);

    const belegung = new ServerDiskUsage({ dataDir });

    await expect(belegung.measureNow(SERVER_A)).resolves.toBe(4);
  });

  it('misst je Server getrennt', async () => {
    await schreibe(`${SERVER_A}/a.bin`, 2 * MB);
    await schreibe(`${SERVER_B}/b.bin`, 5 * MB);

    const belegung = new ServerDiskUsage({ dataDir });

    await expect(belegung.measureNow(SERVER_A)).resolves.toBe(2);
    await expect(belegung.measureNow(SERVER_B)).resolves.toBe(5);
  });

  it('liefert null statt zu werfen, wenn der Datenordner fehlt', async () => {
    const belegung = new ServerDiskUsage({ dataDir });

    await expect(belegung.measureNow(SERVER_A)).resolves.toBeNull();
  });

  it('lehnt eine Id ab, die keine Server-Id ist', async () => {
    // Kein Ausbruch über `..`: Die Id muss das UUID-Format haben, sonst wird
    // gar kein Pfad gebildet.
    const belegung = new ServerDiskUsage({ dataDir });

    await expect(belegung.measureNow('../../etc')).resolves.toBeNull();
    await expect(belegung.measureNow('welt')).resolves.toBeNull();
    await expect(belegung.measureNow('')).resolves.toBeNull();
  });

  it('misst nicht hinter einer Verknüpfung, die aus dem Datenordner führt', async (ctx) => {
    const draussen = path.join(wurzel, 'draussen');
    await fs.mkdir(draussen);
    await fs.writeFile(path.join(draussen, 'gross.bin'), Buffer.alloc(8 * MB, 7));

    try {
      await fs.symlink(draussen, path.join(dataDir, SERVER_A));
    } catch {
      // Unter Windows braucht das Anlegen ein Sonderrecht.
      ctx.skip();

      return;
    }

    const belegung = new ServerDiskUsage({ dataDir });

    await expect(belegung.measureNow(SERVER_A)).resolves.toBeNull();
  });

  it('zählt eine Verknüpfung im Datenordner nicht mit', async (ctx) => {
    await schreibe(`${SERVER_A}/echt.bin`, 2 * MB);
    const draussen = path.join(wurzel, 'draussen');
    await fs.mkdir(draussen);
    await fs.writeFile(path.join(draussen, 'gross.bin'), Buffer.alloc(16 * MB, 7));

    try {
      await fs.symlink(draussen, path.join(dataDir, SERVER_A, 'raus'));
    } catch {
      ctx.skip();

      return;
    }

    const belegung = new ServerDiskUsage({ dataDir });

    await expect(belegung.measureNow(SERVER_A)).resolves.toBe(2);
  });
});

describe('ServerDiskUsage – Takt und Zwischenspeicher', () => {
  /** Zählt die Durchläufe und liefert einen einstellbaren Wert. */
  function zaehlendeMessung(startwert: number | null = 7): {
    readonly measure: () => Promise<number | null>;
    laeufe: number;
    wert: number | null;
  } {
    const stand: { laeufe: number; wert: number | null; measure: () => Promise<number | null> } = {
      laeufe: 0,
      wert: startwert,
      measure: async () => {
        stand.laeufe += 1;

        return stand.wert;
      },
    };

    return stand;
  }

  it('gibt beim ersten Aufruf null zurück und misst im Hintergrund', async () => {
    const messung = zaehlendeMessung();
    const belegung = new ServerDiskUsage({ dataDir, measure: messung.measure });

    // Der erste Aufruf wartet nicht auf die Platte – deshalb noch kein Wert.
    expect(belegung.usedMb(SERVER_A)).toBeNull();

    await belegung.settled();

    expect(messung.laeufe).toBe(1);
    expect(belegung.usedMb(SERVER_A)).toBe(7);
  });

  it('misst innerhalb der Frist kein zweites Mal', async () => {
    const uhr = new Uhr();
    const messung = zaehlendeMessung();
    const belegung = new ServerDiskUsage({
      dataDir,
      measure: messung.measure,
      now: uhr.now,
    });

    await belegung.measureNow(SERVER_A);
    expect(messung.laeufe).toBe(1);

    // Fünf Abtastungen im Minutentakt – der Wert kommt aus dem Zwischenspeicher.
    for (let i = 0; i < 4; i += 1) {
      uhr.vor(60_000);
      expect(belegung.usedMb(SERVER_A)).toBe(7);
    }

    await belegung.settled();
    expect(messung.laeufe).toBe(1);
  });

  it('misst nach Ablauf der Frist neu', async () => {
    const uhr = new Uhr();
    const messung = zaehlendeMessung();
    const belegung = new ServerDiskUsage({
      dataDir,
      measure: messung.measure,
      now: uhr.now,
    });

    await belegung.measureNow(SERVER_A);
    uhr.vor(DEFAULT_DISK_USAGE_TTL_MS);
    messung.wert = 9;

    // Der Aufruf nach Ablauf liefert noch den alten Wert und stößt die neue
    // Messung nur an – gewartet wird nie.
    expect(belegung.usedMb(SERVER_A)).toBe(7);

    await belegung.settled();

    expect(messung.laeufe).toBe(2);
    expect(belegung.usedMb(SERVER_A)).toBe(9);
  });

  it('achtet auf eine eigene Frist', async () => {
    const uhr = new Uhr();
    const messung = zaehlendeMessung();
    const belegung = new ServerDiskUsage({
      dataDir,
      measure: messung.measure,
      now: uhr.now,
      ttlMs: 10_000,
    });

    await belegung.measureNow(SERVER_A);
    uhr.vor(9_999);
    belegung.usedMb(SERVER_A);
    await belegung.settled();
    expect(messung.laeufe).toBe(1);

    uhr.vor(1);
    belegung.usedMb(SERVER_A);
    await belegung.settled();
    expect(messung.laeufe).toBe(2);
  });

  it('startet keine zweite Messung, solange die erste läuft', async () => {
    let freigeben: (wert: number | null) => void = () => {};
    let laeufe = 0;

    const belegung = new ServerDiskUsage({
      dataDir,
      measure: async () => {
        laeufe += 1;

        return new Promise<number | null>((resolve) => {
          freigeben = resolve;
        });
      },
    });

    const erste = belegung.measureNow(SERVER_A);
    const zweite = belegung.measureNow(SERVER_A);
    belegung.usedMb(SERVER_A);

    freigeben(3);

    await expect(erste).resolves.toBe(3);
    await expect(zweite).resolves.toBe(3);
    expect(laeufe).toBe(1);
  });

  it('hält auch eine gescheiterte Messung fest, statt jeden Takt neu zu laufen', async () => {
    const uhr = new Uhr();
    const messung = zaehlendeMessung();
    messung.wert = null;

    const belegung = new ServerDiskUsage({
      dataDir,
      measure: messung.measure,
      now: uhr.now,
    });

    await belegung.measureNow(SERVER_A);
    uhr.vor(60_000);
    expect(belegung.usedMb(SERVER_A)).toBeNull();
    await belegung.settled();

    expect(messung.laeufe).toBe(1);
  });

  it('reißt die übrigen Server nicht mit, wenn einer nicht messbar ist', async () => {
    await schreibe(`${SERVER_B}/b.bin`, 3 * MB);

    const belegung = new ServerDiskUsage({ dataDir });

    // SERVER_A hat keinen Ordner; SERVER_B wird trotzdem gemessen.
    const [a, b] = await Promise.all([
      belegung.measureNow(SERVER_A),
      belegung.measureNow(SERVER_B),
    ]);

    expect(a).toBeNull();
    expect(b).toBe(3);
  });

  it('vergisst den Stand eines Servers auf Wunsch', async () => {
    const messung = zaehlendeMessung();
    const belegung = new ServerDiskUsage({ dataDir, measure: messung.measure });

    await belegung.measureNow(SERVER_A);
    belegung.forget(SERVER_A);

    expect(belegung.usedMb(SERVER_A)).toBeNull();
    await belegung.settled();
    expect(messung.laeufe).toBe(2);
  });

  /*
   * Fundpunkt 176: `usedMb()` stößt die Messung mit `void` an. Wirft die
   * Messung, hat die abgelehnte Zusage dort niemanden, der sie behandelt — und
   * unter Nodes Vorgabe (`--unhandled-rejections=throw`) nimmt sie den ganzen
   * Agent-Prozess mit. Ein Spielserver würde also sterben, weil sich sein
   * Datenordner nicht vermessen ließ.
   */
  it('fängt einen Fehler der Messung ab, statt den Prozess mitzunehmen', async () => {
    const belegung = new ServerDiskUsage({
      dataDir,
      measure: () => Promise.reject(new Error('Ordner zu tief')),
    });

    await expect(belegung.measureNow(SERVER_A)).resolves.toBeNull();
    expect(belegung.usedMb(SERVER_A)).toBeNull();
    await expect(belegung.settled()).resolves.toBeUndefined();
  });

  it('hält den gescheiterten Stand fest, statt in einer Schleife neu zu messen', async () => {
    let laeufe = 0;
    const belegung = new ServerDiskUsage({
      dataDir,
      measure: () => {
        laeufe += 1;

        return Promise.reject(new Error('kaputt'));
      },
    });

    await belegung.measureNow(SERVER_A);
    // Innerhalb der Frist wird nicht erneut gemessen — ein dauerhaft unlesbarer
    // Ordner darf nicht jeden Takt einen neuen Durchlauf auslösen.
    expect(belegung.usedMb(SERVER_A)).toBeNull();
    await belegung.settled();

    expect(laeufe).toBe(1);
  });

  it('behandelt Groß- und Kleinschreibung der Id gleich', async () => {
    const messung = zaehlendeMessung();
    const belegung = new ServerDiskUsage({ dataDir, measure: messung.measure });

    await belegung.measureNow(SERVER_A.toUpperCase());

    expect(belegung.usedMb(SERVER_A)).toBe(7);
    await belegung.settled();
    expect(messung.laeufe).toBe(1);
  });
});
