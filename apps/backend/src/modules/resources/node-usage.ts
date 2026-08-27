/**
 * Auslastung je Node für die Node-Übersicht (Lastenheft §3.7).
 *
 * B8 hat den Anschluss `NodeUsageSource` offen gelassen, weil die Zahlen nicht
 * ihm gehören. Sie gehören hierher: **Es ist dieselbe Belegung, gegen die die
 * harte Kapazitätsprüfung vor jedem Start rechnet** (Pflichtenheft §10). Eine
 * zweite Quelle für dieselbe Größe wäre die Sorte Abweichung, die niemand
 * bemerkt, bis die Übersicht Platz zeigt und der Start trotzdem abgelehnt wird –
 * deshalb eine Quelle, nicht zwei.
 *
 * **Was diese Zahlen sind – und was nicht:** `ServerUsageRepository` zählt über
 * `game_servers`, also die **reservierten** Limits der Server, nicht den vom
 * Betriebssystem gemessenen Verbrauch. Ein echter Messwert müsste vom Agent
 * kommen; das Protokoll aus Pflichtenheft §5.3 kennt dafür bislang nur
 * `GET_STATS` je Container, keinen node-weiten Wert. Eine Erweiterung des
 * Protokolls wäre eine neue Funktion und gehört nicht in ein Verdrahtungs-Paket
 * – sie ist in WORK_STATUS.md unter „Gefundene Punkte" vermerkt. Bis dahin gilt
 * die Reservierung als obere Schranke des Verbrauchs: Sie überschätzt eher, und
 * das ist bei einer Auslastungsanzeige die richtige Richtung.
 *
 * `cpuPercent` bezieht sich – wie in `HostNodeUsage` beschrieben – auf die
 * gesamte Node: 100 bedeutet „alle Kerne der VM reserviert", nicht „ein Kern
 * ausgelastet" (anders als `AgentContainerStats.cpuPercent`, das je Container
 * misst).
 */

import { type HostNodeUsage } from '@palantir/contracts';
import { type NodeUsageSource } from '../admin/index.js';
import { type HostNodeRepository, type ServerUsageRepository } from './ports.js';

export interface NodeUsageSourceDependencies {
  readonly nodes: HostNodeRepository;
  readonly usage: ServerUsageRepository;
  /** Zeitquelle für `sampledAt` – austauschbar, damit Tests nicht an der Uhr hängen. */
  readonly now?: () => Date;
}

/** Anteil in Prozent; `null`, wenn die Bezugsgröße unbekannt oder 0 ist. */
function percentOf(used: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) {
    return null;
  }

  return Math.round((used / total) * 1000) / 10;
}

export function createNodeUsageSource(deps: NodeUsageSourceDependencies): NodeUsageSource {
  const now = deps.now ?? ((): Date => new Date());

  return {
    async load(): Promise<ReadonlyMap<string, HostNodeUsage>> {
      const nodes = await deps.nodes.listAll();
      const sampledAt = now().toISOString();

      const entries = await Promise.all(
        nodes.map(async (node): Promise<[string, HostNodeUsage]> => {
          const usage = await deps.usage.usageForNode(node.id);

          return [
            node.id,
            {
              cpuPercent: percentOf(usage.runningCpuCores, node.totalResources.cpuCores),
              ramUsedMb: usage.runningRamMb,
              diskUsedMb: usage.allocatedDiskMb,
              sampledAt,
            },
          ];
        }),
      );

      return new Map(entries);
    },
  };
}
