/**
 * Zuweisung öffentlicher Ports (Pflichtenheft §2.4).
 *
 * „Zuordnung Port ↔ Zielserver liegt in der Datenbank, wird bei Erstellung/
 * Löschung eines Servers automatisch aktualisiert."
 *
 * **Der Pool gehört B8** (Admin-Funktionen: Adressen/Port-Bereiche). B3 vergibt
 * keine Ports selbst, sondern ruft `PortPoolService.allocateForServer()` bzw.
 * `.releaseForServer()` – genau dafür sind sie dort vorgesehen. Diese Datei
 * enthält nur zweierlei:
 *
 * 1. {@link PortAllocator} – die schmale Sicht, die der Dienst braucht, damit
 *    er weder den Admin-Kontext noch das DTO-Format von B8 kennen muss.
 * 2. Die Übersetzung zwischen der Spiele-Definition (welche Ports braucht das
 *    Spiel?) und den Portanfragen von B8, plus die Rückabbildung auf
 *    `ServerPortAssignment` aus den Contracts.
 */

import { type GameTypeDefinition } from '@palantir/contracts';
import { type ServerPortAssignment } from './types.js';
import { ServerOrchestrationError } from './errors.js';

/** Was der Dienst vom Port-Pool braucht. */
export interface PortAllocator {
  /**
   * Weist einem Server die Ports seiner Spiele-Definition zu.
   *
   * @param options.virtualHostPort Fester öffentlicher Port bei Spielen mit
   *   Hostname-Routing. Für den primären Port wird dann **nichts** aus dem Pool
   *   genommen: Alle Instanzen teilen sich diesen einen Port (Pflichtenheft
   *   §2.4, §13).
   */
  allocate(
    serverId: string,
    definition: GameTypeDefinition,
    options: { readonly nodeId: string; readonly virtualHostPort?: number | null },
  ): Promise<readonly ServerPortAssignment[]>;

  /** Gibt alle Ports eines Servers wieder frei (beim Löschen). */
  release(serverId: string): Promise<void>;
}

/** Ausschnitt von `PortPoolService` aus B8, den B3 benutzt. */
export interface PortPoolPort {
  allocateForServer(
    serverId: string,
    requests: readonly {
      readonly protocol: 'tcp' | 'udp';
      readonly count: number;
      readonly nodeId?: string | null;
    }[],
  ): Promise<readonly { readonly port: number; readonly protocol: 'tcp' | 'udp' }[]>;
  releaseForServer(serverId: string): Promise<number>;
}

/**
 * Bindet den Port-Pool aus B8 an.
 *
 * Die Ports werden je Protokoll **gebündelt** angefragt, nicht einzeln: B8 sucht
 * dann in einem Durchgang und muss die Belegung nicht je Port neu laden.
 * Zugeordnet wird anschließend in derselben Reihenfolge, in der die Definition
 * ihre Ports führt.
 */
export function createPortAllocator(pool: PortPoolPort): PortAllocator {
  return {
    async allocate(serverId, definition, options) {
      const usesSharedPort =
        definition.supportsVirtualHostRouting && typeof options.virtualHostPort === 'number';

      // Bei Hostname-Routing bekommt der primäre Port keinen eigenen aus dem Pool.
      const fromPool = definition.ports.filter((port) => !(usesSharedPort && port.primary));

      const counts = new Map<'tcp' | 'udp', number>();

      for (const port of fromPool) {
        counts.set(port.protocol, (counts.get(port.protocol) ?? 0) + 1);
      }

      const allocated =
        fromPool.length === 0
          ? []
          : await pool.allocateForServer(
              serverId,
              [...counts.entries()].map(([protocol, count]) => ({
                protocol,
                count,
                nodeId: options.nodeId,
              })),
            );

      const queues = new Map<'tcp' | 'udp', number[]>();

      for (const entry of allocated) {
        const queue = queues.get(entry.protocol) ?? [];
        queue.push(entry.port);
        queues.set(entry.protocol, queue);
      }

      const assignments: ServerPortAssignment[] = [];

      for (const port of definition.ports) {
        if (usesSharedPort && port.primary) {
          assignments.push({
            publicPort: options.virtualHostPort as number,
            containerPort: port.containerPort,
            protocol: port.protocol,
            label: port.label,
            primary: true,
          });
          continue;
        }

        const publicPort = queues.get(port.protocol)?.shift();

        if (publicPort === undefined) {
          // Sollte nicht vorkommen – B8 wirft bei erschöpftem Pool selbst. Hier
          // stünde sonst eine halbe Portzuweisung in der Datenbank.
          throw new ServerOrchestrationError('PORT_POOL_EXHAUSTED', undefined, {
            serverId,
            protocol: port.protocol,
          });
        }

        assignments.push({
          publicPort,
          containerPort: port.containerPort,
          protocol: port.protocol,
          label: port.label,
          primary: port.primary,
        });
      }

      return assignments;
    },

    async release(serverId) {
      await pool.releaseForServer(serverId);
    },
  };
}

/**
 * Der Port, den der Spieler eingibt.
 *
 * `null` bei Spielen mit Hostname-Routing – dort ist für den Spieler kein Port
 * sichtbar (Pflichtenheft §13).
 */
export function visiblePortOf(
  assignments: readonly ServerPortAssignment[],
  supportsVirtualHostRouting: boolean,
): number | null {
  if (supportsVirtualHostRouting) {
    return null;
  }

  return assignments.find((assignment) => assignment.primary)?.publicPort ?? null;
}
