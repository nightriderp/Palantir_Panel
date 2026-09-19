/**
 * Einen Ordner des Datenverzeichnisses zum Herunterladen packen
 * (`FILE_ARCHIVE` / `FILE_ARCHIVE_BLOCK`, Betreiber-Wunsch vom 19.09.2026).
 *
 * **Warum zweistufig.** Eine einzelne Datei holt `FILE_READ` in einem Stück,
 * begrenzt durch die Kanalgrenze. Ein Ordner sprengt die: `world/` wiegt
 * schnell Gigabyte. Deshalb derselbe Weg wie beim Backup-Download – erst
 * packen, dann blockweise abholen. Der Agent öffnet dafür keinen eigenen
 * Lauscher (Pflichtenheft §18); das Backend fragt nach.
 *
 * **Warum eine Datei und kein Strom im Speicher.** Das Archiv entsteht auf der
 * Platte und wird von dort gelesen. Ein Ordner, der beim Packen vollständig im
 * Speicher läge, brächte den Agent auf einem Homeserver mit 8 GB um – und
 * genau dort läuft er.
 *
 * **Warum die Blöcke schon während des Packens fließen** (Leistungsbericht
 * 19.09.2026, Punkt 1.1). `FILE_ARCHIVE` antwortete früher erst, wenn das
 * Archiv fertig auf der Platte lag – bei einem Weltordner Minuten, in denen
 * der Browser nichts zeigte, obwohl längst Daten hätten fließen können. Jetzt
 * meldet der Befehl sofort `pending: true`, und `FILE_ARCHIVE_BLOCK` liefert,
 * was bereits geschrieben ist. Das ist sicher, weil gzip die Datei streng von
 * vorne nach hinten füllt: Was einmal dasteht, ändert sich nicht mehr.
 *
 * Ist gerade nichts Neues da, kommt ein Block mit `pending: true` und ohne
 * Daten – die Aufforderung, es gleich noch einmal zu versuchen. Die Endgröße
 * steht erst mit dem letzten Block fest, ein Download kann deshalb keine
 * Gesamtlänge ankündigen.
 *
 * **Aufräumen.** Der Block mit `eof` nimmt die gepackte Datei mit. Bricht der
 * Download ab, bleibt sie liegen; dann räumt sie die Altersprüfung weg
 * ({@link MAX_EXPORT_AGE_MS}), die vor jedem neuen Packen läuft. Ein
 * Zwischenstand, den niemand mehr abholt, soll den Homeserver nicht füllen.
 */

import { randomUUID } from 'node:crypto';
import { type Stats, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  type FileArchiveBlockCommandPayload,
  type FileArchiveBlockCommandResult,
  type FileArchiveCommandPayload,
  type FileArchiveCommandResult,
} from '@palantir/contracts';
import { ContainerRuntimeError } from '../../runtime/errors.js';
import { packDirectory } from '../backup/tar-gz.js';

/** Ein liegengebliebener Zwischenstand verschwindet nach dieser Zeit. */
export const MAX_EXPORT_AGE_MS = 30 * 60 * 1000;

/** Größter Block, den ein `FILE_ARCHIVE_BLOCK` liefert – wie beim Backup. */
export const DEFAULT_EXPORT_BLOCK_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Kompressionsstufe für den Download.
 *
 * Niedriger als bei der Sicherung: Ein Download wird einmal gepackt und sofort
 * geholt, eine Sicherung liegt monatelang. Wartezeit ist hier teurer als
 * Plattenplatz. Gemessen am 19.09.2026 auf 40 MiB gemischter Daten – Stufe 1
 * braucht 565 ms für 32,4 MiB, Stufe 6 braucht 640 ms für 32,0 MiB.
 */
export const EXPORT_GZIP_LEVEL = 1;

/**
 * Ein Packvorgang, der noch läuft oder gerade fertig geworden ist.
 *
 * Bleibt nur im Speicher: Nach einem Neustart des Agents gibt es den Vorgang
 * nicht mehr, und ein Blockabruf darauf endet mit `FILE_NOT_FOUND` – dasselbe
 * wie bei einem abgelaufenen Zwischenstand.
 */
interface Packlauf {
  readonly archivPfad: string;
  /** Das Packen ist durch – erfolgreich oder mit Fehler. */
  fertig: boolean;
  /** Endgültige Größe; erst gesetzt, wenn `fertig` und kein Fehler. */
  groesseBytes: number;
  /** Fehler des Packens; wird beim nächsten Blockabruf geworfen. */
  fehler: unknown;
}

export interface DirectoryExportOptions {
  /** Ordner für die Zwischenstände; wird bei Bedarf angelegt. */
  readonly exportDir: string;
  /** Wo der Ordner des Servers auf dem Host liegt, aufgelöst vom Aufrufer. */
  readonly resolveHostPath: (payload: FileArchiveCommandPayload) => Promise<string>;
  readonly maxBlockBytes?: number;
  readonly now?: () => Date;
}

/**
 * Name des Archivs aus dem Pfad: `welt/region` wird zu `region.tar.gz`, die
 * Wurzel zu `daten.tar.gz`.
 *
 * Nur harmlose Zeichen: Der Name landet in einem `content-disposition`-Kopf
 * und im Downloadordner eines fremden Rechners.
 */
export function archiveFileName(relativePath: string): string {
  const letzter = relativePath.split('/').filter(Boolean).pop() ?? '';
  const sauber = letzter
    .replace(/[^\w.-]+/g, '-')
    // Mehrere Striche hintereinander sehen nach Fehler aus, nicht nach Namen.
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${sauber === '' ? 'daten' : sauber}.tar.gz`;
}

export class DirectoryExportJob {
  readonly #exportDir: string;
  readonly #resolveHostPath: DirectoryExportOptions['resolveHostPath'];
  readonly #maxBlockBytes: number;
  readonly #now: () => Date;
  /** Laufende und frisch fertige Packvorgänge, nach `transferId`. */
  readonly #laeufe = new Map<string, Packlauf>();

  constructor(options: DirectoryExportOptions) {
    this.#exportDir = path.resolve(options.exportDir);
    this.#resolveHostPath = options.resolveHostPath;
    this.#maxBlockBytes = options.maxBlockBytes ?? DEFAULT_EXPORT_BLOCK_MAX_BYTES;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /** `FILE_ARCHIVE`: Ordner packen und Kennung samt Größe melden. */
  async archive(payload: FileArchiveCommandPayload): Promise<FileArchiveCommandResult> {
    const quelle = await this.#resolveHostPath(payload);
    const angaben = await this.#erwarteOrdner(quelle, payload.path);

    if (!angaben.isDirectory()) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Nur Ordner lassen sich als Archiv laden; eine Datei kommt einzeln.',
        details: { path: payload.path },
      });
    }

    await this.raeumeAlteAuf();

    const transferId = randomUUID();
    const ziel = path.join(this.#exportDir, `${transferId}.tar.gz`);
    const lauf: Packlauf = { archivPfad: ziel, fertig: false, groesseBytes: 0, fehler: null };

    this.#laeufe.set(transferId, lauf);

    /*
     * Bewusst ohne `await`: Die Antwort geht sofort raus, damit das Backend
     * mit dem Abholen beginnen kann, während hier noch gepackt wird. Beide
     * Ausgänge sind behandelt, sonst meldete Node den Fehlschlag als
     * unbehandelte Zurückweisung.
     */
    void packDirectory(quelle, ziel, { level: EXPORT_GZIP_LEVEL }).then(
      (ergebnis) => {
        lauf.groesseBytes = ergebnis.sizeBytes;
        lauf.fertig = true;
      },
      (ursache: unknown) => {
        // Ein halb gepacktes Archiv sieht aus wie ein gültiges. Weg damit -
        // der Fehler selbst wartet auf den nächsten Blockabruf.
        lauf.fehler = ursache;
        lauf.fertig = true;
        void fs.rm(ziel, { force: true }).catch(() => undefined);
      },
    );

    return {
      transferId,
      fileName: archiveFileName(payload.path),
      // Noch keine Größe: Sie steht erst mit dem letzten Block fest.
      sizeBytes: 0,
      pending: true,
    };
  }

  /** `FILE_ARCHIVE_BLOCK`: einen Block lesen; der letzte räumt auf. */
  async archiveBlock(
    payload: FileArchiveBlockCommandPayload,
  ): Promise<FileArchiveBlockCommandResult> {
    const archiv = this.#pfadZu(payload.transferId);
    const lauf = this.#laeufe.get(payload.transferId) ?? null;

    if (lauf?.fehler != null) {
      // Das Packen ist gescheitert. Der Fehler wartet hier, weil `FILE_ARCHIVE`
      // längst geantwortet hatte, als er auftrat.
      this.#laeufe.delete(payload.transferId);

      throw lauf.fehler;
    }

    const angaben = await fs.stat(archiv).catch(() => null);

    if (angaben === null) {
      if (lauf !== null && !lauf.fertig) {
        /*
         * Der Vorgang laeuft, gzip hat die Datei aber noch nicht angelegt.
         * Das ist kein fehlender Download, sondern der Bruchteil einer
         * Sekunde zwischen Antwort und erstem Schreibvorgang.
         */
        return this.#wartenderBlock(payload.transferId, payload.offset, 0);
      }

      throw new ContainerRuntimeError('FILE_NOT_FOUND', {
        message: 'Diesen Download gibt es nicht mehr; bitte neu anfangen.',
        details: { transferId: payload.transferId },
      });
    }

    /*
     * Solange gepackt wird, ist die Datei nur so lang, wie gzip bisher
     * geschrieben hat. Was dasteht, ist endgültig - gzip schreibt streng von
     * vorne nach hinten und ändert nichts Geschriebenes mehr.
     */
    const fertig = lauf === null || lauf.fertig;
    const verfuegbar = fertig && lauf !== null ? lauf.groesseBytes : angaben.size;
    const totalBytes = verfuegbar;

    if (payload.offset > verfuegbar) {
      if (!fertig) {
        // Die Stelle ist einfach noch nicht geschrieben. Gleich noch einmal.
        return this.#wartenderBlock(payload.transferId, payload.offset, totalBytes);
      }

      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Die Leseposition liegt hinter dem Ende des Archivs.',
        details: { offset: payload.offset, totalBytes },
      });
    }

    if (!fertig && payload.offset === verfuegbar) {
      return this.#wartenderBlock(payload.transferId, payload.offset, totalBytes);
    }

    const blockGroesse = Math.min(payload.maxBytes, this.#maxBlockBytes);
    const zuLesen = Math.min(blockGroesse, verfuegbar - payload.offset);
    const puffer = Buffer.alloc(zuLesen);

    const datei = await fs.open(archiv, 'r');
    let gelesen = 0;

    try {
      const ergebnis = await datei.read(puffer, 0, zuLesen, payload.offset);
      gelesen = ergebnis.bytesRead;
    } finally {
      await datei.close();
    }

    const eof = fertig && payload.offset + gelesen >= totalBytes;

    if (eof) {
      this.#laeufe.delete(payload.transferId);
      await fs.rm(archiv, { force: true }).catch(() => undefined);
    }

    return {
      transferId: payload.transferId,
      offset: payload.offset,
      contentBase64: puffer.subarray(0, gelesen).toString('base64'),
      bytesRead: gelesen,
      totalBytes,
      eof,
      // Ohne `eof` und mit laufendem Packen folgt noch etwas.
      ...(eof || fertig ? {} : { pending: true }),
    };
  }

  /**
   * Antwort „gerade nichts Neues, aber noch nicht zu Ende".
   *
   * Ohne dieses Signal wäre ein Block ohne Daten und ohne `eof` ein Fehler -
   * und das soll er bleiben, wenn wirklich nichts mehr kommt.
   */
  #wartenderBlock(
    transferId: string,
    offset: number,
    totalBytes: number,
  ): FileArchiveBlockCommandResult {
    return {
      transferId,
      offset,
      contentBase64: '',
      bytesRead: 0,
      totalBytes,
      eof: false,
      pending: true,
    };
  }

  /** Zwischenstände, die älter sind als {@link MAX_EXPORT_AGE_MS}, entfernen. */
  async raeumeAlteAuf(): Promise<number> {
    let entfernt = 0;
    const grenze = this.#now().getTime() - MAX_EXPORT_AGE_MS;
    const eintraege = await fs.readdir(this.#exportDir).catch(() => [] as string[]);

    for (const name of eintraege) {
      if (!name.endsWith('.tar.gz')) {
        continue;
      }

      const voll = path.join(this.#exportDir, name);
      const angaben = await fs.stat(voll).catch(() => null);

      if (angaben !== null && angaben.mtimeMs < grenze) {
        // Der Vorgang dazu ist ebenfalls erledigt; sonst wuechse die Karte bei
        // einem lange laufenden Agent mit jedem abgebrochenen Download.
        this.#laeufe.delete(name.replace(/\.tar\.gz$/, ''));
        await fs.rm(voll, { force: true }).catch(() => undefined);
        entfernt += 1;
      }
    }

    return entfernt;
  }

  /**
   * Pfad zum Zwischenstand – die Kennung wird geprüft, nicht geglaubt.
   *
   * `transferId` kommt aus einer Nutzlast; ein `../` darin führte sonst auf
   * eine beliebige Datei des Homeservers.
   */
  #pfadZu(transferId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(transferId)) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Unbrauchbare Kennung des Downloads.',
        details: { transferId },
      });
    }

    return path.join(this.#exportDir, `${transferId}.tar.gz`);
  }

  async #erwarteOrdner(hostPath: string, gemeldet: string): Promise<Stats> {
    const angaben = await fs.stat(hostPath).catch(() => null);

    if (angaben === null) {
      throw new ContainerRuntimeError('FILE_NOT_FOUND', {
        message: 'Den Ordner gibt es nicht.',
        details: { path: gemeldet },
      });
    }

    return angaben;
  }
}
