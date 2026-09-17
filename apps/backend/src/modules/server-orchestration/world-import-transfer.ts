/**
 * Übernahme eines hochgeladenen Weltdaten-Archivs in den frischen Datenordner
 * (Lastenheft §3.3 „Migration von anderen Hosting-Anbietern", Arbeitspaket P4).
 *
 * Aus `service.ts` herausgelöst (Review 2026-09-16, Befund 2.1). Der Ablauf
 * hängt an nichts aus der übrigen Orchestrierung: Er holt das Archiv aus dem
 * Zwischenspeicher der VPS (`world-import.ts`), schickt es blockweise an den
 * Agent und lässt es dort entpacken. `createServerInternal()` ruft ihn, solange
 * der Server noch als „wird angelegt" gilt.
 */

import { type FileExtractCommandResult } from '@palantir/contracts';
import { type CreateServerInput } from '@palantir/validation';
import { type AgentGatewayLogger, type AgentRegistry, type AgentSession } from './agent-gateway.js';
import { ServerOrchestrationError } from './errors.js';
import { type ServerRecord } from './repository.js';
import { type StoredWorldArchive, type WorldArchiveStore } from './world-import.js';

export type WorldImportInput = NonNullable<CreateServerInput['worldImport']>;

/**
 * Blockgröße für den Weg zum Agent (Gefundener Punkt 106): Vier MiB roh
 * werden als Base64 gut fünfeinhalb MiB – unter der Frame-Grenze des
 * Agent-Kanals (`MAX_AGENT_FRAME_BYTES`) und groß genug, dass ein Archiv von
 * einigen hundert MiB in überschaubar vielen Roundtrips ankommt.
 */
export const WORLD_IMPORT_CHUNK_BYTES = 4 * 1024 * 1024;

export interface WorldImportTransferDependencies {
  readonly agents: Pick<AgentRegistry, 'require'>;
  readonly worldArchives?: WorldArchiveStore;
  readonly config: { readonly maxWorldArchiveBytes: number };
  readonly log: AgentGatewayLogger;
}

export class WorldImportTransfer {
  private readonly deps: WorldImportTransferDependencies;

  constructor(deps: WorldImportTransferDependencies) {
    this.deps = deps;
  }

  /**
   * Das Archiv liegt seit dem Wizard-Schritt auf der VPS und wird hier
   * **einmalig** abgeholt. Entpackt wird es auf dem Homeserver: Der Agent liest
   * es, prüft jeden Eintrag gegen den Datenordner und legt die Dateien über den
   * Archiv-Endpunkt der Engine ab (`FILE_EXTRACT`). Das Backend fasst dabei
   * kein Dateisystem an – der einzige Weg auf das Datenvolume bleibt der Agent
   * (Entwicklungsregeln §4).
   */
  async importWorldData(
    server: ServerRecord,
    containerId: string,
    worldImport: WorldImportInput,
  ): Promise<void> {
    const store = this.deps.worldArchives;

    if (store === undefined) {
      throw new ServerOrchestrationError(
        'WORLD_ARCHIVE_NOT_FOUND',
        'Für Weltdaten-Übernahmen ist kein Zwischenspeicher eingerichtet.',
        { serverId: server.id },
      );
    }

    /*
     * Der Verweis gilt nur für das Konto, das hochgeladen hat
     * (orchestration-features-09). `server.ownerId` ist genau dieses Konto: Der
     * Wizard lädt hoch und legt danach den Server an, und ein geklonter Server
     * bringt gar keinen `worldImport` mit. Eine fremde `uploadId` sieht damit
     * aus wie eine abgelaufene.
     */
    const archiv = await store.take(worldImport.uploadId, server.ownerId);

    if (archiv === null) {
      throw new ServerOrchestrationError('WORLD_ARCHIVE_NOT_FOUND', undefined, {
        serverId: server.id,
        uploadId: worldImport.uploadId,
      });
    }

    try {
      const grenze = this.deps.config.maxWorldArchiveBytes;

      if (archiv.sizeBytes > grenze) {
        throw new ServerOrchestrationError(
          'FILE_TOO_LARGE',
          `Das Archiv überschreitet die zulässige Größe von ${String(grenze)} Byte.`,
          { serverId: server.id, sizeBytes: archiv.sizeBytes },
        );
      }

      const session = this.deps.agents.require(server.hostId);
      const ergebnis = await this.sendWorldArchive(session, server, containerId, archiv);

      this.deps.log.info(
        {
          serverId: server.id,
          fileName: worldImport.fileName,
          sizeBytes: archiv.sizeBytes,
          fileCount: ergebnis.fileCount,
          extractedBytes: ergebnis.extractedBytes,
          skipped: ergebnis.skipped,
        },
        'Weltdaten übernommen',
      );
    } finally {
      // Auch nach einem Fehler: Das Archiv gehört dem Nutzer und hat nach dem
      // Versuch nichts mehr auf der VPS verloren.
      await archiv.release();
    }
  }

  /**
   * Ein Archiv blockweise an den Agent geben (Gefundener Punkt 106).
   *
   * Früher ging es in einem `FILE_EXTRACT` über den Kanal und war damit auf
   * `AGENT_FILE_CHANNEL_MAX_BYTES` (64 MiB) begrenzt – für die Migration eines
   * gewachsenen Servers zu wenig. Jetzt fließt es in Blöcken; der Agent hängt
   * sie auf dem Homeserver aneinander und entpackt beim letzten.
   *
   * `transferId` ist die `uploadId` des Zwischenspeichers: Sie ist bereits
   * eindeutig, und ein zweiter Anlauf desselben Imports trifft damit auf
   * dieselbe Datei, statt eine weitere anzulegen.
   */
  private async sendWorldArchive(
    session: AgentSession,
    server: ServerRecord,
    containerId: string,
    archiv: StoredWorldArchive,
  ): Promise<FileExtractCommandResult> {
    let offset = 0;

    for (;;) {
      const block = await archiv.read(offset, WORLD_IMPORT_CHUNK_BYTES);
      // Der letzte Block ist der, nach dem nichts mehr kommt. Ein leeres Archiv
      // gibt es nicht (der Upload prüft das Format), ein leerer letzter Block
      // also auch nicht – außer die Datei ist unterwegs geschrumpft.
      const last = offset + block.byteLength >= archiv.sizeBytes;

      const antwort = await session.sendCommand('UPLOAD_ARCHIVE_BLOCK', server.id, {
        containerId,
        transferId: archiv.uploadId,
        offset,
        contentBase64: block.toString('base64'),
        last,
        // Wurzel des Datenordners – ein Weltarchiv bringt seine eigene
        // Ordnerstruktur mit.
        path: '',
        format: archiv.format,
      });

      offset += block.byteLength;

      if (antwort.extract !== null) {
        return antwort.extract;
      }

      if (block.byteLength === 0) {
        // Kein Fortschritt und kein Ergebnis: weiterzudrehen hieße, für immer
        // zu drehen.
        throw new ServerOrchestrationError(
          'WORLD_ARCHIVE_INVALID',
          'Die Übertragung des Archivs endete ohne Ergebnis.',
          { serverId: server.id, uploadId: archiv.uploadId, offset },
        );
      }
    }
  }
}
