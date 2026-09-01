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
 * **Gemessen, sonst reserviert** (WORK_STATUS.md, Gefundener Punkt 96): Meldet
 * der Agent seine Node-Werte (`AgentNodeStats`, in `host_nodes` festgehalten),
 * zeigt die Übersicht den **tatsächlichen** Verbrauch – inklusive allem, was
 * neben den Gameservern auf der Node läuft. Fehlt die Messung oder ist sie
 * veraltet (siehe {@link MEASUREMENT_MAX_AGE_MS}), gilt weiter die Rechnung aus
 * den Kontingenten der angelegten Server: die obere Schranke des Verbrauchs.
 * Sie überschätzt eher, und das ist bei einer Auslastungsanzeige die richtige
 * Richtung. `HostNodeUsage.source` sagt, welcher der beiden Fälle vorliegt.
 *
 * `cpuPercent` bezieht sich – wie in `HostNodeUsage` beschrieben – auf die
 * gesamte Node: 100 bedeutet „alle Kerne der VM reserviert", nicht „ein Kern
 * ausgelastet" (anders als `AgentContainerStats.cpuPercent`, das je Container
 * misst).
 */

import { type HostNodeUsage } from '@palantir/contracts';
import { type NodeUsageSource } from '../admin/index.js';
import { type HostNodeRepository, type ServerUsageRepository } from './ports.js';

/**
 * Wie alt darf eine Messung sein, um noch zu zaehlen?
 *
 * Der Agent meldet seinen Ist-Zustand bei jeder Verbindung und danach
 * regelmaessig. Faellt er aus, wird der letzte Wert schnell falsch - eine
 * Auslastung von vor zwei Stunden ist keine Auslastung. Fuenf Minuten decken
 * den normalen Takt ab und schlagen bei einem echten Ausfall zeitig um.
 */
export const MEASUREMENT_MAX_AGE_MS = 5 * 60 * 1000;

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

      const jetzt = now().getTime();

      const entries = await Promise.all(
        nodes.map(async (node): Promise<[string, HostNodeUsage]> => {
          const gemessen = node.measuredUsage;
          const frisch =
            gemessen !== null && jetzt - gemessen.observedAt.getTime() <= MEASUREMENT_MAX_AGE_MS;

          if (gemessen !== null && frisch) {
            return [
              node.id,
              {
                // Systemlast ist keine Prozentzahl: `loadavg` zaehlt lauffaehige
                // Prozesse. Auf die Kerne bezogen ergibt sie den Anteil.
                cpuPercent:
                  gemessen.cpuLoad1m === null
                    ? null
                    : percentOf(gemessen.cpuLoad1m, node.totalResources.cpuCores),
                ramUsedMb: Math.max(0, node.totalResources.ramMb - gemessen.ramAvailableMb),
                diskUsedMb: Math.max(0, node.totalResources.diskMb - gemessen.diskAvailableMb),
                sampledAt: gemessen.observedAt.toISOString(),
                source: 'measured',
              },
            ];
          }

          const usage = await deps.usage.usageForNode(node.id);

          return [
            node.id,
            {
              cpuPercent: percentOf(usage.runningCpuCores, node.totalResources.cpuCores),
              ramUsedMb: usage.runningRamMb,
              diskUsedMb: usage.allocatedDiskMb,
              sampledAt,
              source: 'reserved',
            },
          ];
        }),
      );

      return new Map(entries);
    },
  };
}
