/**
 * B4 – Ressourcen & Kapazität (Pflichtenheft §10, Lastenheft §3.4, STRUKTUR.md).
 *
 * Öffentliche Schnittstelle des Moduls für alle anderen Backend-Pakete:
 *
 * - `checkCapacity()` – die beiden Prüfungen aus Pflichtenheft §10 als reine
 *   Funktion (Nutzer-Kontingent **und** harte Node-Kapazität)
 * - `createResourceService()` – dieselbe Prüfung mit Datenbank-Anbindung
 *   (`assertStartCapacity()` für B3) sowie Lesen/Setzen/Aufheben der
 *   Nutzer-Kontingente durch einen Admin
 * - `evaluateNodeWarnings()` / `evaluateServerWarnings()` – Nutzlasten des
 *   Events `resource.low` (Konsument: B6)
 * - `ResourceError` – Ablehnung mit `RESOURCE_LIMIT_EXCEEDED` aus dem
 *   Fehlerkatalog
 *
 * **Für B3 (Server-Orchestrierung):** Vor jedem `START` genügt ein Aufruf von
 * `assertStartCapacity()`. Eine eigene Prüfung gehört dort nicht hin – die
 * Regeln aus §10 sollen an genau einer Stelle stehen. B3 reicht beim Bau des
 * Service seine Umsetzung von `ServerUsageRepository` herein, weil die Belegung
 * über die Tabelle `game_servers` gezählt wird (siehe `ports.ts`).
 *
 * Die Datenstrukturen selbst stehen in `@palantir/contracts`, damit Backend,
 * Frontend und Agent dieselben Typen sehen (CLAUDE.md §3).
 */

import { getDb } from '../../db/index.js';
import { resourceWarningThresholdsFromEnv } from './config.js';
import {
  createDrizzleHostNodeRepository,
  createDrizzleUserResourceLimitRepository,
  createEmptyServerUsageRepository,
} from './repository.js';
import { type ResourceService, createResourceService } from './service.js';
import type { ServerUsageRepository } from './ports.js';

export { ResourceError, describeViolations, isResourceError } from './errors.js';

export { type CapacityCheckInput, type NodeCapacitySnapshot, checkCapacity } from './capacity.js';

export {
  type NodeWarningInput,
  type ServerWarningInput,
  evaluateNodeWarnings,
  evaluateServerWarnings,
  usedPercent,
} from './thresholds.js';

export {
  type HostNodeRecord,
  type HostNodeRepository,
  type ServerUsageRepository,
  type UsageQueryOptions,
  type UserResourceLimitRecord,
  type UserResourceLimitRepository,
} from './ports.js';

export {
  type ResourceService,
  type ResourceServiceDependencies,
  type StartCapacityRequest,
  computeUserResourceLimitPermissions,
  createResourceService,
} from './service.js';

export {
  createDrizzleHostNodeRepository,
  createDrizzleUserResourceLimitRepository,
  createEmptyServerUsageRepository,
} from './repository.js';

export { resourceWarningThresholdsFromEnv } from './config.js';

/**
 * Fertig verdrahteter Service auf der gemeinsamen Drizzle-Instanz.
 *
 * `usage` muss von außen kommen: die Belegung wird über die Tabelle
 * `game_servers` gezählt, die zu B3 gehört. Ohne Angabe wird die leere
 * Umsetzung genutzt – dann prüft der Service korrekt gegen die vollen
 * Node-Ressourcen, kennt aber keine bereits laufenden Server. Sobald B3 steht,
 * gehört dessen Repository hier hinein.
 */
export function buildResourceService(usage?: ServerUsageRepository): ResourceService {
  const db = getDb();

  return createResourceService({
    limits: createDrizzleUserResourceLimitRepository(db),
    nodes: createDrizzleHostNodeRepository(db),
    usage: usage ?? createEmptyServerUsageRepository(),
    thresholds: resourceWarningThresholdsFromEnv(),
  });
}
