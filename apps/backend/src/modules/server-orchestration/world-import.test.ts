/**
 * Zwischenspeicher der hochgeladenen Weltdaten-Archive (Arbeitspaket P4).
 *
 * Geprüft wird gegen ein echtes Verzeichnis unter `os.tmpdir()`: Der Speicher
 * ist genau deshalb dateibasiert, weil er nichts im Arbeitsspeicher halten
 * soll – ein Test gegen eine Attrappe würde das Verhalten prüfen, das gerade
 * nicht gebaut wurde.
 */

import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WORLD_ARCHIVE_MAX_PENDING_PER_OWNER,
  WORLD_ARCHIVE_TTL_MS,
  createFileSystemWorldArchiveStore,
  detectWorldArchiveFormat,
} from './world-import.js';

const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 1)]);
const TAR_GZ = gzipSync(Buffer.alloc(64, 2));

/** Zwei Konten – der Zwischenspeicher bindet jeden Verweis an eines davon. */
const ANNA = '11111111-1111-4111-8111-111111111111';
const BERND = '22222222-2222-4222-8222-222222222222';

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

/** Kurzform für die Tests, die sich nicht um den Besitzer kümmern. */
function ablegen(
  speicher: ReturnType<typeof store>,
  fileName: string,
  quelle: AsyncIterable<Buffer>,
  ownerId = ANNA,
) {
  return speicher.save(fileName, quelle, { ownerId });
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

    const upload = await ablegen(speicher, 'welt.zip', strom(ZIP));

    expect(upload).toMatchObject({ fileName: 'welt.zip', sizeBytes: ZIP.length, format: 'zip' });
    expect(Date.parse(upload.expiresAt)).toBe(jetzt.getTime() + WORLD_ARCHIVE_TTL_MS);

    const abgeholt = await speicher.take(upload.uploadId, ANNA);

    expect(abgeholt?.format).toBe('zip');
    expect(abgeholt?.sizeBytes).toBe(ZIP.byteLength);
    expect(await abgeholt?.read(0, ZIP.byteLength)).toEqual(ZIP);
    await abgeholt?.release();
  });

  it('setzt das Format nach dem Inhalt, nicht nach der Endung', async () => {
    const speicher = store();

    const upload = await ablegen(speicher, 'welt.zip', strom(TAR_GZ));

    expect(upload.format).toBe('tar.gz');
  });

  it('gibt ein Archiv nur einmal heraus', async () => {
    const speicher = store();
    const upload = await ablegen(speicher, 'welt.zip', strom(ZIP));

    expect(await speicher.take(upload.uploadId, ANNA)).not.toBeNull();
    expect(await speicher.take(upload.uploadId, ANNA)).toBeNull();
  });

  it('kennt einen unbekannten Verweis nicht', async () => {
    expect(await store().take('11111111-1111-4111-8111-111111111111', ANNA)).toBeNull();
  });

  it('setzt den Strom aus mehreren Blöcken korrekt zusammen', async () => {
    const speicher = store();
    const upload = await ablegen(
      speicher,
      'welt.zip',
      strom(ZIP.subarray(0, 2), ZIP.subarray(2, 10), ZIP.subarray(10)),
    );

    const abgeholt = await speicher.take(upload.uploadId, ANNA);

    expect(await abgeholt?.read(0, ZIP.byteLength)).toEqual(ZIP);
    await abgeholt?.release();
  });
});

/**
 * Besitzerbindung des Verweises (Audit orchestration-features-09).
 *
 * Vorher reichte die Kenntnis der `uploadId`: Wer sie irgendwo aufschnappte,
 * konnte das fremde Archiv in seinen eigenen Server einspielen – und entzog es
 * dem Eigentümer, weil `take()` einmalig ist.
 */
describe('Besitz', () => {
  it('gibt ein fremdes Archiv nicht heraus und lässt es dem Eigentümer', async () => {
    const speicher = store();
    const upload = await ablegen(speicher, 'welt.zip', strom(ZIP), ANNA);

    // Wie ein unbekannter Verweis – nicht wie ein verbotener. Der Aufrufer
    // erfährt so nicht, dass es diese uploadId überhaupt gibt.
    expect(await speicher.take(upload.uploadId, BERND)).toBeNull();

    const eigenes = await speicher.take(upload.uploadId, ANNA);

    expect(eigenes).not.toBeNull();
    await eigenes?.release();
  });

  it('trennt gleichzeitige Uploads zweier Konten', async () => {
    const speicher = store();
    const [a, b] = await Promise.all([
      ablegen(speicher, 'a.zip', strom(ZIP), ANNA),
      ablegen(speicher, 'b.zip', strom(TAR_GZ), BERND),
    ]);

    expect(await speicher.take(a.uploadId, BERND)).toBeNull();
    expect(await speicher.take(b.uploadId, ANNA)).toBeNull();

    const fuerAnna = await speicher.take(a.uploadId, ANNA);
    const fuerBernd = await speicher.take(b.uploadId, BERND);

    expect(fuerAnna?.format).toBe('zip');
    expect(fuerBernd?.format).toBe('tar.gz');
    await fuerAnna?.release();
    await fuerBernd?.release();
  });
});

describe('Abweisen', () => {
  it('lehnt ein zu großes Archiv ab und lässt nichts liegen', async () => {
    const speicher = store(32);

    await expect(ablegen(speicher, 'welt.zip', strom(ZIP))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
    expect(await readdir(verzeichnis)).toEqual([]);
  });

  it('lehnt ein fremdes Format ab und lässt nichts liegen', async () => {
    const speicher = store();

    await expect(
      ablegen(speicher, 'welt.exe', strom(Buffer.from('MZ nope'))),
    ).rejects.toMatchObject({
      code: 'WORLD_ARCHIVE_INVALID',
    });
    expect(await readdir(verzeichnis)).toEqual([]);
  });

  it('lehnt ein gekapptes Archiv ab, bevor es einen gültigen Namen bekommt', async () => {
    // Der Fall aus orchestration-features-05: Die Multipart-Ebene hat den
    // Strom genau an der eigenen Grenze abgeschnitten, die eigene Zählung
    // schlägt deshalb nicht an – der Kopf ist trotzdem gültig, das Archiv
    // unbrauchbar. Früher lag es danach bis zur Frist im Zwischenspeicher.
    const speicher = store(ZIP.byteLength);

    await expect(
      speicher.save('welt.zip', strom(ZIP), { ownerId: ANNA, isTruncated: () => true }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(await readdir(verzeichnis)).toEqual([]);
  });
});

describe('Frist', () => {
  it('gibt ein abgelaufenes Archiv nicht mehr heraus', async () => {
    const speicher = store();
    const upload = await ablegen(speicher, 'welt.zip', strom(ZIP));

    jetzt = new Date(jetzt.getTime() + WORLD_ARCHIVE_TTL_MS + 1);

    expect(await speicher.take(upload.uploadId, ANNA)).toBeNull();
    expect(await readdir(verzeichnis)).toEqual([]);
  });

  it('räumt abgelaufene Archive beim nächsten Upload weg', async () => {
    const speicher = store();
    await ablegen(speicher, 'alt.zip', strom(ZIP));

    jetzt = new Date(jetzt.getTime() + WORLD_ARCHIVE_TTL_MS + 1);
    const neu = await ablegen(speicher, 'neu.zip', strom(ZIP));

    const inhalt = await readdir(verzeichnis);

    expect(inhalt).toHaveLength(1);
    expect(inhalt[0]).toContain(neu.uploadId);
  });

  it('lässt ein noch gültiges Archiv beim Aufräumen stehen', async () => {
    const speicher = store();
    const upload = await ablegen(speicher, 'welt.zip', strom(ZIP));

    expect(await speicher.sweep()).toBe(0);
    expect(await speicher.take(upload.uploadId, ANNA)).not.toBeNull();
  });
});

/**
 * Gleichzeitige Uploads (Audit orchestration-features-02).
 *
 * `save()` räumt zu Beginn auf – auch mitten in einem fremden, noch laufenden
 * Upload. Dessen halbfertige `<uuid>.teil` fiel früher durch das Raster
 * („Dateien mit unerwartetem Namen fliegen"), womit ein gültiger, minutenlanger
 * Upload am abschließenden `rename` mit ENOENT scheiterte.
 */
describe('Gleichzeitige Uploads', () => {
  /** Ein Strom, der erst weiterläuft, wenn `weiter()` gerufen wurde. */
  function langsamerStrom(...bloecke: Buffer[]): {
    quelle: AsyncGenerator<Buffer>;
    begonnen: Promise<void>;
    weiter: () => void;
  } {
    let begonnenAufloesen = (): void => undefined;
    let weiterAufloesen = (): void => undefined;
    const begonnen = new Promise<void>((resolve) => {
      begonnenAufloesen = resolve;
    });
    const angehalten = new Promise<void>((resolve) => {
      weiterAufloesen = resolve;
    });

    async function* quelle(): AsyncGenerator<Buffer> {
      const [erster, ...rest] = bloecke;

      if (erster !== undefined) {
        yield erster;
      }

      begonnenAufloesen();
      await angehalten;

      for (const block of rest) {
        yield block;
      }
    }

    return { quelle: quelle(), begonnen, weiter: weiterAufloesen };
  }

  /** Wartet, bis die angefangene Datei eines laufenden Uploads im Ordner liegt. */
  async function warteAufAngefangene(): Promise<string> {
    for (let versuch = 0; versuch < 200; versuch += 1) {
      const treffer = (await readdir(verzeichnis)).filter((name) => name.endsWith('.teil'));

      if (treffer[0] !== undefined) {
        return treffer[0];
      }

      await new Promise((weiter) => setTimeout(weiter, 5));
    }

    throw new Error('Es ist keine .teil-Datei entstanden.');
  }

  it('räumt die angefangene Datei eines laufenden Uploads nicht weg', async () => {
    const speicher = store();
    const langsam = langsamerStrom(ZIP.subarray(0, 8), ZIP.subarray(8));

    // A läuft und hängt mitten im Schreiben – seine `.teil` liegt im Ordner.
    const laufend = ablegen(speicher, 'a.zip', langsam.quelle, ANNA);
    await langsam.begonnen;
    await warteAufAngefangene();

    // B startet dazwischen; sein `save()` beginnt mit dem Aufräumen.
    const b = await ablegen(speicher, 'b.zip', strom(TAR_GZ), BERND);

    langsam.weiter();
    const a = await laufend;

    // Beide Uploads sind vollständig und einzeln abholbar.
    expect(a.sizeBytes).toBe(ZIP.byteLength);
    expect(b.sizeBytes).toBe(TAR_GZ.byteLength);

    const archivA = await speicher.take(a.uploadId, ANNA);
    const archivB = await speicher.take(b.uploadId, BERND);

    expect(await archivA?.read(0, ZIP.byteLength)).toEqual(ZIP);
    expect(await archivB?.read(0, TAR_GZ.byteLength)).toEqual(TAR_GZ);
    await archivA?.release();
    await archivB?.release();
  });

  it('entfernt eine liegengebliebene .teil-Datei nach Ablauf der Frist', async () => {
    const leiche = path.join(verzeichnis, 'abgebrochen.teil');
    await writeFile(leiche, 'halbes Archiv');
    const alt = new Date(Date.now() - WORLD_ARCHIVE_TTL_MS - 60_000);
    await utimes(leiche, alt, alt);

    // Die Uhr des Speichers zeigt Testzeit; die Frist der `.teil` hängt an der
    // Änderungszeit der Datei, deshalb wird hier die echte Uhr gestellt.
    const speicher = createFileSystemWorldArchiveStore({
      directory: verzeichnis,
      maxBytes: 1024,
      now: () => new Date(),
    });

    expect(await speicher.sweep()).toBe(1);
    expect(await readdir(verzeichnis)).toEqual([]);
  });
});

/**
 * Kontingent des Zwischenspeichers (Audit W2-3, `orchestration-features-06`).
 *
 * Ohne die beiden Grenzen konnte ein Konto mit `server.create` in Schleife
 * Archive hochladen, bis die Platte der VPS voll war – `sweep()` entfernt nur
 * Abgelaufenes.
 */
describe('Kontingent', () => {
  /** Wie viele Dateien gerade im Zwischenspeicher liegen. */
  async function dateien(): Promise<string[]> {
    return readdir(verzeichnis);
  }

  it('lässt ein Konto höchstens die vorgesehene Zahl Archive warten', async () => {
    const speicher = createFileSystemWorldArchiveStore({
      directory: verzeichnis,
      maxBytes: 1024,
      now: () => jetzt,
    });

    for (let nummer = 0; nummer < WORLD_ARCHIVE_MAX_PENDING_PER_OWNER; nummer += 1) {
      await ablegen(speicher, `welt-${String(nummer)}.zip`, strom(ZIP));
    }

    await expect(ablegen(speicher, 'einer-zu-viel.zip', strom(ZIP))).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });

    // Der abgewiesene Upload hat nichts hinterlassen – auch keine `.teil`-Datei.
    expect(await dateien()).toHaveLength(WORLD_ARCHIVE_MAX_PENDING_PER_OWNER);
  });

  it('zählt je Konto: ein anderes Konto darf weiter hochladen', async () => {
    const speicher = createFileSystemWorldArchiveStore({
      directory: verzeichnis,
      maxBytes: 1024,
      now: () => jetzt,
    });

    for (let nummer = 0; nummer < WORLD_ARCHIVE_MAX_PENDING_PER_OWNER; nummer += 1) {
      await ablegen(speicher, `welt-${String(nummer)}.zip`, strom(ZIP), ANNA);
    }

    await expect(ablegen(speicher, 'noch-eine.zip', strom(ZIP), ANNA)).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });

    const fremd = await ablegen(speicher, 'berndts-welt.zip', strom(ZIP), BERND);

    expect(fremd.format).toBe('zip');
  });

  it('gibt ein Kontingent frei, sobald das Archiv abgeholt ist', async () => {
    const speicher = createFileSystemWorldArchiveStore({
      directory: verzeichnis,
      maxBytes: 1024,
      now: () => jetzt,
    });

    const erster = await ablegen(speicher, 'welt-0.zip', strom(ZIP));
    await ablegen(speicher, 'welt-1.zip', strom(ZIP));

    const abgeholt = await speicher.take(erster.uploadId, ANNA);
    await abgeholt?.release();

    const nachschlag = await ablegen(speicher, 'welt-2.zip', strom(ZIP));

    expect(nachschlag.format).toBe('zip');
  });

  it('weist einen Upload ab, wenn der Zwischenspeicher insgesamt ausgelastet ist', async () => {
    const speicher = createFileSystemWorldArchiveStore({
      directory: verzeichnis,
      maxBytes: 1024,
      // Platz für genau ein Archiv dieser Größe – danach greift schon die
      // Prüfung vor dem Anlegen der Datei.
      maxTotalBytes: ZIP.byteLength,
      now: () => jetzt,
    });

    await ablegen(speicher, 'welt-0.zip', strom(ZIP), ANNA);

    await expect(ablegen(speicher, 'welt-1.zip', strom(ZIP), BERND)).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });

    expect(await dateien()).toHaveLength(1);
  });

  it('bricht auch mitten im Strom ab, wenn das Gesamtbudget reißt', async () => {
    const speicher = createFileSystemWorldArchiveStore({
      directory: verzeichnis,
      maxBytes: 4096,
      // Das leere Verzeichnis kommt durch die Vorabprüfung; erst der Strom
      // selbst überschreitet das Budget.
      maxTotalBytes: 8,
      now: () => jetzt,
    });

    await expect(ablegen(speicher, 'welt.zip', strom(ZIP))).rejects.toMatchObject({
      code: 'RESOURCE_LIMIT_EXCEEDED',
    });

    expect(await dateien()).toHaveLength(0);
  });
});
