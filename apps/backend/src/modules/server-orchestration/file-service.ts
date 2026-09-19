/**
 * Datei-Manager eines Servers (Arbeitspaket P2, Lastenheft §3.3).
 *
 * Aus `service.ts` herausgelöst (Review 2026-09-16, Befund 2.1): Die sechs
 * Dateioperationen teilen sich weder Zustand noch Abläufe mit dem Rest der
 * Orchestrierung – sie brauchen nur den Weg zum Container (`requireLiveTarget`)
 * und den Datenordner des Spiels. `ServerOrchestrationService` reicht sie
 * unverändert durch, damit Routen und Tests dieselbe Oberfläche behalten.
 *
 * Alle Methoden nehmen Pfade **relativ zum Datenordner** entgegen – so, wie
 * das Frontend sie kennt – und übersetzen sie in `files.ts` in absolute
 * Container-Pfade. Ein Ausbruch aus dem Datenordner scheitert damit schon im
 * Backend; der Agent prüft dieselbe Grenze noch einmal (`resolveWithinRoot`).
 */

import path from 'node:path';
import {
  type FileArchiveBlockCommandResult,
  type ServerFileContentDto,
  type ServerFileListDto,
} from '@palantir/contracts';
import { type AgentSession } from './agent-gateway.js';
import { ServerOrchestrationError } from './errors.js';
import {
  effectiveUploadLimitBytes,
  normalizeRelativePath,
  parentPathOf,
  toContainerPath,
  toServerFileContentDto,
  toServerFileListDto,
} from './files.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerRecord } from './repository.js';

export interface ServerFileAccessOptions {
  /** Darf der Aufrufer schreiben (`canManageFiles`)? Steht so im DTO. */
  readonly writable: boolean;
}

export interface ServerFileUploadOptions extends ServerFileAccessOptions {
  /** Vorhandene Datei am Zielpfad ersetzen; ohne Angabe lehnt der Agent ab. */
  readonly overwrite?: boolean;
}

/** Server samt offener Agent-Verbindung und Container – liefert der Orchestrierungsdienst. */
export interface LiveTarget {
  readonly server: ServerRecord;
  readonly session: AgentSession;
  readonly containerId: string;
}

/**
 * Ein geöffneter Ordner-Download: Name, zugesagte Größe und die Blöcke.
 *
 * Aufbau wie beim Backup-Download – die Route schreibt die Blöcke in ihre
 * Antwort, statt das Archiv erst vollständig zu puffern.
 */
export interface ServerDirectoryDownload {
  readonly fileName: string;
  /**
   * Endgröße des Archivs, oder `null`, solange der Agent noch packt
   * (Leistungsbericht 19.09.2026, Punkt 1.1).
   *
   * `null` heißt für die Route: keine Gesamtlänge ankündigen. Der Download
   * beginnt dafür sofort, statt erst nach dem vollständigen Packen.
   */
  readonly totalBytes: number | null;
  chunks(): AsyncGenerator<Buffer>;
}

/**
 * Pause, bevor nach einem Block ohne Daten erneut gefragt wird.
 *
 * Kurz genug, dass der Download nicht stockt, lang genug, dass das Warten auf
 * ein langsames Packen keine Dauerschleife wird.
 */
const DIRECTORY_DOWNLOAD_RETRY_MS = 200;

/** Kurze Pause, ohne einen Zeitgeber offen zu lassen. */
function warte(ms: number): Promise<void> {
  return new Promise((weiter) => {
    setTimeout(weiter, ms).unref();
  });
}

/**
 * Blockgröße beim Abholen eines gepackten Ordners.
 *
 * Vier Mebibyte, wie beim Backup-Download: groß genug, dass ein Gigabyte nicht
 * in Tausenden Befehlen ankommt, klein genug für den Speicher des Agents.
 */
const DIRECTORY_DOWNLOAD_BLOCK_BYTES = 4 * 1024 * 1024;

export interface ServerFileServiceDependencies {
  readonly registry: GameRegistry;
  readonly config: {
    readonly fileListTimeoutMs: number;
    /**
     * Frist für das Packen eines Ordners (`FILE_ARCHIVE`).
     *
     * Eigene Zahl, weil hier tatsächlich gearbeitet wird: Ein Weltordner mit
     * zehntausenden Dateien braucht Minuten, während das Auflisten in
     * Sekunden fertig ist.
     */
    readonly directoryArchiveTimeoutMs: number;
    /**
     * Pause, bevor nach einem Block ohne Daten erneut gefragt wird; ohne
     * Angabe 200 ms. Tests setzen sie auf 0, damit sie nicht echt warten.
     */
    readonly directoryArchiveRetryMs?: number;
    readonly maxUploadBytes: number;
  };
  /** Wie `ServerOrchestrationService.requireLiveTarget` – Server, Sitzung, Container. */
  readonly requireLiveTarget: (serverId: string) => Promise<LiveTarget>;
  readonly now?: () => Date;
}

export class ServerFileService {
  private readonly deps: ServerFileServiceDependencies;
  private readonly now: () => Date;

  constructor(deps: ServerFileServiceDependencies) {
    this.deps = deps;
    this.now = deps.now ?? ((): Date => new Date());
  }

  /** Verzeichnisinhalt als DTO, samt der geltenden Grenzen. */
  async listFiles(
    serverId: string,
    relativePath: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileListDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = normalizeRelativePath(relativePath);

    const result = await session.sendCommand(
      'FILE_LIST',
      server.id,
      { containerId, path: toContainerPath(dataRoot, relativ) },
      { timeoutMs: this.deps.config.fileListTimeoutMs },
    );

    return toServerFileListDto(server.id, dataRoot, relativ, result.entries, {
      writable: options.writable,
      maxUploadBytes: this.maxUploadBytes(),
    });
  }

  /** Dateiinhalt für den eingebauten Editor. */
  async readFile(
    serverId: string,
    relativePath: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileContentDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);

    const result = await session.sendCommand('FILE_READ', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
    });
    const content = Buffer.from(result.contentBase64, 'base64');

    return toServerFileContentDto(
      server.id,
      relativ,
      content,
      await this.fileModifiedAt(server.id, relativ),
      options.writable,
    );
  }

  /**
   * Datei aus dem Editor zurückschreiben.
   *
   * Überschreibt still – anders als {@link uploadFile}. Das ist gewollt: Hier
   * wird genau die Datei gespeichert, die der Nutzer vorher geöffnet hat.
   */
  async writeFile(
    serverId: string,
    relativePath: string,
    content: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileContentDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);
    const inhalt = Buffer.from(content, 'utf8');

    this.assertWithinTransferLimit(inhalt.byteLength);

    await session.sendCommand('FILE_WRITE', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
      contentBase64: inhalt.toString('base64'),
    });

    return toServerFileContentDto(
      server.id,
      relativ,
      inhalt,
      await this.fileModifiedAt(server.id, relativ),
      options.writable,
    );
  }

  /**
   * Hochgeladene Datei im Zielordner ablegen.
   *
   * Einziger Unterschied zu {@link writeFile}: Der Agent prüft den Zielpfad vor
   * dem Schreiben und lehnt einen belegten Pfad ohne `overwrite` mit
   * `AGENT_FILE_EXISTS` (409) ab. Ein Upload legt eine neue Datei an – dass
   * dabei unbemerkt eine gleichnamige verschwindet, wäre Datenverlust ohne
   * Rückfrage.
   *
   * @returns Der Inhalt des Zielordners nach dem Upload.
   */
  async uploadFile(
    serverId: string,
    directoryPath: string,
    fileName: string,
    content: Buffer,
    options: ServerFileUploadOptions,
  ): Promise<ServerFileListDto> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const verzeichnis = normalizeRelativePath(directoryPath);
    const ziel = this.requireFilePath(path.posix.join(verzeichnis, fileName));

    this.assertWithinTransferLimit(content.byteLength);

    await session.sendCommand('FILE_UPLOAD', server.id, {
      containerId,
      path: toContainerPath(dataRoot, ziel),
      contentBase64: content.toString('base64'),
      ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    });

    return this.listFiles(server.id, verzeichnis, { writable: options.writable });
  }

  /**
   * Datei oder Verzeichnis entfernen; ein bereits fehlender Pfad ist kein
   * Fehler.
   *
   * **Vorgabe `false`** (Audit contract-drift-03). Der Vertrag zieht die Grenze
   * ausdrücklich: „Ohne Angabe lehnt der Agent das Löschen eines nicht-leeren
   * Verzeichnisses ab, damit ein versehentlicher Klick nicht einen ganzen
   * Datenbaum mitnimmt" (`FileDeleteCommandPayload`). Die bisherige Vorgabe
   * `true` hob genau diese Schranke wieder auf – ein Klick auf „Löschen" neben
   * `world/` nahm die ganze Welt mit, ohne dass die Oberfläche den Unterschied
   * zwischen Datei und Verzeichnis auch nur benannt hätte. Wer einen Baum
   * löschen will, sagt es jetzt ausdrücklich.
   */
  async deleteFile(serverId: string, relativePath: string, recursive = false): Promise<void> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);

    await session.sendCommand('FILE_DELETE', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
      recursive,
    });
  }

  /** Eine einzelne Datei zum Herunterladen laden (Grenze: `AGENT_FILE_CHANNEL_MAX_BYTES`). */
  async downloadFile(
    serverId: string,
    relativePath: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = this.requireFilePath(relativePath);

    const result = await session.sendCommand('FILE_READ', server.id, {
      containerId,
      path: toContainerPath(dataRoot, relativ),
    });

    return {
      fileName: path.posix.basename(relativ),
      content: Buffer.from(result.contentBase64, 'base64'),
    };
  }

  /**
   * Einen Ordner als `tar.gz` zum Herunterladen öffnen (Betreiber, 19.09.2026).
   *
   * Zwei Stufen, wie beim Backup-Download: Der Agent packt zuerst und meldet
   * die Größe, danach holt der Aufrufer Block für Block. Erst dadurch geht ein
   * Ordner überhaupt durch – eine Datei ist auf die Kanalgrenze begrenzt, ein
   * Weltordner wiegt ein Vielfaches davon.
   *
   * Der Rückgabewert hält die Blöcke bewusst als Generator: Das Archiv fließt
   * in die HTTP-Antwort, statt vorher vollständig im Speicher zu liegen.
   *
   * Meldet der Agent `pending`, packt er noch und liefert trotzdem schon
   * Blöcke (Leistungsbericht 19.09.2026, Punkt 1.1). Dann steht die Endgröße
   * erst am Schluss fest, und ein Block ohne Daten ist kein Fehler, sondern
   * die Aufforderung, es gleich noch einmal zu versuchen.
   */
  async openDirectoryDownload(
    serverId: string,
    relativePath: string,
  ): Promise<ServerDirectoryDownload> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const relativ = normalizeRelativePath(relativePath);

    const gepackt = await session.sendCommand(
      'FILE_ARCHIVE',
      server.id,
      { containerId, path: toContainerPath(dataRoot, relativ) },
      { timeoutMs: this.deps.config.directoryArchiveTimeoutMs },
    );

    const transferId = gepackt.transferId;
    const pause = this.deps.config.directoryArchiveRetryMs ?? DIRECTORY_DOWNLOAD_RETRY_MS;

    function frageBlock(offset: number) {
      return session.sendCommand('FILE_ARCHIVE_BLOCK', server.id, {
        transferId,
        offset,
        maxBytes: DIRECTORY_DOWNLOAD_BLOCK_BYTES,
      });
    }

    async function* bloecke(): AsyncGenerator<Buffer> {
      let offset = 0;
      /*
       * Der naechste Block ist schon unterwegs, waehrend dieser noch durch die
       * Leitung zum Browser laeuft (Leistungsbericht 19.09.2026, Punkt 1.2).
       * Vorher wartete jede Anfrage erst darauf, dass der vorige Block
       * vollstaendig ausgeliefert war - bei einem Gigabyte sind das
       * zweihundertfuenfzig Rundlaeufe nacheinander.
       *
       * Genau eine Anfrage im Voraus, nicht mehr: Jede kostet vier Mebibyte
       * Speicher im Backend, und schon die eine ueberdeckt die Rueckreise.
       */
      let offen: Promise<FileArchiveBlockCommandResult> | null = null;
      let laufend: Promise<FileArchiveBlockCommandResult> = frageBlock(offset);

      try {
        for (;;) {
          const block = await laufend;

          const bytes = Buffer.from(block.contentBase64, 'base64');
          offset += block.bytesRead;

          if (block.pending === true && block.bytesRead === 0) {
            /*
             * Der Agent packt noch, an dieser Stelle steht aber noch nichts.
             * Kurz warten und dieselbe Stelle erneut abfragen - ohne die Pause
             * würde das Backend den Agent mit Anfragen überziehen, während
             * gzip arbeitet.
             */
            offen = null;
            await warte(pause);
            laufend = frageBlock(offset);
            offen = laufend;
            continue;
          }

          if (!block.eof && block.bytesRead > 0) {
            laufend = frageBlock(offset);
            offen = laufend;
          } else {
            offen = null;
          }

          if (bytes.length > 0) {
            yield bytes;
          }

          if (block.eof) {
            return;
          }

          if (block.bytesRead === 0) {
            /*
             * Kein Fortschritt, kein Ende und auch kein `pending`:
             * Weiterfragen liefe endlos. Derselbe Schutz wie beim
             * Backup-Download.
             */
            throw new ServerOrchestrationError(
              'AGENT_COMMAND_FAILED',
              'Der Agent liefert keine weiteren Daten, meldet aber kein Ende des Archivs.',
            );
          }
        }
      } finally {
        /*
         * Bricht der Browser mitten im Download ab, endet der Generator hier -
         * die vorausgeschickte Anfrage laeuft aber weiter. Ohne diesen Fang
         * meldet Node ihren Fehlschlag als unbehandelte Zurueckweisung und
         * beendet im schlimmsten Fall den Prozess.
         */
        offen?.catch(() => undefined);
      }
    }

    return {
      fileName: gepackt.fileName,
      // Packt der Agent noch, ist `sizeBytes` nur ein Zwischenstand.
      totalBytes: gepackt.pending === true ? null : gepackt.sizeBytes,
      chunks: bloecke,
    };
  }

  /**
   * Tatsächlich zulässige Upload-Größe: der kleinere der beiden Werte.
   *
   * Öffentlich, weil die Upload-Route dieselbe Zahl als Multipart-Grenze je
   * Aufruf setzt (Fundpunkt 123) – so puffert das Backend nie mehr, als der
   * Dienst gleich darauf annehmen würde.
   */
  maxUploadBytes(): number {
    return effectiveUploadLimitBytes(this.deps.config.maxUploadBytes);
  }

  private assertWithinTransferLimit(sizeBytes: number): void {
    if (sizeBytes > this.maxUploadBytes()) {
      throw new ServerOrchestrationError(
        'FILE_TOO_LARGE',
        'Die Datei überschreitet die zulässige Upload-Größe.',
        { sizeBytes, maxBytes: this.maxUploadBytes() },
      );
    }
  }

  /** Wie {@link normalizeRelativePath}, lehnt aber zusätzlich die Wurzel ab. */
  private requireFilePath(relativePath: string): string {
    const relativ = normalizeRelativePath(relativePath);

    if (relativ === '') {
      throw new ServerOrchestrationError(
        'AGENT_INVALID_PATH',
        'Für diesen Vorgang wird eine Datei benötigt, nicht der Datenordner selbst.',
      );
    }

    return relativ;
  }

  /**
   * Änderungszeitpunkt einer Datei – aus dem Verzeichnis, in dem sie liegt.
   *
   * `FILE_READ` liefert keinen Zeitstempel; der DTO braucht ihn (Anzeige und
   * Konflikterkennung im Editor). Statt ihn zu erfinden, wird das Verzeichnis
   * gelistet und der Eintrag herausgesucht. Findet sich keiner – etwa weil die
   * Datei zwischen beiden Aufrufen verschwindet – bleibt es beim Lesezeitpunkt.
   */
  private async fileModifiedAt(serverId: string, relativePath: string): Promise<string> {
    const { server, session, containerId, dataRoot } = await this.requireFileTarget(serverId);
    const elternPfad = parentPathOf(relativePath) ?? '';

    const result = await session.sendCommand(
      'FILE_LIST',
      server.id,
      { containerId, path: toContainerPath(dataRoot, elternPfad) },
      { timeoutMs: this.deps.config.fileListTimeoutMs },
    );
    const name = path.posix.basename(relativePath);

    return (
      result.entries.find((entry) => entry.name === name)?.modifiedAt ?? this.now().toISOString()
    );
  }

  /** Wie `requireLiveTarget`, zusätzlich mit dem Datenordner des Spiels. */
  private async requireFileTarget(serverId: string): Promise<LiveTarget & { dataRoot: string }> {
    const ziel = await this.deps.requireLiveTarget(serverId);

    return {
      ...ziel,
      dataRoot: this.deps.registry.require(ziel.server.gameType).dataVolumeContainerPath,
    };
  }
}
