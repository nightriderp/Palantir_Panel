/**
 * Ressourcen-Warnungen (Pflichtenheft §10 und §14).
 *
 * Erreicht die Belegung einen konfigurierbaren Schwellwert, entsteht die
 * Nutzlast des Events `resource.low`. Verschickt wird das Event **nicht** hier:
 * Konsument ist die Notification-Engine (B6). Dieses Modul liefert nur die
 * Auswertung, damit die Schwelle an genau einer Stelle definiert ist und nicht
 * in jedem aufrufenden Paket neu.
 *
 * Zwei Ebenen, beide über eigene Schwellwerte konfigurierbar
 * (`RESOURCE_WARN_NODE_PERCENT` / `RESOURCE_WARN_SERVER_PERCENT`):
 *
 * - **Node:** Belegung der Ziel-VM gegen ihre Gesamt-Ressourcen.
 * - **Server:** Verbrauch eines einzelnen Servers gegen sein *eigenes* Limit.
 *
 * Wie `capacity.ts` kennt diese Datei weder Datenbank noch HTTP und ist damit
 * ohne Infrastruktur testbar (CLAUDE.md §4).
 */

import {
  type NodeResourceUsage,
  type NodeResources,
  type ResourceLowEvent,
  type ServerResourceLimits,
  unitForResource,
} from '@palantir/contracts';

/** Ressourcenarten, für die es eine Warnung geben kann – eine Anzahl wird nie „knapp". */
type WarnableResource = 'ram' | 'cpu' | 'disk';

/**
 * Belegung in Prozent, auf eine Nachkommastelle gerundet.
 *
 * Eine Gesamtmenge von 0 (oder kleiner) ist keine Division wert: eine Node ohne
 * Kapazität gilt als voll, sobald überhaupt etwas belegt ist, und sonst als
 * leer. Ohne diese Sonderbehandlung entstünde `Infinity` bzw. `NaN`.
 */
export function usedPercent(used: number, total: number): number {
  if (total <= 0) {
    return used > 0 ? 100 : 0;
  }

  return Math.round((used / total) * 1000) / 10;
}

interface WarningCandidate {
  readonly resource: WarnableResource;
  readonly used: number;
  readonly total: number;
}

function buildWarnings(
  candidates: readonly WarningCandidate[],
  base: Pick<ResourceLowEvent, 'scope' | 'nodeId' | 'serverId'>,
  thresholdPercent: number,
  at: Date,
): ResourceLowEvent[] {
  const warnings: ResourceLowEvent[] = [];

  for (const candidate of candidates) {
    const percent = usedPercent(candidate.used, candidate.total);

    if (percent < thresholdPercent) {
      continue;
    }

    warnings.push({
      ...base,
      resource: candidate.resource,
      unit: unitForResource(candidate.resource),
      used: candidate.used,
      total: candidate.total,
      usedPercent: percent,
      thresholdPercent,
      at: at.toISOString(),
    });
  }

  return warnings;
}

export interface NodeWarningInput {
  readonly nodeId: string;
  readonly total: NodeResources;
  readonly usage: NodeResourceUsage;
  /** Schwellwert in Prozent (`RESOURCE_WARN_NODE_PERCENT`). */
  readonly thresholdPercent: number;
  /** Zeitstempel der Auswertung – injizierbar, damit Tests nicht von der Uhr abhängen. */
  readonly at?: Date;
}

/**
 * Warnungen auf Node-Ebene.
 *
 * RAM und CPU werden gegen die laufenden Server gemessen, Speicherplatz gegen
 * alle Server – ein gestoppter Server gibt seinen Datenordner nicht frei.
 */
export function evaluateNodeWarnings(input: NodeWarningInput): ResourceLowEvent[] {
  return buildWarnings(
    [
      { resource: 'ram', used: input.usage.runningRamMb, total: input.total.ramMb },
      { resource: 'cpu', used: input.usage.runningCpuCores, total: input.total.cpuCores },
      { resource: 'disk', used: input.usage.allocatedDiskMb, total: input.total.diskMb },
    ],
    { scope: 'node', nodeId: input.nodeId, serverId: null },
    input.thresholdPercent,
    input.at ?? new Date(),
  );
}

export interface ServerWarningInput {
  readonly serverId: string;
  readonly nodeId: string;
  /** Das eigene Limit des Servers (`GameServer.resourceLimits`, Pflichtenheft §6). */
  readonly limits: ServerResourceLimits;
  /**
   * Gemessener Verbrauch in **absoluten** Werten.
   *
   * Bewusst nicht als Prozentwert übergeben: `ServerLiveStats.cpuPercent` legt
   * seine Bezugsgröße nicht fest (Anteil am eigenen Limit oder an der ganzen
   * Node?). Die Umrechnung in Kerne macht der Aufrufer, damit die Bezugsgröße
   * nicht in diesem Modul geraten wird. `null` heißt „das Spiel bzw. der Agent
   * liefert diesen Wert nicht" – dafür gibt es dann auch keine Warnung.
   */
  readonly usedRamMb: number | null;
  readonly usedCpuCores: number | null;
  readonly usedDiskMb: number | null;
  /** Schwellwert in Prozent (`RESOURCE_WARN_SERVER_PERCENT`). */
  readonly thresholdPercent: number;
  readonly at?: Date;
}

/** Warnungen auf Server-Ebene: Verbrauch gegen das eigene Limit des Servers. */
export function evaluateServerWarnings(input: ServerWarningInput): ResourceLowEvent[] {
  const candidates: WarningCandidate[] = [];

  if (input.usedRamMb !== null) {
    candidates.push({ resource: 'ram', used: input.usedRamMb, total: input.limits.ramMb });
  }

  if (input.usedCpuCores !== null) {
    candidates.push({ resource: 'cpu', used: input.usedCpuCores, total: input.limits.cpuCores });
  }

  if (input.usedDiskMb !== null) {
    candidates.push({ resource: 'disk', used: input.usedDiskMb, total: input.limits.diskMb });
  }

  return buildWarnings(
    candidates,
    { scope: 'server', nodeId: input.nodeId, serverId: input.serverId },
    input.thresholdPercent,
    input.at ?? new Date(),
  );
}
