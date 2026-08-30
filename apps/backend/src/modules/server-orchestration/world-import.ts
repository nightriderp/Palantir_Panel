/**
 * Zwischenspeicher für hochgeladene Weltdaten-Archive (Lastenheft §3.3:
 * „Migration von anderen Hosting-Anbietern"; Arbeitspaket P4).
 *
 * **Warum überhaupt ein Zwischenspeicher.** Der Wizard lädt das Archiv hoch,
 * *bevor* der Server existiert – vorher gibt es weder Datenordner noch
 * Container, in den es gehören könnte. Zwischen Upload und Anlegen liegen die
 * restlichen Wizard-Schritte, also Minuten. Das Archiv wartet deshalb auf der
 * VPS und wird beim Anlegen an den Agent weitergereicht.
 *
 * **Warum auf der Platte und nicht im Speicher.** Ein Archiv darf bis zu
 * `MAX_WORLD_ARCHIVE_BYTES` groß sein und mehrere Nutzer können gleichzeitig
 * hochladen. Im Speicher gehaltene Uploads wären ein Hebel, das Backend allein
 * mit angefangenen Wizards umzubringen.
 *
 * **Aufräumen.** Jeder Upload trägt seine Frist im Dateinamen; abgelaufene
 * Dateien räumt der nächste Upload mit weg (`sweep()`). Bewusst kein eigener
 * Timer und keine zusätzliche Aufgabe im Zeitgeber: Ohne Uploads entstehen auch
 * keine Reste, und ein Verzeichnis, in dem nichts passiert, muss niemand
 * durchsehen.
 */

import { createWriteStream } from 'node:fs';
import os from 'node:os';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { type ArchiveFormat, type WorldArchiveUploadDto } from '@palantir/contracts';
import { ServerOrchestrationError } from './errors.js';

/**
 * Gültigkeitsdauer eines hochgeladenen Archivs.
 *
 * Zwei Stunden decken einen in Ruhe ausgefüllten Wizard ab und halten die
 * Platte trotzdem frei. Bewusst eine Konstante und keine Umgebungsvariable: Es
 * gibt keinen Betriebsfall, in dem hier eine andere Zahl gebraucht würde.
 */
export const WORLD_ARCHIVE_TTL_MS = 2 * 60 * 60 * 1000;

/** Dateiendungen je Format – der Zwischenspeicher merkt sich das Format im Namen. */
const FORMAT_SUFFIX: Record<ArchiveFormat, string> = {
  'tar.gz': 'tgz',
  zip: 'zip',
};

/**
 * Erkennt das Archivformat an den ersten Bytes.
 *
 * Die Dateiendung ist nur ein Hinweis des Nutzers – hier zählt der Inhalt. Ein
 * als `welt.zip` hochgeladenes tar.gz wird korrekt als tar.gz behandelt, und
 * eine umbenannte `.exe` fällt durch.
 *
 * Der Agent prüft dasselbe noch einmal (`runtime/archive.ts`), bevor er
 * entpackt: Das Backend entscheidet hier nur, ob ein Upload überhaupt
 * angenommen wird.
 */
export function detectWorldArchiveFormat(kopf: Buffer): ArchiveFormat | null {
  if (
    kopf.length >= 4 &&
    kopf[0] === 0x50 &&
    kopf[1] === 0x4b &&
    ((kopf[2] === 0x03 && kopf[3] === 0x04) ||
      (kopf[2] === 0x05 && kopf[3] === 0x06) ||
      (kopf[2] === 0x07 && kopf[3] === 0x08))
  ) {
    return 'zip';
  }

  if (kopf.length >= 2 && kopf[0] === 0x1f && kopf[1] === 0x8b) {
    return 'tar.gz';
  }

  return null;
}

/** Vorgabe für `WORLD_ARCHIVE_DIR` – ein eigener Ordner im System-Temp. */
export function defaultWorldArchiveDirectory(): string {
  return path.join(os.tmpdir(), 'palantir-world-archives');
}

/** Ein abgeholtes Archiv, bereit für den Agent. */
export interface StoredWorldArchive {
  readonly uploadId: string;
  readonly content: Buffer;
  readonly format: ArchiveFormat;
}

export interface WorldArchiveStore {
  /**
   * Nimmt einen Upload entgegen.
   *
   * `source` wird gelesen, bis er endet oder die Grenze überschritten ist –
   * gepuffert wird dabei nichts: Ein zu großes Archiv soll nicht erst
   * vollständig ankommen, bevor es abgelehnt wird.
   */
  save(fileName: string, source: AsyncIterable<Buffer>): Promise<WorldArchiveUploadDto>;
  /**
   * Holt ein Archiv ab und entfernt es.
   *
   * Einmalig mit Absicht: Nach dem Anlegen wird es nicht mehr gebraucht, und ein
   * liegengebliebenes Archiv wäre eine Kopie fremder Spielstände ohne Besitzer.
   * `null`, wenn der Verweis unbekannt oder abgelaufen ist.
   */
  take(uploadId: string): Promise<StoredWorldArchive | null>;
  /** Entfernt abgelaufene Archive; liefert die Anzahl. */
  sweep(now?: Date): Promise<number>;
}

export interface WorldArchiveStoreOptions {
  /** Verzeichnis auf der VPS, in dem die Uploads warten. */
  readonly directory: string;
  /** Obergrenze je Archiv in Byte. */
  readonly maxBytes: number;
  /** Nur für Tests: feste Uhr. */
  readonly now?: () => Date;
}

/**
 * Dateiname eines Uploads: `<uploadId>.<ablaufZeitstempel>.<endung>`.
 *
 * Die Frist steht im Namen, damit `sweep()` sie ohne zweite Datenhaltung lesen
 * kann – eine Tabelle für etwas, das nach zwei Stunden ohnehin verschwindet,
 * wäre die schwerere Lösung.
 */
function dateiName(uploadId: string, expiresAt: number, format: ArchiveFormat): string {
  return `${uploadId}.${String(expiresAt)}.${FORMAT_SUFFIX[format]}`;
}

function zerlege(
  name: string,
): { uploadId: string; expiresAt: number; format: ArchiveFormat } | null {
  const teile = name.split('.');

  if (teile.length !== 3) {
    return null;
  }

  const [uploadId, frist, endung] = teile as [string, string, string];
  const expiresAt = Number(frist);
  const format = (Object.keys(FORMAT_SUFFIX) as ArchiveFormat[]).find(
    (kandidat) => FORMAT_SUFFIX[kandidat] === endung,
  );

  if (!Number.isFinite(expiresAt) || format === undefined) {
    return null;
  }

  return { uploadId, expiresAt, format };
}

export function createFileSystemWorldArchiveStore(
  options: WorldArchiveStoreOptions,
): WorldArchiveStore {
  const now = options.now ?? ((): Date => new Date());
  const verzeichnis = path.resolve(options.directory);

  async function sweep(zeitpunkt?: Date): Promise<number> {
    const grenze = (zeitpunkt ?? now()).getTime();

    let namen: string[];

    try {
      namen = await readdir(verzeichnis);
    } catch {
      // Noch kein Upload – nichts aufzuräumen.
      return 0;
    }

    let entfernt = 0;

    for (const name of namen) {
      const eintrag = zerlege(name);

      if (eintrag !== null && eintrag.expiresAt > grenze) {
        continue;
      }

      // Auch Dateien mit unerwartetem Namen fliegen: In diesem Verzeichnis hat
      // nichts anderes etwas verloren.
      await rm(path.join(verzeichnis, name), { force: true });
      entfernt += 1;
    }

    return entfernt;
  }

  return {
    sweep,

    async save(fileName, source) {
      await mkdir(verzeichnis, { recursive: true });
      await sweep();

      const uploadId = randomUUID();
      const vorlaeufig = path.join(verzeichnis, `${uploadId}.teil`);

      let gelesen = 0;
      let kopf = Buffer.alloc(0);
      let zuGross = false;

      async function* begrenzt(): AsyncGenerator<Buffer> {
        for await (const stueck of source) {
          gelesen += stueck.length;

          if (gelesen > options.maxBytes) {
            zuGross = true;

            return;
          }

          if (kopf.length < 4) {
            kopf = Buffer.concat([kopf, stueck.subarray(0, 4)]);
          }

          yield stueck;
        }
      }

      try {
        await pipeline(begrenzt(), createWriteStream(vorlaeufig));

        if (zuGross) {
          throw new ServerOrchestrationError(
            'FILE_TOO_LARGE',
            `Das Archiv überschreitet die zulässige Größe von ${String(options.maxBytes)} Byte.`,
          );
        }

        const format = detectWorldArchiveFormat(kopf);

        if (format === null) {
          throw new ServerOrchestrationError('WORLD_ARCHIVE_INVALID');
        }

        const expiresAt = now().getTime() + WORLD_ARCHIVE_TTL_MS;
        const ziel = path.join(verzeichnis, dateiName(uploadId, expiresAt, format));

        // Umbenennen statt direkt schreiben: Erst wenn Größe und Format
        // feststehen, bekommt die Datei den Namen, unter dem `take()` sie findet.
        await rename(vorlaeufig, ziel);

        return {
          uploadId,
          fileName,
          sizeBytes: gelesen,
          format,
          expiresAt: new Date(expiresAt).toISOString(),
        };
      } catch (error: unknown) {
        await rm(vorlaeufig, { force: true });

        throw error;
      }
    },

    async take(uploadId) {
      let namen: string[];

      try {
        namen = await readdir(verzeichnis);
      } catch {
        return null;
      }

      const treffer = namen
        .map((name) => ({ name, eintrag: zerlege(name) }))
        .find(({ eintrag }) => eintrag !== null && eintrag.uploadId === uploadId);

      if (treffer?.eintrag === undefined || treffer.eintrag === null) {
        return null;
      }

      const datei = path.join(verzeichnis, treffer.name);

      if (treffer.eintrag.expiresAt <= now().getTime()) {
        await rm(datei, { force: true });

        return null;
      }

      const content = await readFile(datei);
      await rm(datei, { force: true });

      return { uploadId, content, format: treffer.eintrag.format };
    },
  };
}
