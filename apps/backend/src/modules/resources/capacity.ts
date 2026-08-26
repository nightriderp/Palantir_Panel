/**
 * Kapazitätsprüfung vor jedem Serverstart (Pflichtenheft §10, Lastenheft §3.4).
 *
 * **Beide Prüfungen greifen, nicht nur eine:**
 *
 * 1. das optionale Kontingent des Nutzers – jedes seiner vier Felder ist einzeln
 *    abschaltbar (`null` = kein Limit);
 * 2. die harte, globale Kapazität der Ziel-Node – unabhängig davon, ob das
 *    Nutzer-Kontingent noch Luft hätte. Eine volle Node lehnt auch einen Nutzer
 *    ohne jedes Kontingent ab.
 *
 * Diese Datei kennt bewusst weder Datenbank noch HTTP und rechnet nur auf
 * übergebenen Werten – sie ist damit vollständig ohne Infrastruktur testbar
 * (CLAUDE.md §4, analog zu `rbac/permissions.ts`).
 *
 * **Zählweise der Belegung:** `used` ist stets die Belegung **ohne** den zu
 * prüfenden Server. Wer einen bereits angelegten Server startet, muss dessen
 * Anteil aus der Belegung herausrechnen (`excludeServerId` in
 * {@link ServerUsageRepository}), sonst zählt sein Speicherplatz doppelt.
 */

import {
  type CapacityCheckResult,
  type CapacityScope,
  type CapacityViolation,
  type NodeResourceUsage,
  type NodeResources,
  type RequestedServerResources,
  type ResourceKind,
  type ResourceLowEvent,
  type ResourceWarningThresholds,
  type UserResourceLimits,
  type UserResourceUsage,
  unitForResource,
} from '@palantir/contracts';
import { evaluateNodeWarnings } from './thresholds.js';

/**
 * Toleranz beim Vergleich von CPU-Anteilen.
 *
 * CPU-Kontingente sind Fließkommazahlen (z. B. 1.5 Kerne). `0.1 + 0.2 > 0.3`
 * ist in IEEE-754 wahr – ohne Toleranz würde ein exakt ausgeschöpftes
 * Kontingent gelegentlich fälschlich als überschritten gelten.
 */
const FLOAT_TOLERANCE = 1e-9;

/** Zustand der Ziel-Node zum Zeitpunkt der Prüfung. */
export interface NodeCapacitySnapshot {
  readonly nodeId: string;
  /** `HostNode.totalResources` – die nutzbaren Werte der VM, nicht der Hardware darunter. */
  readonly total: NodeResources;
  /** Belegung durch alle Server aller Nutzer, ohne den zu prüfenden Server. */
  readonly usage: NodeResourceUsage;
}

export interface CapacityCheckInput {
  /** Die Limits, mit denen der Server starten soll (`GameServer.resourceLimits`). */
  readonly requested: RequestedServerResources;
  /** Kontingent des Besitzers; `NO_USER_RESOURCE_LIMITS`, wenn keines gesetzt ist. */
  readonly userLimits: UserResourceLimits;
  /** Belegung durch die übrigen Server des Besitzers. */
  readonly userUsage: UserResourceUsage;
  readonly node: NodeCapacitySnapshot;
  readonly thresholds: ResourceWarningThresholds;
  /** Zeitstempel für die Warn-Nutzlasten – injizierbar, damit Tests nicht von der Uhr abhängen. */
  readonly at?: Date;
}

/** Überschritten ist eine Grenze erst, wenn `used + requested` echt größer ist – Gleichstand ist erlaubt. */
function exceeds(used: number, requested: number, limit: number): boolean {
  return used + requested > limit + FLOAT_TOLERANCE;
}

function toViolation(
  scope: CapacityScope,
  resource: ResourceKind,
  limit: number,
  used: number,
  requested: number,
): CapacityViolation {
  return { scope, resource, unit: unitForResource(resource), limit, used, requested };
}

/**
 * Beide Prüfungen aus Pflichtenheft §10.
 *
 * Es wird nicht beim ersten Treffer abgebrochen: die Antwort nennt **alle**
 * überschrittenen Grenzen, damit der Betreiber nicht nach jeder Anpassung
 * erneut in dieselbe Ablehnung läuft.
 *
 * Warnungen entstehen nur, wenn der Start erlaubt ist. Sie beschreiben die
 * Auslastung der Node **nach** diesem Start – eine Warnung zu einem Start, der
 * gar nicht stattfindet, wäre irreführend.
 */
export function checkCapacity(input: CapacityCheckInput): CapacityCheckResult {
  const { node, requested, thresholds, userLimits, userUsage } = input;
  const violations: CapacityViolation[] = [];

  // --- 1. Nutzer-Kontingent (optional, je Feld abschaltbar) -----------------
  if (
    userLimits.maxRamMb !== null &&
    exceeds(userUsage.runningRamMb, requested.ramMb, userLimits.maxRamMb)
  ) {
    violations.push(
      toViolation('user', 'ram', userLimits.maxRamMb, userUsage.runningRamMb, requested.ramMb),
    );
  }

  if (
    userLimits.maxCpuCores !== null &&
    exceeds(userUsage.runningCpuCores, requested.cpuCores, userLimits.maxCpuCores)
  ) {
    violations.push(
      toViolation(
        'user',
        'cpu',
        userLimits.maxCpuCores,
        userUsage.runningCpuCores,
        requested.cpuCores,
      ),
    );
  }

  // Speicherplatz zählt über alle Server des Nutzers – auch gestoppte belegen ihn.
  if (
    userLimits.maxDiskMb !== null &&
    exceeds(userUsage.allocatedDiskMb, requested.diskMb, userLimits.maxDiskMb)
  ) {
    violations.push(
      toViolation(
        'user',
        'disk',
        userLimits.maxDiskMb,
        userUsage.allocatedDiskMb,
        requested.diskMb,
      ),
    );
  }

  if (
    userLimits.maxConcurrentServers !== null &&
    exceeds(userUsage.runningServers, 1, userLimits.maxConcurrentServers)
  ) {
    violations.push(
      toViolation('user', 'servers', userLimits.maxConcurrentServers, userUsage.runningServers, 1),
    );
  }

  // --- 2. Harte Node-Kapazität (immer, unabhängig vom Kontingent) ----------
  if (exceeds(node.usage.runningRamMb, requested.ramMb, node.total.ramMb)) {
    violations.push(
      toViolation('node', 'ram', node.total.ramMb, node.usage.runningRamMb, requested.ramMb),
    );
  }

  if (exceeds(node.usage.runningCpuCores, requested.cpuCores, node.total.cpuCores)) {
    violations.push(
      toViolation(
        'node',
        'cpu',
        node.total.cpuCores,
        node.usage.runningCpuCores,
        requested.cpuCores,
      ),
    );
  }

  if (exceeds(node.usage.allocatedDiskMb, requested.diskMb, node.total.diskMb)) {
    violations.push(
      toViolation('node', 'disk', node.total.diskMb, node.usage.allocatedDiskMb, requested.diskMb),
    );
  }

  const allowed = violations.length === 0;
  const warnings: ResourceLowEvent[] = allowed
    ? evaluateNodeWarnings({
        nodeId: node.nodeId,
        total: node.total,
        usage: projectUsageAfterStart(node.usage, requested),
        thresholdPercent: thresholds.nodePercent,
        ...(input.at ? { at: input.at } : {}),
      })
    : [];

  return { allowed, violations, warnings };
}

/** Belegung der Node, wie sie nach dem geprüften Start aussähe. */
function projectUsageAfterStart(
  usage: NodeResourceUsage,
  requested: RequestedServerResources,
): NodeResourceUsage {
  return {
    runningRamMb: usage.runningRamMb + requested.ramMb,
    runningCpuCores: usage.runningCpuCores + requested.cpuCores,
    allocatedDiskMb: usage.allocatedDiskMb + requested.diskMb,
    runningServers: usage.runningServers + 1,
    totalServers: usage.totalServers + 1,
  };
}
