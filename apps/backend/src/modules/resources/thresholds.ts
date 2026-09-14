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

/**
 * Ressourcenarten, für die es eine Warnung geben kann – eine Anzahl wird nie
 * „knapp".
 *
 * **Ohne CPU**, seit die CPU-Zuweisung entfallen ist: Beide Warnungen rechneten
 * gegen zugewiesene Kerne – die Node gegen die Summe der Zuweisungen, der
 * Server gegen seine eigene. Ohne Zuweisung ist diese Summe immer null, und
 * eine Warnung, die nie auslösen kann, ist schlechter als keine.
 *
 * Eine CPU-Warnung bliebe möglich, aber auf anderer Grundlage: Die Node meldet
 * ihre echte Systemlast (`AgentNodeStats.cpuLoad1m`) neben der Kernzahl. Das
 * wäre eine eigene Auswertung und steht bewusst noch aus, statt hier eine
 * Zuweisungs-Rechnung weiterzuschleppen, die nichts mehr misst.
 */
type WarnableResource = 'ram' | 'disk';

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
 * RAM wird gegen die laufenden Server gemessen, Speicherplatz gegen alle
 * Server – ein gestoppter Server gibt seinen Datenordner nicht frei.
 */
export function evaluateNodeWarnings(input: NodeWarningInput): ResourceLowEvent[] {
  return buildWarnings(
    [
      { resource: 'ram', used: input.usage.runningRamMb, total: input.total.ramMb },
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
   * `null` heißt „das Spiel bzw. der Agent liefert diesen Wert nicht" – dafür
   * gibt es dann auch keine Warnung.
   */
  readonly usedRamMb: number | null;
  readonly usedDiskMb: number | null;
  /** Schwellwert in Prozent (`RESOURCE_WARN_SERVER_PERCENT`). */
  readonly thresholdPercent: number;
  readonly at?: Date;
}

/**
 * Ein gemessener Server, wie die periodische Auswertung ihn geliefert bekommt.
 *
 * Eigener Typ neben {@link ServerWarningInput}: Dort steht ein vollständiger
 * Prüfauftrag **samt** Schwellwert, hier nur der Messwert. Den Schwellwert
 * kennt die Messstelle (B3) nicht – er kommt aus der Konfiguration und wird
 * erst im Ressourcen-Dienst dazugelegt.
 *
 * Ein CPU-Wert steht hier nicht mehr: Ohne Zuweisung gibt es keine Bezugsgröße
 * je Server, gegen die sich „knapp" messen liesse (siehe
 * {@link WarnableResource}).
 */
export interface ServerLoadSnapshot {
  readonly serverId: string;
  readonly nodeId: string;
  /**
   * Besitzer des Servers – Empfänger der Warnung (B6).
   *
   * Anders als bei der Node-Ebene gibt es hier einen: Eine Node gehört
   * niemandem, ein Server schon. Für die Schwellwertrechnung ist das Feld
   * bedeutungslos, für die Zustellung ist es der ganze Punkt.
   */
  readonly ownerId: string;
  readonly limits: ServerResourceLimits;
  readonly usedRamMb: number | null;
  readonly usedDiskMb: number | null;
}

/** Warnungen auf Server-Ebene: Verbrauch gegen das eigene Limit des Servers. */
export function evaluateServerWarnings(input: ServerWarningInput): ResourceLowEvent[] {
  const candidates: WarningCandidate[] = [];

  if (input.usedRamMb !== null) {
    candidates.push({ resource: 'ram', used: input.usedRamMb, total: input.limits.ramMb });
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
