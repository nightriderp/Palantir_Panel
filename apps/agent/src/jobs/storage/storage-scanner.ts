/**
 * Storage-Scanner (Arbeitspaket A3, Lastenheft §3.8, Pflichtenheft §16).
 *
 * Führt `GET_STORAGE_BREAKDOWN` und `REMOVE_STORAGE_ENTRY` aus.
 *
 * **Der Agent ist hier bewusst der unwissende Teil.** Er meldet, was auf der
 * Platte liegt und ob es gerade benutzt wird – mehr nicht. Ob ein Datenordner
 * zu einem noch existierenden Server gehört und ob ein Posten gelöscht werden
 * darf, entscheidet ausschließlich das Backend an genau einer Stelle
 * (`classifyEntry()` in B8). Deshalb vergibt der Scanner `orphaned` nur dort,
 * wo er selbst sicher ist: ein Verzeichnis in seinen Datenbereichen, zu dem er
 * keinen Container kennt. Die Kategorie `other` gibt es hier nicht – die
 * vergibt allein das Backend.
 *
 * **Der Scan läuft on demand**, nicht dauerhaft im Hintergrund (Pflichtenheft
 * §16). Es gibt deshalb ausdrücklich keinen Scheduler-Job dafür: Ein
 * rekursives Vermessen aller Datenordner ist teuer, und das Ergebnis wird im
 * Backend mit Zeitstempel zwischengespeichert.
 *
 * **Container-Zugriffe laufen ausschließlich über `ContainerRuntime`**
 * (CLAUDE.md §4) – auch der Blick auf die Images (`listImages()`/`removeImage()`,
 * von A3 additiv am Interface ergänzt).
 */

import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentStorageEntry,
  GetStorageBreakdownCommandPayload,
  GetStorageBreakdownCommandResult,
  RemoveStorageEntryCommandPayload,
  RemoveStorageEntryCommandResult,
} from '@palantir/contracts';
import { ContainerRuntimeError, type ContainerRuntime } from '../../runtime/index.js';
import { resolveWithinAny, resolveWithinDirectory, serverIdFromContainerName } from '../paths.js';

export interface StorageScannerOptions {
  readonly runtime: ContainerRuntime;
  /** `AGENT_DATA_DIR`. */
  readonly dataDir: string;
  /** `AGENT_BACKUP_DIR`. */
  readonly backupDir: string;
  /**
   * Belegung des Datenträgers. Ohne Angabe `fs.statfs` auf `AGENT_DATA_DIR` –
   * injizierbar, damit die Tests nicht von der Platte des Entwicklungsrechners
   * abhängen.
   */
  readonly diskUsage?: (pfad: string) => Promise<DiskUsage>;
  readonly now?: () => Date;
}

export interface DiskUsage {
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
}

/** Größe und jüngste Änderung eines Verzeichnisbaums. */
interface Baumgroesse {
  readonly sizeBytes: number;
  readonly lastModifiedAt: string | null;
}

export class StorageScanner {
  readonly #runtime: ContainerRuntime;
  readonly #dataDir: string;
  readonly #backupDir: string;
  readonly #diskUsage: (pfad: string) => Promise<DiskUsage>;
  readonly #now: () => Date;

  constructor(options: StorageScannerOptions) {
    this.#runtime = options.runtime;
    this.#dataDir = path.resolve(options.dataDir);
    this.#backupDir = path.resolve(options.backupDir);
    this.#diskUsage = options.diskUsage ?? defaultDiskUsage;
    this.#now = options.now ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // GET_STORAGE_BREAKDOWN
  // -------------------------------------------------------------------------

  async scan(
    payload: GetStorageBreakdownCommandPayload = {},
  ): Promise<GetStorageBreakdownCommandResult> {
    const scannedAt = this.#now().toISOString();
    const belegung = await this.#diskUsage(this.#dataDir);

    const container = await this.#containerNachServerId();
    const entries: AgentStorageEntry[] = [];

    entries.push(...(await this.#serverdaten(container)));
    entries.push(...(await this.#backups()));

    // Ohne Angabe `true` (siehe `GetStorageBreakdownCommandPayload`): Ein
    // Image-Scan ist teurer als die Ordnergrößen und deshalb abschaltbar.
    if (payload.includeImages !== false) {
      entries.push(...(await this.#images()));
    }

    return {
      scannedAt,
      totalBytes: belegung.totalBytes,
      usedBytes: belegung.usedBytes,
      freeBytes: belegung.freeBytes,
      entries,
    };
  }

  /**
   * Datenordner unterhalb von `AGENT_DATA_DIR`.
   *
   * Ein Ordner, zu dem der Agent einen Container kennt, ist `serverData`. Alles
   * andere meldet er als `orphaned` – und zwar ohne `serverId`, auch wenn der
   * Ordnername wie eine aussieht: Ob dahinter ein noch existierender Server
   * steckt, weiß nur das Backend, und dessen Regel ist bewusst restriktiv
   * (`notClearlyOrphaned`).
   */
  async #serverdaten(
    container: Map<string, { readonly containerId: string; readonly laeuft: boolean }>,
  ): Promise<AgentStorageEntry[]> {
    const eintraege: AgentStorageEntry[] = [];

    for (const ordner of await this.#unterordner(this.#dataDir)) {
      const pfad = path.join(this.#dataDir, ordner);
      const groesse = await this.#baumgroesse(pfad);
      const treffer = container.get(ordner.toLowerCase());

      eintraege.push({
        kind: treffer === undefined ? 'orphaned' : 'serverData',
        path: pfad,
        sizeBytes: groesse.sizeBytes,
        serverId: treffer === undefined ? null : ordner.toLowerCase(),
        backupFileName: null,
        imageId: null,
        imageTag: null,
        inUse: treffer?.laeuft ?? false,
        lastModifiedAt: groesse.lastModifiedAt,
      });
    }

    return eintraege;
  }

  /**
   * Archive unterhalb von `AGENT_BACKUP_DIR`.
   *
   * Die Ablage ist `<backupDir>/<serverId>/<backupId>.tar.gz`; die `serverId`
   * kommt deshalb aus dem übergeordneten Ordner. Ein Archiv gilt nie als
   * „in Benutzung" – ein Backup wird nicht gelesen, während der Server läuft.
   */
  async #backups(): Promise<AgentStorageEntry[]> {
    const eintraege: AgentStorageEntry[] = [];

    for (const datei of await this.#dateienRekursiv(this.#backupDir)) {
      const relativ = path.relative(this.#backupDir, datei.pfad);
      const ordner = relativ.split(path.sep)[0];
      const serverId = ordner !== undefined && ordner !== path.basename(datei.pfad) ? ordner : null;

      eintraege.push({
        kind: 'backup',
        path: datei.pfad,
        sizeBytes: datei.sizeBytes,
        serverId,
        backupFileName: path.basename(datei.pfad),
        imageId: null,
        imageTag: null,
        inUse: false,
        lastModifiedAt: datei.lastModifiedAt,
      });
    }

    return eintraege;
  }

  async #images(): Promise<AgentStorageEntry[]> {
    const images = await this.#runtime.listImages();

    return images.map((image) => ({
      kind: 'dockerImage' as const,
      path: null,
      sizeBytes: image.sizeBytes,
      serverId: null,
      backupFileName: null,
      imageId: image.imageId,
      imageTag: image.tag,
      inUse: image.inUse,
      lastModifiedAt: image.createdAt,
    }));
  }

  // -------------------------------------------------------------------------
  // REMOVE_STORAGE_ENTRY
  // -------------------------------------------------------------------------

  /**
   * Entfernt einen Posten der Speicherübersicht.
   *
   * **Ob** ein Posten entfernt werden darf, hat das Backend entschieden
   * (`classifyEntry()` in B8). Der Agent führt aus – prüft aber weiterhin das,
   * was nur er wissen kann und was eine falsche Antwort teuer machen würde:
   *
   *  - Der Pfad muss in seinen Verzeichnissen liegen (kein `../` nach draußen).
   *  - Ein Datenordner, zu dem es einen Container gibt, wird **nicht** entfernt
   *    – auch nicht, wenn der Befehl ihn als `orphaned` bezeichnet. Aktive
   *    Server-Datenordner sind über diesen Weg grundsätzlich nicht löschbar
   *    (Lastenheft §3.8); dass die Kategorie `serverData` schon im Vertrag
   *    fehlt, ist die eine Hälfte der Absicherung, das hier die andere.
   *
   * Idempotent wie `DELETE_BACKUP`: Ein bereits verschwundener Posten ist
   * `removed: false`, kein Fehler.
   */
  async remove(
    payload: RemoveStorageEntryCommandPayload,
  ): Promise<RemoveStorageEntryCommandResult> {
    if (payload.kind === 'dockerImage') {
      return this.#entferneImage(payload.imageId);
    }

    const gemeldet = payload.path;
    if (gemeldet === undefined) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: `Zum Entfernen eines Postens der Art "${payload.kind}" wird ein Pfad benötigt.`,
      });
    }

    const pfad =
      payload.kind === 'backup'
        ? resolveWithinDirectory(this.#backupDir, gemeldet)
        : resolveWithinAny([this.#dataDir, this.#backupDir], gemeldet);

    if (payload.kind === 'orphaned') {
      await this.#erwarteOhneContainer(pfad);
    }

    const stat = await statOderNull(pfad);
    if (stat === null) {
      return { removed: false, freedBytes: 0 };
    }

    const freedBytes = stat.isDirectory() ? (await this.#baumgroesse(pfad)).sizeBytes : stat.size;

    await fs.rm(pfad, { recursive: true, force: true });
    return { removed: true, freedBytes };
  }

  async #entferneImage(imageId: string | undefined): Promise<RemoveStorageEntryCommandResult> {
    if (imageId === undefined) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Zum Entfernen eines Images wird die imageId benötigt.',
      });
    }

    const vorher = (await this.#runtime.listImages()).find((image) => image.imageId === imageId);

    if (vorher?.inUse === true) {
      throw new ContainerRuntimeError('CONTAINER_STATE_CONFLICT', {
        message: 'Das Image wird von mindestens einem Container benutzt.',
        details: { imageId },
      });
    }

    const entfernt = await this.#runtime.removeImage(imageId);
    return { removed: entfernt, freedBytes: entfernt ? (vorher?.sizeBytes ?? 0) : 0 };
  }

  /**
   * Bricht ab, wenn zu dem Verzeichnis ein Container existiert.
   *
   * Der Vergleich läuft über den Ordnernamen, weil die Ablage `<dataDir>/<serverId>`
   * ist – genau die Zuordnung, die auch der Scan benutzt.
   */
  async #erwarteOhneContainer(pfad: string): Promise<void> {
    const relativ = path.relative(this.#dataDir, pfad);
    if (relativ.startsWith('..') || path.isAbsolute(relativ)) {
      // Liegt nicht im Datenverzeichnis – dann gehört auch kein Container dazu.
      return;
    }

    const ordner = relativ.split(path.sep)[0]?.toLowerCase();
    if (ordner === undefined) {
      return;
    }

    const container = await this.#containerNachServerId();
    if (container.has(ordner)) {
      throw new ContainerRuntimeError('CONTAINER_STATE_CONFLICT', {
        message:
          'Zu diesem Datenordner gibt es einen Container – er ist über den Storage-Explorer nicht löschbar.',
        details: { path: pfad, serverId: ordner },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Dateisystem
  // -------------------------------------------------------------------------

  async #containerNachServerId(): Promise<
    Map<string, { readonly containerId: string; readonly laeuft: boolean }>
  > {
    const zustaende = await this.#runtime.list();
    const zuordnung = new Map<string, { containerId: string; laeuft: boolean }>();

    for (const zustand of zustaende) {
      const serverId = serverIdFromContainerName(zustand.name);
      if (serverId === null) {
        continue;
      }
      zuordnung.set(serverId, {
        containerId: zustand.containerId,
        laeuft: zustand.status === 'running' || zustand.status === 'restarting',
      });
    }

    return zuordnung;
  }

  async #unterordner(wurzel: string): Promise<string[]> {
    try {
      const eintraege = await fs.readdir(wurzel, { withFileTypes: true });
      return eintraege.filter((eintrag) => eintrag.isDirectory()).map((eintrag) => eintrag.name);
    } catch {
      // Ein noch nicht angelegtes Verzeichnis ist kein Fehler: Auf einem frisch
      // aufgesetzten Homeserver gibt es schlicht noch nichts zu melden.
      return [];
    }
  }

  async #dateienRekursiv(
    wurzel: string,
  ): Promise<{ pfad: string; sizeBytes: number; lastModifiedAt: string | null }[]> {
    const ergebnis: { pfad: string; sizeBytes: number; lastModifiedAt: string | null }[] = [];

    const gehe = async (verzeichnis: string): Promise<void> => {
      let eintraege;
      try {
        eintraege = await fs.readdir(verzeichnis, { withFileTypes: true });
      } catch {
        return;
      }

      for (const eintrag of eintraege) {
        const pfad = path.join(verzeichnis, eintrag.name);
        if (eintrag.isDirectory()) {
          await gehe(pfad);
          continue;
        }
        if (!eintrag.isFile()) {
          continue;
        }
        const stat = await statOderNull(pfad);
        if (stat === null) {
          continue;
        }
        ergebnis.push({
          pfad,
          sizeBytes: stat.size,
          lastModifiedAt: new Date(stat.mtimeMs).toISOString(),
        });
      }
    };

    await gehe(wurzel);
    return ergebnis;
  }

  /**
   * Größe eines Verzeichnisbaums.
   *
   * Symbolische Verknüpfungen werden bewusst nicht verfolgt (`lstat`): Sonst
   * würde derselbe Speicher doppelt gezählt, und eine Verknüpfung nach `/`
   * würde den Scan endlos laufen lassen.
   */
  async #baumgroesse(wurzel: string): Promise<Baumgroesse> {
    let sizeBytes = 0;
    let neuste = 0;

    const gehe = async (verzeichnis: string): Promise<void> => {
      let eintraege;
      try {
        eintraege = await fs.readdir(verzeichnis, { withFileTypes: true });
      } catch {
        return;
      }

      for (const eintrag of eintraege) {
        const pfad = path.join(verzeichnis, eintrag.name);

        if (eintrag.isDirectory()) {
          await gehe(pfad);
          continue;
        }

        if (eintrag.isSymbolicLink()) {
          continue;
        }

        try {
          const stat = await fs.lstat(pfad);
          sizeBytes += stat.size;
          neuste = Math.max(neuste, stat.mtimeMs);
        } catch {
          // Datei ist zwischen readdir und lstat verschwunden – nicht mitzählen.
        }
      }
    };

    await gehe(wurzel);

    try {
      const stat = await fs.lstat(wurzel);
      neuste = Math.max(neuste, stat.mtimeMs);
    } catch {
      // Wurzel existiert nicht (mehr).
    }

    return {
      sizeBytes,
      lastModifiedAt: neuste === 0 ? null : new Date(neuste).toISOString(),
    };
  }
}

async function statOderNull(pfad: string): Promise<Stats | null> {
  try {
    return await fs.stat(pfad);
  } catch {
    return null;
  }
}

/** Belegung des Datenträgers über `statfs` – der einzige Weg ohne externe Werkzeuge. */
async function defaultDiskUsage(pfad: string): Promise<DiskUsage> {
  try {
    const fsstat = await fs.statfs(pfad);
    const totalBytes = fsstat.blocks * fsstat.bsize;
    // `bavail` statt `bfree`: Der für gewöhnliche Prozesse tatsächlich
    // verfügbare Platz, ohne die für root reservierten Blöcke.
    const freeBytes = fsstat.bavail * fsstat.bsize;
    return { totalBytes, usedBytes: totalBytes - freeBytes, freeBytes };
  } catch {
    // Lieber Nullen als ein gescheiterter Scan: Die Postenliste ist der
    // eigentliche Wert des Befehls, die Datenträgergröße nur der Rahmen.
    return { totalBytes: 0, usedBytes: 0, freeBytes: 0 };
  }
}
