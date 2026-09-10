/**
 * Umsetzung der Anschlusspunkte, die B8 (Admin-Funktionen) für B3 offen gelassen
 * hat (`modules/admin/module.ts`).
 *
 * B8 verwaltet Nodes, Ports und den Storage-Explorer, kennt aber weder
 * `game_servers` noch den Agent-Kanal. Solange die Anschlüsse leer bleiben,
 * zeigt der Storage-Explorer jeden Datenordner als unbekannt und gesperrt
 * (Pflichtenheft §16) und die Port-Übersicht keine Servernamen (§2.4).
 *
 * Drei Quellen lesen nur `game_servers`, die vierte spricht über den
 * WebSocket-Endpunkt `/agent`:
 *
 * | Anschluss | Was er liefert |
 * |---|---|
 * | {@link createServerNodePlacementSource} | Server je Node und deren reservierte Ressourcen |
 * | {@link createServerKnownServerSource} | bekannte Server für die Bewertung der Datenordner |
 * | {@link createServerNameSource} | Anzeigenamen in der Port-Übersicht |
 * | {@link createAgentStorageScanGateway} | `GET_STORAGE_BREAKDOWN` über den Agent-Kanal |
 * | {@link createAgentNodeConnectionSource} | ob für eine Node gerade eine Agent-Sitzung besteht |
 */

import {
  type ApiResponse,
  type GetStorageBreakdownCommandPayload,
  type GetStorageBreakdownCommandResult,
  type NodeResources,
  type RemovableStorageEntryKind,
  type RemoveStorageEntryCommandPayload,
  type StorageEntryDto,
  fail,
  ok,
} from '@palantir/contracts';
import { type Database } from '../../db/client.js';
import { gameServers } from '../../db/schema.js';
import {
  type KnownServerSource,
  type NodeConnectionSource,
  type NodePlacement,
  type NodePlacementSource,
  type StorageEntryRemover,
  type StorageScanGateway,
} from '../admin/index.js';
import { type AgentRegistry } from './agent-gateway.js';
import { isServerOrchestrationError } from './errors.js';
import { CONSUMING_STATUSES } from './usage-repository.js';

const NO_RESOURCES: NodeResources = { ramMb: 0, cpuCores: 0, diskMb: 0 };

/**
 * Belegung je Node aus `game_servers`.
 *
 * `allocated` ist die Summe der Ressourcen-Limits **aller** dort angelegten
 * Server – der reservierte, nicht der gemessene Anteil (siehe Kopfkommentar in
 * `admin/nodes.ts`). Ein gestoppter Server zählt mit: Sein Datenordner liegt
 * weiter auf der Platte, und beim nächsten Start soll die Node den Platz haben.
 */
/** Eine Serverzeile, so viel wie die Belegungsrechnung davon braucht. */
export interface BelegungsZeile {
  readonly hostId: string;
  readonly status: string;
  readonly resourceLimits: NodeResources;
}

/**
 * Rechnet die Zeilen zu `gebucht` und `laufend` je Node zusammen
 * (Fundpunkt 203).
 *
 * Ausgelagert und exportiert, damit die Regel ohne laufende Datenbank pruefbar
 * bleibt (CLAUDE.md §4) - sie ist der Grund, warum Uebersicht und
 * Kapazitaetsschranke frueher auseinanderliefen.
 *
 * `allocated` zaehlt alle Zustaende. `running` nimmt RAM und CPU nur von den
 * Servern, die laufen oder starten (`CONSUMING_STATUSES` aus
 * `usage-repository.ts`, dieselbe Liste, die die Schranke benutzt); die Platte
 * zaehlt auch dort ueber alle Zustaende, denn der Datenordner bleibt liegen,
 * wenn der Server aus ist.
 */
export function fasseBelegungZusammen(
  rows: readonly BelegungsZeile[],
): ReadonlyMap<string, NodePlacement> {
  const byNode = new Map<
    string,
    { serverCount: number; allocated: NodeResources; running: NodeResources }
  >();

  for (const row of rows) {
    const entry = byNode.get(row.hostId) ?? {
      serverCount: 0,
      allocated: NO_RESOURCES,
      running: NO_RESOURCES,
    };
    const laeuft = CONSUMING_STATUSES.has(row.status);

    byNode.set(row.hostId, {
      serverCount: entry.serverCount + 1,
      allocated: {
        ramMb: entry.allocated.ramMb + row.resourceLimits.ramMb,
        cpuCores: entry.allocated.cpuCores + row.resourceLimits.cpuCores,
        diskMb: entry.allocated.diskMb + row.resourceLimits.diskMb,
      },
      running: {
        ramMb: entry.running.ramMb + (laeuft ? row.resourceLimits.ramMb : 0),
        cpuCores: entry.running.cpuCores + (laeuft ? row.resourceLimits.cpuCores : 0),
        diskMb: entry.running.diskMb + row.resourceLimits.diskMb,
      },
    });
  }

  return byNode;
}

export function createServerNodePlacementSource(db: Database): NodePlacementSource {
  return {
    async load(): Promise<ReadonlyMap<string, NodePlacement>> {
      const rows = await db
        .select({
          hostId: gameServers.hostId,
          status: gameServers.status,
          resourceLimits: gameServers.resourceLimits,
        })
        .from(gameServers);

      return fasseBelegungZusammen(rows);
    },
  };
}

/**
 * Bekannte Server für den Storage-Explorer.
 *
 * Erst mit dieser Liste kann B8 einen gemeldeten Datenordner einem Server
 * zuordnen. Fehlt sie, bleibt jeder Ordner in der Kategorie `other` und damit
 * gesperrt – die bewusst restriktive Auslegung aus Pflichtenheft §16.
 */
export function createServerKnownServerSource(db: Database): KnownServerSource {
  return {
    async load(): Promise<ReadonlyMap<string, { readonly name: string }>> {
      const rows = await db
        .select({ id: gameServers.id, name: gameServers.name })
        .from(gameServers);

      return new Map(rows.map((row) => [row.id, { name: row.name }]));
    },
  };
}

/** Anzeigenamen der Server für die Port-Übersicht (Pflichtenheft §2.4). */
export function createServerNameSource(db: Database): () => Promise<ReadonlyMap<string, string>> {
  return async (): Promise<ReadonlyMap<string, string>> => {
    const rows = await db.select({ id: gameServers.id, name: gameServers.name }).from(gameServers);

    return new Map(rows.map((row) => [row.id, row.name]));
  };
}

/**
 * Speicher-Scan über den Agent-Kanal (Pflichtenheft §16).
 *
 * `GET_STORAGE_BREAKDOWN` ist ein node-weiter Befehl und trägt deshalb keine
 * `serverId`. Fehler kommen wie bei den Backup-Befehlen als Envelope zurück und
 * nicht als geworfener Fehler – B8 erwartet einen `ApiResponse` und übersetzt
 * den Code selbst in die Antwort der Route.
 *
 * Der Agent führt den Befehl bis A3 nicht aus und antwortet mit
 * `AGENT_COMMAND_NOT_IMPLEMENTED`. Das ist der Unterschied, um den es hier
 * geht: Vorher meldete das Backend „keine Verbindung zum Agent", obwohl der
 * Kanal längst steht.
 */
/** Welche Arten der Vertrag zum Entfernen kennt (`RemovableStorageEntryKind`). */
function isRemovableKind(kind: StorageEntryDto['kind']): kind is RemovableStorageEntryKind {
  return kind === 'backup' || kind === 'dockerImage' || kind === 'orphaned';
}

/**
 * Entfernt einen Posten der Speicherübersicht auf dem Homeserver
 * (`REMOVE_STORAGE_ENTRY`, WORK_STATUS.md Gefundener Punkt 75).
 *
 * Bis hierher meldete die Umsetzung `AGENT_COMMAND_NOT_IMPLEMENTED`: Die
 * Entscheidung, **ob** gelöscht werden darf, traf B8 schon immer selbst, nur
 * das Entfernen fehlte. Seit A3 kennt das Protokoll den Befehl.
 *
 * Die Zuordnung ist geradlinig – `kind`, `path` bzw. `imageId`. Ein Datenordner
 * eines Servers (`serverData`) kommt hier gar nicht erst an: Der Vertrag kennt
 * die Kategorie in `RemovableStorageEntryKind` nicht, und B8 lehnt sie vorher
 * ab. Gelöscht wird ein Server ausschließlich über den dafür gebauten Weg,
 * nicht über den Speicher-Explorer (Lastenheft §3.8).
 */
export function createAgentStorageEntryRemover(agents: AgentRegistry): StorageEntryRemover {
  return {
    async remove(node, entry): Promise<ApiResponse<null>> {
      const session = agents.get(node.id);

      if (session === null) {
        return fail('AGENT_NOT_CONNECTED');
      }

      if (!isRemovableKind(entry.kind)) {
        /*
         * Sollte B8 nie durchlassen; hier steht es trotzdem, damit die Regel
         * auch dann gilt, wenn jemand später an der Entscheidung schraubt. Der
         * Datenordner eines Servers wird über das Löschen des Servers entfernt,
         * nicht über den Speicher-Explorer (Lastenheft §3.8); `other` ist ein
         * Sammelposten der Anzeige, hinter dem kein löschbares Ding steht.
         */
        return fail(
          'VALIDATION_FAILED',
          `Ein Posten der Art „${entry.kind}" wird nicht über den Speicher-Explorer entfernt.`,
        );
      }

      const payload: RemoveStorageEntryCommandPayload = {
        kind: entry.kind,
        ...(entry.kind === 'dockerImage' ? { imageId: entry.id } : {}),
        ...(entry.path === null ? {} : { path: entry.path }),
      };

      try {
        // Der Agent antwortet idempotent: `removed: false` heißt „war schon
        // weg" und ist kein Fehler – der Posten ist danach so oder so fort.
        await session.sendCommand('REMOVE_STORAGE_ENTRY', null, payload);

        return ok(null);
      } catch (error: unknown) {
        if (isServerOrchestrationError(error)) {
          return fail(error.code, error.message);
        }

        return fail(
          'AGENT_COMMAND_FAILED',
          error instanceof Error ? error.message : 'Unbekannter Fehler.',
        );
      }
    },
  };
}

export function createAgentStorageScanGateway(agents: AgentRegistry): StorageScanGateway {
  return {
    async requestBreakdown(
      node,
      payload: GetStorageBreakdownCommandPayload,
    ): Promise<ApiResponse<GetStorageBreakdownCommandResult>> {
      const session = agents.get(node.id);

      if (session === null) {
        return fail('AGENT_NOT_CONNECTED');
      }

      try {
        return ok(await session.sendCommand('GET_STORAGE_BREAKDOWN', null, payload));
      } catch (error: unknown) {
        if (isServerOrchestrationError(error)) {
          return fail(error.code, error.message);
        }

        return fail(
          'AGENT_COMMAND_FAILED',
          error instanceof Error ? error.message : 'Unbekannter Fehler.',
        );
      }
    },
  };
}

/**
 * Ob für eine Node gerade eine Agent-Sitzung besteht.
 *
 * Die Node-Verwaltung (B8) braucht die Auskunft, wenn eine Wartung endet: Sie
 * trägt die Node dann nicht mehr pauschal als `offline` ein, sondern mit dem
 * Zustand, der wirklich gilt. Bewusst nur diese eine Frage statt der ganzen
 * Registry – B8 soll keine Agent-Verbindungen steuern können.
 *
 * `agents.get()` liefert nur Sitzungen nach abgeschlossenem Handshake
 * (`isReady`); eine noch nicht fertig angemeldete Verbindung zählt also
 * richtigerweise nicht als verbunden.
 */
export function createAgentNodeConnectionSource(agents: AgentRegistry): NodeConnectionSource {
  return {
    isConnected(nodeId: string): boolean {
      return agents.get(nodeId) !== null;
    },
  };
}
