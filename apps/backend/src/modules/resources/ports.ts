/**
 * Datenzugriffe, die das Ressourcen-Modul braucht – als Schnittstellen.
 *
 * Analog zum `ContainerRuntime`-Interface des Agents: die fachlichen Regeln in
 * `capacity.ts` und `service.ts` bleiben dadurch ohne laufende Datenbank
 * testbar (CLAUDE.md §4).
 *
 * Zwei der drei Schnittstellen bedient dieses Paket selbst (Drizzle-Umsetzung in
 * `repository.ts`). {@link ServerUsageRepository} bleibt bewusst offen:
 * Sie zählt über die Tabelle `game_servers`, die zum Arbeitspaket B3 gehört und
 * noch nicht existiert. B3 reicht seine Umsetzung beim Bau des Service herein –
 * so entsteht dort **keine** zweite Kapazitätsprüfung, und B4 legt keine
 * Parallelstruktur zu B3s Server-Tabelle an.
 */

import {
  type HostNodeStatus,
  type NodeResourceUsage,
  type NodeResources,
  type UserResourceLimits,
  type UserResourceUsage,
} from '@palantir/contracts';

/** Node, wie sie in der Datenbank steht (Entität `HostNode`, Pflichtenheft §6). */
export interface HostNodeRecord {
  readonly id: string;
  readonly name: string;
  readonly wireguardIp: string;
  readonly status: HostNodeStatus;
  readonly totalResources: NodeResources;
}

export interface HostNodeRepository {
  findById(nodeId: string): Promise<HostNodeRecord | null>;
  listAll(): Promise<HostNodeRecord[]>;
}

/**
 * Kontingent eines Nutzers samt Anzeigename.
 *
 * `updatedAt` ist `null`, solange nie ein Kontingent gesetzt wurde – dann
 * stehen in `limits` die Standardwerte `NO_USER_RESOURCE_LIMITS`.
 */
export interface UserResourceLimitRecord {
  readonly userId: string;
  readonly userDisplayName: string;
  readonly limits: UserResourceLimits;
  readonly updatedAt: Date | null;
}

export interface UserResourceLimitRepository {
  /**
   * Kontingent eines Nutzers. Gibt `null` zurück, wenn das **Konto** nicht
   * existiert – ein Konto ohne Kontingent-Datensatz liefert dagegen einen
   * Datensatz mit `NO_USER_RESOURCE_LIMITS`.
   */
  findByUserId(userId: string): Promise<UserResourceLimitRecord | null>;
  /** Kontingent setzen oder ersetzen. Der Aufrufer hat den Nutzer bereits geprüft. */
  upsert(userId: string, limits: UserResourceLimits): Promise<UserResourceLimitRecord | null>;
  /** Kontingent vollständig entfernen – danach gilt für den Nutzer kein Limit mehr. */
  remove(userId: string): Promise<void>;
}

/** Einschränkungen einer Belegungsabfrage. */
export interface UsageQueryOptions {
  /**
   * Server, der bei der Zählung ausgelassen wird.
   *
   * Zwingend beim Start eines bereits angelegten Servers: sein Datenordner
   * steckt schon in der Belegung und würde sonst doppelt zählen
   * (siehe Kopfkommentar in `capacity.ts`).
   */
  readonly excludeServerId?: string;
}

/**
 * Belegung durch Gameserver – Umsetzung liefert B3 (Tabelle `game_servers`).
 *
 * Zählweise, an die sich jede Umsetzung halten muss:
 * - `running*`: nur Server im Zustand `running` bzw. `starting` – sie belegen
 *   RAM und CPU tatsächlich.
 * - `allocatedDiskMb`: **alle** Server, unabhängig vom Zustand – der Datenordner
 *   bleibt auch im gestoppten Zustand liegen.
 */
export interface ServerUsageRepository {
  usageForUser(userId: string, options?: UsageQueryOptions): Promise<UserResourceUsage>;
  usageForNode(nodeId: string, options?: UsageQueryOptions): Promise<NodeResourceUsage>;
}
