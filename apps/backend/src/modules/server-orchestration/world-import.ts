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
 * durchsehen. Eine gerade entstehende Datei (`.teil`) ist davon ausgenommen,
 * solange sie jünger als die Frist ist (Audit orchestration-features-02).
 *
 * **Besitz.** Ein Verweis (`uploadId`) allein berechtigt nicht: Im Namen steht
 * zusätzlich der Fingerabdruck des hochladenden Kontos, und `take()` gibt ein
 * Archiv nur an dieses Konto heraus (Audit orchestration-features-09). Eine
 * fremde `uploadId` sieht deshalb aus wie eine unbekannte – kein Orakel, das
 * die Existenz fremder Uploads bestätigt.
 *
 * **Kontingent.** Zwei Grenzen begrenzen den Zwischenspeicher (Audit W2-3,
 * `orchestration-features-06`): wie viele Archive ein Konto gleichzeitig warten
 * lassen darf ({@link WORLD_ARCHIVE_MAX_PENDING_PER_OWNER}) und wieviel Platz
 * das Verzeichnis insgesamt belegen darf. Ohne beide konnte ein Konto mit
 * `server.create` in Schleife Archive hochladen, bis die Platte der VPS voll
 * war – und traf damit auch jeden anderen Dienst darauf, denn der Vorgabeort
 * ist das System-Temp. `sweep()` half nicht: Es entfernt nur *Abgelaufenes* und
 * läuft ohnehin erst beim nächsten Upload.
 */

import { createWriteStream } from 'node:fs';
import os from 'node:os';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
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

/**
 * Wieviele Archive ein Konto gleichzeitig warten lassen darf (Audit W2-3,
 * `orchestration-features-06`).
 *
 * Der Wizard braucht genau eines. Zwei lassen Raum für den Fall, dass jemand
 * einen angefangenen Wizard liegen lässt und neu beginnt, ohne dass er dafür
 * die Frist von zwei Stunden abwarten muss. Alles darüber ist keine Migration
 * mehr, sondern eine Schleife.
 */
export const WORLD_ARCHIVE_MAX_PENDING_PER_OWNER = 2;

/**
 * Wieviel Platz der Zwischenspeicher insgesamt belegen darf – ausgedrückt als
 * Vielfaches der Grenze je Archiv.
 *
 * Als Faktor und nicht als absolute Zahl, damit die Gesamtgrenze der
 * eingestellten Archivgröße folgt: Bei den vorgegebenen 256 MiB je Archiv sind
 * das 2 GiB für alle wartenden Uploads zusammen – genug für mehrere parallele
 * Migrationen, wenig genug, um eine VPS-Platte nicht zu füllen. Bewusst keine
 * eigene Umgebungsvariable (CLAUDE.md §8): Wer mehr Spielraum braucht, hebt
 * `MAX_WORLD_ARCHIVE_BYTES`, und die Gesamtgrenze zieht mit.
 */
const WORLD_ARCHIVE_TOTAL_BUDGET_FACTOR = 8;

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

/**
 * Ein abgeholtes Archiv, bereit für den Agent.
 *
 * Blockweise statt als ein Puffer (Gefundener Punkt 106): Ein Archiv darf
 * mehrere hundert Megabyte groß sein, und es ganz in den Speicher zu laden,
 * nur um es gleich wieder in Blöcken weiterzugeben, wäre genau der Engpass,
 * den die blockweise Übertragung beseitigen soll.
 */
export interface StoredWorldArchive {
  readonly uploadId: string;
  readonly format: ArchiveFormat;
  readonly sizeBytes: number;
  /**
   * Liest einen Block ab `offset`; am Ende einen leeren Puffer.
   *
   * Nach {@link release} nicht mehr aufrufen.
   */
  read(offset: number, maxBytes: number): Promise<Buffer>;
  /**
   * Gibt die Datei frei und entfernt sie – immer aufrufen, auch nach einem
   * Fehler. Danach ist der Verweis verbraucht.
   */
  release(): Promise<void>;
}

/** Was beim Ablegen neben dem Datenstrom bekannt sein muss. */
export interface SaveWorldArchiveOptions {
  /**
   * Konto, das den Upload startet. Nur dieses Konto bekommt das Archiv über
   * {@link WorldArchiveStore.take} zurück (orchestration-features-09).
   */
  readonly ownerId: string;
  /**
   * Meldet, ob die Multipart-Ebene den Datenstrom gekappt hat.
   *
   * Wird **vor** dem Umbenennen ausgewertet (orchestration-features-05): Ein
   * abgeschnittenes Archiv soll gar nicht erst unter einem gültigen Namen im
   * Zwischenspeicher landen und dort bis zur Frist liegen bleiben.
   */
  readonly isTruncated?: () => boolean;
}

export interface WorldArchiveStore {
  /**
   * Nimmt einen Upload entgegen.
   *
   * `source` wird gelesen, bis er endet oder die Grenze überschritten ist –
   * gepuffert wird dabei nichts: Ein zu großes Archiv soll nicht erst
   * vollständig ankommen, bevor es abgelehnt wird.
   */
  save(
    fileName: string,
    source: AsyncIterable<Buffer>,
    options: SaveWorldArchiveOptions,
  ): Promise<WorldArchiveUploadDto>;
  /**
   * Holt ein Archiv ab und entfernt es.
   *
   * Einmalig mit Absicht: Nach dem Anlegen wird es nicht mehr gebraucht, und ein
   * liegengebliebenes Archiv wäre eine Kopie fremder Spielstände ohne Besitzer.
   * `null`, wenn der Verweis unbekannt, abgelaufen **oder fremd** ist – ein
   * fremdes Archiv ist von einem nicht existierenden nicht zu unterscheiden.
   */
  take(uploadId: string, ownerId: string): Promise<StoredWorldArchive | null>;
  /** Entfernt abgelaufene Archive; liefert die Anzahl. */
  sweep(now?: Date): Promise<number>;
}

export interface WorldArchiveStoreOptions {
  /** Verzeichnis auf der VPS, in dem die Uploads warten. */
  readonly directory: string;
  /** Obergrenze je Archiv in Byte. */
  readonly maxBytes: number;
  /**
   * Wartende Archive je Konto; Vorgabe
   * {@link WORLD_ARCHIVE_MAX_PENDING_PER_OWNER}.
   */
  readonly maxPendingPerOwner?: number;
  /**
   * Gesamter Platz des Verzeichnisses in Byte; Vorgabe das
   * {@link WORLD_ARCHIVE_TOTAL_BUDGET_FACTOR}-fache von `maxBytes`.
   */
  readonly maxTotalBytes?: number;
  /** Nur für Tests: feste Uhr. */
  readonly now?: () => Date;
}

/**
 * Fingerabdruck des Besitzers – 32 Hex-Zeichen aus SHA-256.
 *
 * Nicht die Konto-ID selbst: Ein Dateiname im System-Temp der VPS ist für jeden
 * lesbar, der dort hineinsieht, und wer welche Welt hochlädt, gehört nicht
 * dorthin. Der Fingerabdruck reicht für den einzigen Zweck – vergleichen, ob
 * dasselbe Konto abholt, das hochgeladen hat – und ist nebenbei garantiert frei
 * von Punkten und Pfadtrennern.
 */
function besitzerMarke(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 32);
}

/**
 * Dateiname eines Uploads:
 * `<uploadId>.<besitzerMarke>.<ablaufZeitstempel>.<endung>`.
 *
 * Die Frist steht im Namen, damit `sweep()` sie ohne zweite Datenhaltung lesen
 * kann – eine Tabelle für etwas, das nach zwei Stunden ohnehin verschwindet,
 * wäre die schwerere Lösung. Der Besitzer steht aus demselben Grund daneben
 * (orchestration-features-09).
 */
function dateiName(
  uploadId: string,
  ownerId: string,
  expiresAt: number,
  format: ArchiveFormat,
): string {
  return `${uploadId}.${besitzerMarke(ownerId)}.${String(expiresAt)}.${FORMAT_SUFFIX[format]}`;
}

/** Namenszusatz eines Archivs, das gerade zum Agent uebertragen wird. */
const IN_ARBEIT = '.taken';

/** Namenszusatz eines Uploads, der gerade geschrieben wird. */
const IN_ANNAHME = '.teil';

function zerlege(name: string): {
  uploadId: string;
  ownerMark: string;
  expiresAt: number;
  format: ArchiveFormat;
} | null {
  const teile = name.split('.');

  if (teile.length !== 4) {
    return null;
  }

  const [uploadId, ownerMark, frist, endung] = teile as [string, string, string, string];
  const expiresAt = Number(frist);
  const format = (Object.keys(FORMAT_SUFFIX) as ArchiveFormat[]).find(
    (kandidat) => FORMAT_SUFFIX[kandidat] === endung,
  );

  if (!Number.isFinite(expiresAt) || format === undefined) {
    return null;
  }

  return { uploadId, ownerMark, expiresAt, format };
}

export function createFileSystemWorldArchiveStore(
  options: WorldArchiveStoreOptions,
): WorldArchiveStore {
  const now = options.now ?? ((): Date => new Date());
  const verzeichnis = path.resolve(options.directory);
  const maxWartendJeBesitzer = options.maxPendingPerOwner ?? WORLD_ARCHIVE_MAX_PENDING_PER_OWNER;
  const maxGesamtBytes =
    options.maxTotalBytes ?? options.maxBytes * WORLD_ARCHIVE_TOTAL_BUDGET_FACTOR;

  /**
   * Was gerade im Zwischenspeicher liegt (Audit W2-3,
   * `orchestration-features-06`).
   *
   * `gesamtBytes` zählt **jede** Datei im Verzeichnis, auch angefangene
   * (`.teil`) und gerade zum Agent laufende (`.taken`): Sie belegen Platz auf
   * derselben Platte, egal wie sie heißen. `wartendJeBesitzer` zählt dagegen nur
   * fertige, noch abholbare Archive – ein Upload, der gerade in den Container
   * wandert, ist im Begriff zu verschwinden und darf den Wizard des Besitzers
   * nicht blockieren.
   */
  async function belegung(): Promise<{
    gesamtBytes: number;
    wartendJeBesitzer: ReadonlyMap<string, number>;
  }> {
    let namen: string[];

    try {
      namen = await readdir(verzeichnis);
    } catch {
      return { gesamtBytes: 0, wartendJeBesitzer: new Map() };
    }

    let gesamtBytes = 0;
    const wartendJeBesitzer = new Map<string, number>();

    for (const name of namen) {
      // Eine Datei, die zwischen `readdir` und `stat` verschwindet, zählt als
      // nicht vorhanden – der nächste Upload sieht ohnehin den neuen Stand.
      const eigenschaften = await stat(path.join(verzeichnis, name)).catch(() => null);

      gesamtBytes += eigenschaften?.size ?? 0;

      if (name.endsWith(IN_ANNAHME) || name.endsWith(IN_ARBEIT)) {
        continue;
      }

      const eintrag = zerlege(name);

      if (eintrag !== null) {
        wartendJeBesitzer.set(
          eintrag.ownerMark,
          (wartendJeBesitzer.get(eintrag.ownerMark) ?? 0) + 1,
        );
      }
    }

    return { gesamtBytes, wartendJeBesitzer };
  }

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
      /*
       * Ein Upload, der gerade geschrieben wird, heisst `<uuid>.teil` und
       * traegt noch keine Frist im Namen (orchestration-features-02). Er wird
       * hier verschont, solange er jünger als die Frist ist: Der Sweep läuft zu
       * Beginn *jedes* Uploads, also auch mitten in einem fremden, minutenlang
       * laufenden. Wurde er früher entfernt, schrieb dessen `pipeline` in eine
       * entkettete Inode weiter und das abschließende `rename` scheiterte mit
       * ENOENT – ein gültiger Upload endete als 500.
       */
      if (name.endsWith(IN_ANNAHME)) {
        const angefangen = await stat(path.join(verzeichnis, name)).catch(() => null);

        if (angefangen !== null && grenze - angefangen.mtimeMs < WORLD_ARCHIVE_TTL_MS) {
          continue;
        }
      }

      // Ein Archiv, das gerade blockweise an den Agent geht, traegt den Zusatz
      // `.taken` (Gefundener Punkt 106). Es gehoert einem laufenden Import und
      // wird von diesem selbst entfernt - hier faellt es nur, wenn seine Frist
      // abgelaufen ist, also der Import abgebrochen wurde.
      const eintrag = zerlege(name.endsWith(IN_ARBEIT) ? name.slice(0, -IN_ARBEIT.length) : name);

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

    // `auftrag` und nicht `options`: Der Name der Fabrik-Optionen darf hier
    // nicht verdeckt werden – `begrenzt()` unten liest daraus `maxBytes`.
    async save(fileName, source, auftrag) {
      await mkdir(verzeichnis, { recursive: true });
      await sweep();

      /*
       * Kontingent **vor** dem Anlegen der Datei (Audit W2-3,
       * `orchestration-features-06`): Ein abgewiesener Upload soll keine
       * `.teil`-Datei hinterlassen, die erst der nächste Sweep abräumt. Der
       * Sweep oben ist gerade gelaufen, gezählt wird also nur, was wirklich
       * noch gilt.
       */
      const { gesamtBytes, wartendJeBesitzer } = await belegung();
      const marke = besitzerMarke(auftrag.ownerId);

      if ((wartendJeBesitzer.get(marke) ?? 0) >= maxWartendJeBesitzer) {
        throw new ServerOrchestrationError(
          'RESOURCE_LIMIT_EXCEEDED',
          `Es warten bereits ${String(maxWartendJeBesitzer)} hochgeladene Archive dieses Kontos. Bitte lege den Server damit an oder warte, bis sie ablaufen.`,
        );
      }

      if (gesamtBytes >= maxGesamtBytes) {
        throw new ServerOrchestrationError(
          'RESOURCE_LIMIT_EXCEEDED',
          'Der Zwischenspeicher für Weltdaten-Archive ist ausgelastet. Bitte versuche es später erneut.',
        );
      }

      const uploadId = randomUUID();
      const vorlaeufig = path.join(verzeichnis, `${uploadId}${IN_ANNAHME}`);

      let gelesen = 0;
      let kopf = Buffer.alloc(0);
      let zuGross = false;
      let budgetErschoepft = false;

      async function* begrenzt(): AsyncGenerator<Buffer> {
        for await (const stueck of source) {
          gelesen += stueck.length;

          if (gelesen > options.maxBytes) {
            zuGross = true;

            return;
          }

          /*
           * Die Gesamtgrenze auch während des Schreibens: Die Prüfung oben
           * kennt nur den Stand vor diesem Upload. Ohne diese zweite Prüfung
           * könnte ein einzelnes Archiv das Verzeichnis um seine volle Größe
           * über das Budget heben – und zwei gleichzeitige Uploads um das
           * Doppelte.
           */
          if (gesamtBytes + gelesen > maxGesamtBytes) {
            budgetErschoepft = true;

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

        // Vor der Größenprüfung des einzelnen Archivs: Wer das Gesamtbudget
        // reißt, soll nicht „Archiv zu groß" lesen, obwohl seines passt.
        if (budgetErschoepft) {
          throw new ServerOrchestrationError(
            'RESOURCE_LIMIT_EXCEEDED',
            'Der Zwischenspeicher für Weltdaten-Archive ist ausgelastet. Bitte versuche es später erneut.',
          );
        }

        /*
         * Beide Größensignale vor dem Umbenennen (orchestration-features-05):
         * `zuGross` ist die eigene Zählung, `isTruncated()` die Kappung der
         * Multipart-Ebene. Fällt die Kappung genau auf die eigene Grenze, zählt
         * die eigene Prüfung nichts Auffälliges – das Archiv wäre trotzdem
         * unbrauchbar und läge bis zur Frist im Zwischenspeicher.
         */
        if (zuGross || auftrag.isTruncated?.() === true) {
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
        const ziel = path.join(
          verzeichnis,
          dateiName(uploadId, auftrag.ownerId, expiresAt, format),
        );

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

    async take(uploadId, ownerId) {
      let namen: string[];

      try {
        namen = await readdir(verzeichnis);
      } catch {
        return null;
      }

      /*
       * Der Besitz wird gleich mit gesucht (orchestration-features-09): Ein
       * Archiv, das einem anderen Konto gehört, verhält sich hier wie ein
       * unbekannter Verweis – gleiche Antwort (`WORLD_ARCHIVE_NOT_FOUND`, 404),
       * keine Auskunft darüber, dass es die `uploadId` überhaupt gibt, und
       * entzogen wird dem Eigentümer nichts.
       */
      const marke = besitzerMarke(ownerId);
      const treffer = namen
        .map((name) => ({ name, eintrag: zerlege(name) }))
        .find(
          ({ eintrag }) =>
            eintrag !== null && eintrag.uploadId === uploadId && eintrag.ownerMark === marke,
        );

      if (treffer?.eintrag === undefined || treffer.eintrag === null) {
        return null;
      }

      const datei = path.join(verzeichnis, treffer.name);

      if (treffer.eintrag.expiresAt <= now().getTime()) {
        await rm(datei, { force: true });

        return null;
      }

      // Aus dem Wartebereich herausnehmen, aber noch nicht loeschen: Die Datei
      // wird jetzt blockweise gelesen. Der neue Name traegt keine Frist mehr,
      // `take()` findet sie also kein zweites Mal - einmalig wie zuvor.
      const inArbeit = `${datei}${IN_ARBEIT}`;
      await rename(datei, inArbeit);

      const groesse = await stat(inArbeit).then((eintrag) => eintrag.size);
      const griff = await open(inArbeit, 'r');

      return {
        uploadId,
        format: treffer.eintrag.format,
        sizeBytes: groesse,
        async read(offset, maxBytes) {
          const puffer = Buffer.allocUnsafe(Math.max(0, maxBytes));
          const { bytesRead } = await griff.read(puffer, 0, puffer.byteLength, offset);

          return puffer.subarray(0, bytesRead);
        },
        async release() {
          await griff.close().catch(() => undefined);
          await rm(inArbeit, { force: true });
        },
      };
    },
  };
}
