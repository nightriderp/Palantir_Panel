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
 */

import {
  type ApiResponse,
  type GetStorageBreakdownCommandPayload,
  type GetStorageBreakdownCommandResult,
  type NodeResources,
  fail,
  ok,
} from '@palantir/contracts';
import { type Database } from '../../db/client.js';
import { gameServers } from '../../db/schema.js';
import {
  type KnownServerSource,
  type NodePlacement,
  type NodePlacementSource,
  type StorageScanGateway,
} from '../admin/index.js';
import { type AgentRegistry } from './agent-gateway.js';
import { isServerOrchestrationError } from './errors.js';

const NO_RESOURCES: NodeResources = { ramMb: 0, cpuCores: 0, diskMb: 0 };

/**
 * Belegung je Node aus `game_servers`.
 *
 * `allocated` ist die Summe der Ressourcen-Limits **aller** dort angelegten
 * Server – der reservierte, nicht der gemessene Anteil (siehe Kopfkommentar in
 * `admin/nodes.ts`). Ein gestoppter Server zählt mit: Sein Datenordner liegt
 * weiter auf der Platte, und beim nächsten Start soll die Node den Platz haben.
 */
export function createServerNodePlacementSource(db: Database): NodePlacementSource {
  return {
    async load(): Promise<ReadonlyMap<string, NodePlacement>> {
      const rows = await db
        .select({ hostId: gameServers.hostId, resourceLimits: gameServers.resourceLimits })
        .from(gameServers);

      const byNode = new Map<string, { serverCount: number; allocated: NodeResources }>();

      for (const row of rows) {
        const entry = byNode.get(row.hostId) ?? { serverCount: 0, allocated: NO_RESOURCES };

        byNode.set(row.hostId, {
          serverCount: entry.serverCount + 1,
          allocated: {
            ramMb: entry.allocated.ramMb + row.resourceLimits.ramMb,
            cpuCores: entry.allocated.cpuCores + row.resourceLimits.cpuCores,
            diskMb: entry.allocated.diskMb + row.resourceLimits.diskMb,
          },
        });
      }

      return byNode;
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
