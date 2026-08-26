/**
 * Backup-Job auf Dateiebene (Arbeitspaket A3, Lastenheft §3.3).
 *
 * Führt die vier Backup-Befehle des Agent-Protokolls aus: `CREATE_BACKUP`,
 * `RESTORE_BACKUP`, `DOWNLOAD_BACKUP` und `DELETE_BACKUP`. Alles Fachliche –
 * wann gesichert wird, wie lange aufbewahrt wird, wer das darf – entscheidet
 * das Backend (B5). Hier passiert nur das, was ausschließlich auf dem
 * Homeserver passieren kann: das Dateisystem anfassen.
 *
 * **Container-Zugriffe laufen ausschließlich über `ContainerRuntime`**
 * (CLAUDE.md §4). Der Job hält den Container an, wenn das Backend das verlangt,
 * und bringt ihn danach in den vorherigen Zustand zurück – mehr Umgang mit
 * Containern hat er nicht.
 *
 * **Ablage:** `<AGENT_BACKUP_DIR>/<serverId>/<backupId>.tar.gz`. Der Pfad
 * entsteht hier und nicht im Backend, weil nur der Agent seine Verzeichnisse
 * kennt; er wandert als `storagePath` ins Ergebnis und von dort in den
 * `Backup`-Datensatz. Alle später hereingereichten Pfade werden gegen die
 * konfigurierten Verzeichnisse geprüft, statt ihnen zu vertrauen.
 */

import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CreateBackupCommandPayload,
  CreateBackupCommandResult,
  DeleteBackupCommandPayload,
  DeleteBackupCommandResult,
  DownloadBackupCommandPayload,
  DownloadBackupCommandResult,
  RestoreBackupCommandPayload,
  RestoreBackupCommandResult,
} from '@palantir/contracts';
import { ContainerRuntimeError, type ContainerRuntime } from '../../runtime/index.js';
import { resolveWithinDirectory } from '../paths.js';
import { packDirectory, unpackArchive } from './tar-gz.js';

/** Obergrenze eines einzelnen `DOWNLOAD_BACKUP`-Blocks (`AGENT_DOWNLOAD_BLOCK_MAX_BYTES`). */
export const DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES = 8 * 1024 * 1024;

export interface BackupJobOptions {
  readonly runtime: ContainerRuntime;
  /** `AGENT_DATA_DIR` – einzige erlaubte Quelle bzw. Ziel für Serverdaten. */
  readonly dataDir: string;
  /** `AGENT_BACKUP_DIR` – einzige erlaubte Ablage für Archive. */
  readonly backupDir: string;
  /** Obergrenze eines Download-Blocks; ohne Angabe {@link DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES}. */
  readonly maxDownloadBlockBytes?: number;
  readonly now?: () => Date;
}

export class BackupJob {
  readonly #runtime: ContainerRuntime;
  readonly #dataDir: string;
  readonly #backupDir: string;
  readonly #maxDownloadBlockBytes: number;
  readonly #now: () => Date;

  constructor(options: BackupJobOptions) {
    this.#runtime = options.runtime;
    this.#dataDir = options.dataDir;
    this.#backupDir = options.backupDir;
    this.#maxDownloadBlockBytes =
      options.maxDownloadBlockBytes ?? DEFAULT_DOWNLOAD_BLOCK_MAX_BYTES;
    this.#now = options.now ?? (() => new Date());
  }

  /** Ablageort eines Archivs – dieselbe Regel für Anlegen und Wiederfinden. */
  archivePathFor(serverId: string, backupId: string): string {
    return path.join(path.resolve(this.#backupDir), serverId, `${backupId}.tar.gz`);
  }

  // -------------------------------------------------------------------------
  // CREATE_BACKUP
  // -------------------------------------------------------------------------

  /**
   * Sichert den Datenordner eines Servers.
   *
   * Verlangt das Backend `stopContainer`, wird der Container vorher angehalten
   * und danach **in den vorherigen Zustand zurückversetzt** – lief er, läuft er
   * hinterher wieder. Ohne Anhalten entsteht die Sicherung im laufenden Betrieb
   * und kann einen halb geschriebenen Spielstand enthalten; das ist die
   * bewusste Entscheidung des Backends und steht deshalb in der Nutzlast.
   *
   * Ob tatsächlich angehalten wurde, meldet `containerStopped` – daran hängt
   * die Verlässlichkeit des Spielstands, das darf nicht geraten werden.
   */
  async createBackup(
    payload: CreateBackupCommandPayload,
  ): Promise<CreateBackupCommandResult> {
    const startedAt = this.#now().toISOString();
    const quelle = resolveWithinDirectory(this.#dataDir, payload.sourcePath);
    await this.#erwarteVerzeichnis(quelle, payload.sourcePath);

    const archiv = this.archivePathFor(payload.serverId, payload.backupId);
    const anhalten = payload.stopContainer === true && payload.containerId !== undefined;
    let liefVorher = false;

    if (anhalten && payload.containerId !== undefined) {
      liefVorher = await this.#haltAn(payload.containerId, payload.stopTimeoutSeconds);
    }

    try {
      const ergebnis = await packDirectory(quelle, archiv);

      return {
        backupId: payload.backupId,
        storagePath: archiv,
        sizeBytes: ergebnis.sizeBytes,
        checksumSha256: ergebnis.checksumSha256,
        containerStopped: anhalten,
        startedAt,
        completedAt: this.#now().toISOString(),
      };
    } finally {
      // Auch bei einem Fehlschlag: Ein Server, der wegen eines misslungenen
      // Backups aus bleibt, ist der schlimmere Ausgang.
      if (liefVorher && payload.containerId !== undefined) {
        await this.#starteWieder(payload.containerId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // RESTORE_BACKUP
  // -------------------------------------------------------------------------

  /**
   * Spielt ein Archiv in den Datenordner eines Servers zurück.
   *
   * Der Container wird dafür **immer** angehalten – ein laufender Spielserver
   * schreibt weiter in die Dateien, die gerade ersetzt werden. Er bleibt
   * anschließend aus: Was danach mit dem Server passiert, entscheidet der
   * Lifecycle im Backend (Pflichtenheft §9), nicht der Agent.
   *
   * Das Zielverzeichnis wird vorher geleert. Ein Zurückspielen „über" einen
   * bestehenden Stand hinterließe sonst Dateien, die es im Backup nicht mehr
   * gibt – der wiederhergestellte Stand wäre dann keiner.
   */
  async restoreBackup(
    payload: RestoreBackupCommandPayload,
  ): Promise<RestoreBackupCommandResult> {
    const startedAt = this.#now().toISOString();
    const archiv = resolveWithinDirectory(this.#backupDir, payload.storagePath);
    await this.#erwarteDatei(archiv, payload.storagePath);

    const ziel = resolveWithinDirectory(this.#dataDir, payload.targetPath);
    let angehalten = false;

    if (payload.containerId !== undefined) {
      await this.#haltAn(payload.containerId, payload.stopTimeoutSeconds);
      angehalten = true;
    }

    await this.#leere(ziel);
    const ergebnis = await unpackArchive(archiv, ziel);

    return {
      backupId: payload.backupId,
      restoredBytes: ergebnis.restoredBytes,
      containerStopped: angehalten,
      startedAt,
      completedAt: this.#now().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // DOWNLOAD_BACKUP
  // -------------------------------------------------------------------------

  /**
   * Liest einen Block aus einem Archiv (Lastenheft §3.3, „vollständiger
   * Export").
   *
   * Blockweise und vom Backend getrieben, weil der Agent keinen eigenen
   * Listener öffnet (Pflichtenheft §18) und ein mehrere Gigabyte großes Archiv
   * nicht am Stück in den Speicher passt. `maxBytes` wird zusätzlich gedeckelt:
   * Ein Backend-Fehler mit `maxBytes: 4_000_000_000` darf den Agent nicht
   * umbringen.
   */
  async downloadBackup(
    payload: DownloadBackupCommandPayload,
  ): Promise<DownloadBackupCommandResult> {
    const archiv = resolveWithinDirectory(this.#backupDir, payload.storagePath);
    const stat = await this.#erwarteDatei(archiv, payload.storagePath);
    const totalBytes = stat.size;

    if (payload.offset > totalBytes) {
      throw new ContainerRuntimeError('INVALID_PATH', {
        message: 'Die Leseposition liegt hinter dem Ende des Archivs.',
        details: { offset: payload.offset, totalBytes },
      });
    }

    const blockGroesse = Math.min(payload.maxBytes, this.#maxDownloadBlockBytes);
    const zuLesen = Math.min(blockGroesse, totalBytes - payload.offset);
    const puffer = Buffer.alloc(zuLesen);

    const datei = await fs.open(archiv, 'r');
    let gelesen = 0;
    try {
      const ergebnis = await datei.read(puffer, 0, zuLesen, payload.offset);
      gelesen = ergebnis.bytesRead;
    } finally {
      await datei.close();
    }

    return {
      backupId: payload.backupId,
      offset: payload.offset,
      contentBase64: puffer.subarray(0, gelesen).toString('base64'),
      bytesRead: gelesen,
      totalBytes,
      eof: payload.offset + gelesen >= totalBytes,
    };
  }

  // -------------------------------------------------------------------------
  // DELETE_BACKUP
  // -------------------------------------------------------------------------

  /**
   * Entfernt ein Archiv.
   *
   * Bewusst **idempotent**: Ein bereits fehlendes Archiv ist kein Fehler,
   * sondern `removed: false`. Sonst bliebe nach einem Abbruch mitten in der
   * Aufbewahrungsprüfung ein Datensatz zurück, der sich nie wieder löschen
   * ließe.
   */
  async deleteBackup(payload: DeleteBackupCommandPayload): Promise<DeleteBackupCommandResult> {
    const archiv = resolveWithinDirectory(this.#backupDir, payload.storagePath);
    const stat = await this.#statOderNull(archiv);

    if (stat === null || !stat.isFile()) {
      return { backupId: payload.backupId, removed: false, freedBytes: 0 };
    }

    await fs.rm(archiv, { force: true });
    await this.#raeumeLeerenOrdnerAuf(path.dirname(archiv));

    return { backupId: payload.backupId, removed: true, freedBytes: stat.size };
  }

  // -------------------------------------------------------------------------
  // Intern
  // -------------------------------------------------------------------------

  /**
   * Hält einen Container an und meldet, ob er vorher lief.
   *
   * Der vorherige Zustand kommt aus `inspect()` und nicht aus einer Annahme:
   * Nur so lässt sich hinterher entscheiden, ob wieder gestartet werden muss.
   */
  async #haltAn(containerId: string, timeoutSeconds?: number): Promise<boolean> {
    const zustand = await this.#runtime.inspect(containerId);
    const lief = zustand.status === 'running' || zustand.status === 'restarting';

    if (lief) {
      await this.#runtime.stop(
        containerId,
        timeoutSeconds === undefined ? {} : { timeoutSeconds },
      );
    }

    return lief;
  }

  async #starteWieder(containerId: string): Promise<void> {
    await this.#runtime.start(containerId);
  }

  async #leere(verzeichnis: string): Promise<void> {
    await fs.mkdir(verzeichnis, { recursive: true });
    for (const eintrag of await fs.readdir(verzeichnis)) {
      await fs.rm(path.join(verzeichnis, eintrag), { recursive: true, force: true });
    }
  }

  async #raeumeLeerenOrdnerAuf(verzeichnis: string): Promise<void> {
    // Nur den unmittelbaren Ordner und nur, wenn er leer ist – der Agent räumt
    // nicht rekursiv im Backup-Verzeichnis auf.
    if (path.resolve(verzeichnis) === path.resolve(this.#backupDir)) {
      return;
    }

    try {
      const inhalt = await fs.readdir(verzeichnis);
      if (inhalt.length === 0) {
        await fs.rmdir(verzeichnis);
      }
    } catch {
      // Ein nicht entfernbarer Ordner ist kein Grund, das Löschen als
      // gescheitert zu melden – das Archiv ist weg.
    }
  }

  async #statOderNull(pfad: string): Promise<Stats | null> {
    try {
      return await fs.stat(pfad);
    } catch {
      return null;
    }
  }

  async #erwarteVerzeichnis(pfad: string, gemeldet: string): Promise<void> {
    const stat = await this.#statOderNull(pfad);
    if (stat === null || !stat.isDirectory()) {
      throw new ContainerRuntimeError('FILE_NOT_FOUND', {
        message: `Der Datenordner ${gemeldet} existiert auf dem Homeserver nicht.`,
        details: { path: pfad },
      });
    }
  }

  async #erwarteDatei(
    pfad: string,
    gemeldet: string,
  ): Promise<Stats> {
    const stat = await this.#statOderNull(pfad);
    if (stat === null || !stat.isFile()) {
      throw new ContainerRuntimeError('FILE_NOT_FOUND', {
        message: `Das Backup-Archiv ${gemeldet} existiert auf dem Homeserver nicht.`,
        details: { path: pfad },
      });
    }
    return stat;
  }
}
