/**
 * Blockweise entgegengenommenes Archiv (WORK_STATUS.md, Gefundener Punkt 106).
 *
 * **Warum blockweise.** `FILE_EXTRACT` traegt das ganze Archiv in einem Frame
 * und haengt damit an `AGENT_FILE_CHANNEL_MAX_BYTES` (64 MiB). Der Zweck der
 * Weltdaten-Uebernahme ist aber die Migration von einem anderen Hoster, und ein
 * gewachsener Server bringt mehrere hundert Megabyte mit. `UPLOAD_ARCHIVE_BLOCK`
 * ist das Gegenstueck zu `DOWNLOAD_BACKUP`: Das Backend schickt Block fuer
 * Block, hier werden sie an eine Datei angehaengt, und erst der letzte Block
 * entpackt.
 *
 * **Warum im Job-Modul.** Das Zusammensetzen ist Dateisystemarbeit auf dem
 * Homeserver und gehoert damit nach A3 - die Container-Runtime bekommt am Ende
 * ein fertiges Archiv und macht damit dasselbe wie bei `FILE_EXTRACT`
 * (CLAUDE.md §4).
 *
 * **Gesamtgroessen-Deckel** (Audit agent-conn-02). Die Uebertragung war frueher
 * unbegrenzt: Ein fehlerhaftes oder kompromittiertes Backend konnte mit
 * fortlaufenden Bloecken (`last: false`) die Platte fuellen, und der
 * abschliessende `readFile` zog das gesamte, womoeglich mehrere Gigabyte grosse
 * Archiv in den Speicher - vor jeder Grenze des Entpackens. Jetzt gilt
 * {@link DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES}, geprueft **vor** jedem
 * Dateizugriff.
 *
 * **Was diese Datei nicht loest.** Zum Entpacken wird das Archiv einmal ganz
 * gelesen; die Eintraege haelt die Runtime dabei im Speicher
 * (`MAX_EXTRACTED_BYTES`, 512 MiB). Der Deckel begrenzt diesen Puffer auf
 * dieselbe Zahl - ein streamendes Entpacken waere ein eigener Umbau von
 * `runtime/archive.ts` und steht als Restpunkt in WORK_STATUS.md.
 */

import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  UploadArchiveBlockCommandPayload,
  UploadArchiveBlockCommandResult,
} from '@palantir/contracts';
import { MAX_EXTRACTED_BYTES } from '../../runtime/archive.js';
import { type ContainerRuntime } from '../../runtime/container-runtime.js';
import { ContainerRuntimeError } from '../../runtime/errors.js';

/** Unterordner im Datenverzeichnis, in dem angefangene Uebertragungen liegen. */
export const ARCHIVE_UPLOAD_DIRNAME = '.uploads';

/**
 * Frist fuer eine angefangene Uebertragung.
 *
 * Dieselben zwei Stunden wie im Zwischenspeicher des Backends
 * (`WORLD_ARCHIVE_TTL_MS`): Laenger haelt kein Wizard, und ein abgebrochener
 * Upload soll die Platte nicht dauerhaft belegen. Aufgeraeumt wird beim Beginn
 * der naechsten Uebertragung - ohne Uploads entstehen auch keine Reste, und ein
 * eigener Zeitgeber dafuer waere Arbeit ohne Anlass.
 */
export const ARCHIVE_UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

/** Nur unauffaellige Kennungen; alles andere koennte den Pfad verlassen. */
const TRANSFER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Obergrenze fuer die Summe aller Bloecke einer Uebertragung
 * (`AGENT_UPLOAD_ARCHIVE_MAX_BYTES`).
 *
 * Dieselbe Zahl wie `MAX_EXTRACTED_BYTES`: Ein Archiv, das schon komprimiert
 * groesser ist als das erlaubte Entpackergebnis, kann ohnehin nicht durchkommen
 * - es dafuer erst vollstaendig auf die Platte zu schreiben und in den Speicher
 * zu lesen, waere Arbeit fuer eine sichere Ablehnung.
 */
export const DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES = MAX_EXTRACTED_BYTES;

export interface ArchiveUploadJobOptions {
  readonly runtime: ContainerRuntime;
  /** `AGENT_DATA_DIR`; darunter liegt der Ordner fuer angefangene Uebertragungen. */
  readonly dataDir: string;
  /**
   * Deckel der Gesamtuebertragung; ohne Angabe
   * {@link DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES}.
   */
  readonly maxArchiveBytes?: number;
  readonly now?: () => Date;
}

export class ArchiveUploadJob {
  readonly #runtime: ContainerRuntime;
  readonly #wurzel: string;
  readonly #maxArchiveBytes: number;
  readonly #now: () => Date;

  constructor(options: ArchiveUploadJobOptions) {
    this.#runtime = options.runtime;
    this.#wurzel = path.join(path.resolve(options.dataDir), ARCHIVE_UPLOAD_DIRNAME);
    this.#maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_ARCHIVE_UPLOAD_MAX_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Einen Block entgegennehmen; beim letzten entpacken.
   *
   * `offset` ist eine Pruefung und kein Wunsch: Passt er nicht zu dem, was
   * schon da liegt, bricht der Vorgang ab. Ein wiederholt gesendeter Block nach
   * einem Verbindungsabriss wuerde sonst still ein Archiv mit doppeltem Stueck
   * ergeben - kaputt, aber ohne Fehlermeldung.
   */
  async receive(
    payload: UploadArchiveBlockCommandPayload,
  ): Promise<UploadArchiveBlockCommandResult> {
    const ziel = this.#pfad(payload.transferId);
    const block = Buffer.from(payload.contentBase64, 'base64');
    const receivedBytes = payload.offset + block.byteLength;

    /*
     * Der Deckel steht vor jedem Dateizugriff (agent-conn-02): Ein Block, der
     * die Uebertragung ueber die Grenze hebt, darf gar nicht erst geschrieben
     * werden - und ein Angreifer, der mit riesigem `offset` arbeitet, soll
     * daran scheitern und nicht am Vergleich mit der Dateigroesse.
     */
    if (receivedBytes > this.#maxArchiveBytes) {
      throw new ContainerRuntimeError('ARCHIVE_TOO_LARGE', {
        message: 'Die Uebertragung ueberschreitet die zulaessige Gesamtgroesse.',
        details: {
          transferId: payload.transferId,
          receivedBytes,
          maxBytes: this.#maxArchiveBytes,
        },
      });
    }

    await mkdir(this.#wurzel, { recursive: true });

    if (payload.offset === 0) {
      await this.#aufraeumen();
      // Neu anfangen: Ein Rest aus einem abgebrochenen Versuch mit derselben
      // Kennung darf sich nicht mit dem neuen Archiv vermischen.
      await writeFile(ziel, block);
    } else {
      await this.#erwarteGroesse(ziel, payload.offset, payload.transferId);
      await appendFile(ziel, block);
    }

    if (!payload.last) {
      return { transferId: payload.transferId, receivedBytes, extract: null };
    }

    try {
      const archiv = await readFile(ziel);
      const ergebnis = await this.#runtime.extractArchive(
        payload.containerId,
        payload.path,
        archiv,
        payload.format,
      );

      return {
        transferId: payload.transferId,
        receivedBytes,
        extract: {
          fileCount: ergebnis.fileCount,
          extractedBytes: ergebnis.extractedBytes,
          skipped: [...ergebnis.skipped],
        },
      };
    } finally {
      // Auch nach einem Fehler: Ein unbrauchbares Archiv soll nicht liegen
      // bleiben, der Aufrufer faengt ohnehin bei Block 0 neu an.
      await rm(ziel, { force: true });
    }
  }

  /** Pfad der Ablage, mit gepruefter Kennung. */
  #pfad(transferId: string): string {
    if (!TRANSFER_ID.test(transferId)) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Die Kennung der Uebertragung enthaelt unzulaessige Zeichen.',
        details: { transferId },
      });
    }

    return path.join(this.#wurzel, `${transferId}.archive`);
  }

  async #erwarteGroesse(ziel: string, offset: number, transferId: string): Promise<void> {
    const groesse = await stat(ziel)
      .then((eintrag) => eintrag.size)
      .catch((fehler: unknown) => {
        if ((fehler as NodeJS.ErrnoException).code === 'ENOENT') return 0;
        throw fehler;
      });

    if (groesse !== offset) {
      throw new ContainerRuntimeError('RUNTIME_ERROR', {
        message:
          'Der Block passt nicht an das bisher Empfangene. Die Uebertragung muss von vorn beginnen.',
        details: { transferId, expectedOffset: groesse, offset },
      });
    }
  }

  /** Abgelaufene Reste abgebrochener Uebertragungen entfernen. */
  async #aufraeumen(): Promise<void> {
    const frist = this.#now().getTime() - ARCHIVE_UPLOAD_TTL_MS;
    const eintraege = await readdir(this.#wurzel).catch(() => []);

    for (const name of eintraege) {
      const pfad = path.join(this.#wurzel, name);
      const eintrag = await stat(pfad).catch(() => null);

      if (eintrag !== null && eintrag.isFile() && eintrag.mtimeMs < frist) {
        await rm(pfad, { force: true });
      }
    }
  }
}
