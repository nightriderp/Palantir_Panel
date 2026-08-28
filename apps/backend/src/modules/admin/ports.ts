/**
 * Verwaltung des öffentlichen Port-Bereichs auf der VPS (Lastenheft §3.7,
 * Pflichtenheft §2.4).
 *
 * Zwei getrennte Ebenen:
 * - Der **Admin** pflegt die Bereiche, aus denen vergeben werden darf.
 * - Die **Zuordnung Port ↔ Zielserver** entsteht und verschwindet automatisch
 *   mit dem Server. Dafür sind `allocateForServer()` und `releaseForServer()`
 *   da – gedacht für B3 (Server-Orchestrierung), nicht für die Oberfläche.
 *
 * Deshalb ist `permissions.canRelease` an einer Zuordnung nur dann wahr, wenn
 * kein Server mehr daran hängt: Ein von Hand freigegebener Port eines laufenden
 * Servers würde dessen Adresse ins Leere zeigen lassen.
 */

import {
  MAX_PUBLIC_PORT,
  MIN_PUBLIC_PORT,
  type PortAllocationDto,
  type PortAllocationPermissions,
  type PortPoolDto,
  type PortProtocol,
  type PortRangeDto,
  type PortRangePermissions,
} from '@palantir/contracts';
import type { CreatePortRangeInput, UpdatePortRangeInput } from '@palantir/validation';
import { type PermissionActor, computePermissionFlags, hasPermission } from '../rbac/index.js';
import { type AuditService, entryFor } from './audit.js';
import type { AdminContext } from './context.js';
import { AdminError } from './errors.js';

export interface PortRangeRecord {
  readonly id: string;
  readonly label: string;
  readonly startPort: number;
  readonly endPort: number;
  readonly protocol: PortProtocol;
  readonly nodeId: string | null;
  readonly enabled: boolean;
  readonly createdAt: Date;
}

export interface PortAllocationRecord {
  readonly id: string;
  readonly rangeId: string;
  readonly port: number;
  readonly protocol: PortProtocol;
  readonly serverId: string | null;
  readonly allocatedAt: Date;
}

export interface CreatePortRangeData {
  readonly label: string;
  readonly startPort: number;
  readonly endPort: number;
  readonly protocol: PortProtocol;
  readonly nodeId: string | null;
  readonly enabled: boolean;
}

export interface UpdatePortRangeData {
  readonly label?: string;
  readonly startPort?: number;
  readonly endPort?: number;
  readonly enabled?: boolean;
}

export interface PortPoolRepository {
  listRanges(): Promise<PortRangeRecord[]>;
  findRangeById(id: string): Promise<PortRangeRecord | null>;
  createRange(data: CreatePortRangeData): Promise<PortRangeRecord>;
  updateRange(id: string, data: UpdatePortRangeData): Promise<PortRangeRecord>;
  removeRange(id: string): Promise<void>;
  listAllocations(): Promise<PortAllocationRecord[]>;
  findAllocationById(id: string): Promise<PortAllocationRecord | null>;
  /** Legt die Zuordnung an. Der Unique-Index auf (Port, Protokoll) ist die letzte Instanz. */
  insertAllocation(data: {
    rangeId: string;
    port: number;
    protocol: PortProtocol;
    serverId: string | null;
  }): Promise<PortAllocationRecord>;
  removeAllocation(id: string): Promise<void>;
  removeAllocationsForServer(serverId: string): Promise<number>;
}

/** Zwei Bereiche desselben Protokolls dürfen sich nicht überlappen. */
export function rangesOverlap(
  a: PortRangeRecord,
  b: CreatePortRangeData | PortRangeRecord,
): boolean {
  if (a.protocol !== b.protocol) {
    return false;
  }

  return a.startPort <= b.endPort && b.startPort <= a.endPort;
}

export function computePortRangePermissions(
  actor: PermissionActor,
  allocatedPorts: number,
): PortRangePermissions {
  const canManage = hasPermission(actor, 'address.manage');

  return computePermissionFlags<keyof PortRangePermissions>(actor, {
    canView: 'address.manage',
    canEdit: canManage,
    // Solange Ports vergeben sind, verlöre ein Löschen laufenden Servern ihre Adresse.
    canDelete: canManage && allocatedPorts === 0,
  });
}

export function computePortAllocationPermissions(
  actor: PermissionActor,
  allocation: { readonly serverId: string | null },
): PortAllocationPermissions {
  const canManage = hasPermission(actor, 'address.manage');

  return computePermissionFlags<keyof PortAllocationPermissions>(actor, {
    canView: 'address.manage',
    // Nur verwaiste Zuordnungen (kein Server mehr dahinter) sind von Hand freigebbar.
    canRelease: canManage && allocation.serverId === null,
  });
}

/** Was ein Server an Ports braucht (Aufruf aus B3). */
export interface PortRequest {
  readonly protocol: PortProtocol;
  readonly count: number;
  /** Node, auf der der Server liegt – begrenzt die Auswahl auf passende Bereiche. */
  readonly nodeId?: string | null;
}

export interface PortPoolService {
  getPool(ctx: AdminContext): Promise<PortPoolDto>;
  createRange(ctx: AdminContext, input: CreatePortRangeInput): Promise<PortRangeDto>;
  updateRange(
    ctx: AdminContext,
    rangeId: string,
    input: UpdatePortRangeInput,
  ): Promise<PortRangeDto>;
  removeRange(ctx: AdminContext, rangeId: string): Promise<void>;
  listAllocations(ctx: AdminContext): Promise<PortAllocationDto[]>;
  /** Verwaiste Zuordnung von Hand freigeben. */
  releaseAllocation(ctx: AdminContext, allocationId: string): Promise<void>;
  /**
   * Ports für einen neuen Server vergeben (Pflichtenheft §2.4).
   *
   * Ohne Aufrufkontext: Der Aufruf gehört zur Server-Erstellung, deren
   * Berechtigung an anderer Stelle bereits geprüft ist. Protokolliert wird der
   * Vorgang trotzdem – mit dem Server als Ziel.
   */
  allocateForServer(
    serverId: string,
    requests: readonly PortRequest[],
  ): Promise<PortAllocationRecord[]>;
  /** Alle Ports eines Servers wieder freigeben; liefert die Anzahl. */
  releaseForServer(serverId: string): Promise<number>;
}

export interface PortPoolServiceDependencies {
  readonly repository: PortPoolRepository;
  readonly audit: AuditService;
  /** Anzeigenamen der Server für die Übersicht; ohne Angabe bleibt `serverName` leer. */
  readonly serverNames?: () => Promise<ReadonlyMap<string, string>>;
}

function requireAddressManage(actor: PermissionActor): void {
  if (!hasPermission(actor, 'address.manage')) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

function countPorts(range: { startPort: number; endPort: number }): number {
  return range.endPort - range.startPort + 1;
}

/**
 * Erkennt eine Unique-Verletzung von PostgreSQL (`SQLSTATE 23505`) – hier die
 * Kollision zweier paralleler Vergaben auf demselben Port/Protokoll über den
 * Index `port_allocations_port_protocol_idx`. `pg` legt den SQLSTATE als
 * `code`-Feld auf den Fehler.
 */
function isPortConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

/** Niedrigster freier Port über alle passenden Bereiche hinweg. */
function findFreePort(
  ranges: readonly PortRangeRecord[],
  taken: ReadonlySet<number>,
): { rangeId: string; port: number } | null {
  for (const range of ranges) {
    for (let port = range.startPort; port <= range.endPort; port += 1) {
      if (!taken.has(port)) {
        return { rangeId: range.id, port };
      }
    }
  }

  return null;
}

export function createPortPoolService(deps: PortPoolServiceDependencies): PortPoolService {
  async function requireRange(rangeId: string): Promise<PortRangeRecord> {
    const range = await deps.repository.findRangeById(rangeId);

    if (!range) {
      throw new AdminError('PORT_RANGE_NOT_FOUND');
    }

    return range;
  }

  /** Zuordnungen je Bereich – wird an mehreren Stellen gebraucht. */
  async function allocationsByRange(): Promise<Map<string, PortAllocationRecord[]>> {
    const allocations = await deps.repository.listAllocations();
    const byRange = new Map<string, PortAllocationRecord[]>();

    for (const allocation of allocations) {
      const list = byRange.get(allocation.rangeId);

      if (list) {
        list.push(allocation);
      } else {
        byRange.set(allocation.rangeId, [allocation]);
      }
    }

    return byRange;
  }

  function toRangeDto(
    actor: PermissionActor,
    range: PortRangeRecord,
    allocatedPorts: number,
  ): PortRangeDto {
    const total = countPorts(range);

    return {
      id: range.id,
      label: range.label,
      startPort: range.startPort,
      endPort: range.endPort,
      protocol: range.protocol,
      nodeId: range.nodeId,
      enabled: range.enabled,
      totalPorts: total,
      allocatedPorts,
      availablePorts: Math.max(0, total - allocatedPorts),
      createdAt: range.createdAt.toISOString(),
      permissions: computePortRangePermissions(actor, allocatedPorts),
    };
  }

  async function ensureNoOverlap(
    candidate: CreatePortRangeData,
    ignoreRangeId?: string,
  ): Promise<void> {
    const ranges = await deps.repository.listRanges();

    for (const range of ranges) {
      if (range.id === ignoreRangeId) {
        continue;
      }

      if (rangesOverlap(range, candidate)) {
        throw new AdminError('PORT_RANGE_OVERLAP');
      }
    }
  }

  function ensureValidBounds(startPort: number, endPort: number): void {
    if (
      !Number.isInteger(startPort) ||
      !Number.isInteger(endPort) ||
      startPort > endPort ||
      startPort < MIN_PUBLIC_PORT ||
      endPort > MAX_PUBLIC_PORT
    ) {
      throw new AdminError('PORT_RANGE_INVALID');
    }
  }

  return {
    async getPool(ctx) {
      requireAddressManage(ctx.actor);

      const [ranges, byRange] = await Promise.all([
        deps.repository.listRanges(),
        allocationsByRange(),
      ]);

      const rangeDtos = ranges
        .slice()
        .sort((a, b) => a.startPort - b.startPort)
        .map((range) => toRangeDto(ctx.actor, range, byRange.get(range.id)?.length ?? 0));

      return {
        totalPorts: rangeDtos.reduce((sum, range) => sum + range.totalPorts, 0),
        allocatedPorts: rangeDtos.reduce((sum, range) => sum + range.allocatedPorts, 0),
        availablePorts: rangeDtos.reduce((sum, range) => sum + range.availablePorts, 0),
        ranges: rangeDtos,
      };
    },

    async createRange(ctx, input) {
      requireAddressManage(ctx.actor);
      ensureValidBounds(input.startPort, input.endPort);

      const data: CreatePortRangeData = {
        label: input.label,
        startPort: input.startPort,
        endPort: input.endPort,
        protocol: input.protocol,
        nodeId: input.nodeId ?? null,
        enabled: input.enabled,
      };

      await ensureNoOverlap(data);

      const range = await deps.repository.createRange(data);

      await deps.audit.record(
        entryFor(ctx, {
          action: 'address.rangeCreated',
          targetType: 'portRange',
          targetId: range.id,
          metadata: {
            label: range.label,
            startPort: range.startPort,
            endPort: range.endPort,
            protocol: range.protocol,
          },
        }),
      );

      return toRangeDto(ctx.actor, range, 0);
    },

    async updateRange(ctx, rangeId, input) {
      requireAddressManage(ctx.actor);

      const range = await requireRange(rangeId);
      const startPort = input.startPort ?? range.startPort;
      const endPort = input.endPort ?? range.endPort;

      ensureValidBounds(startPort, endPort);

      const allocations = (await allocationsByRange()).get(range.id) ?? [];

      if (startPort !== range.startPort || endPort !== range.endPort) {
        await ensureNoOverlap(
          {
            label: input.label ?? range.label,
            startPort,
            endPort,
            protocol: range.protocol,
            nodeId: range.nodeId,
            enabled: input.enabled ?? range.enabled,
          },
          range.id,
        );

        // Ein Verkleinern darf keinen bereits vergebenen Port aus dem Bereich
        // fallen lassen – der Server behielte sonst eine Adresse, die zu keinem
        // Bereich mehr gehört.
        const dropsAllocatedPort = allocations.some(
          (allocation) => allocation.port < startPort || allocation.port > endPort,
        );

        if (dropsAllocatedPort) {
          throw new AdminError('PORT_RANGE_IN_USE');
        }
      }

      const updated = await deps.repository.updateRange(range.id, {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.startPort !== undefined ? { startPort: input.startPort } : {}),
        ...(input.endPort !== undefined ? { endPort: input.endPort } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      });

      await deps.audit.record(
        entryFor(ctx, {
          action: 'address.rangeUpdated',
          targetType: 'portRange',
          targetId: range.id,
          metadata: { changed: Object.keys(input) },
        }),
      );

      return toRangeDto(ctx.actor, updated, allocations.length);
    },

    async removeRange(ctx, rangeId) {
      requireAddressManage(ctx.actor);

      const range = await requireRange(rangeId);
      const allocations = (await allocationsByRange()).get(range.id) ?? [];

      if (allocations.length > 0) {
        throw new AdminError('PORT_RANGE_IN_USE');
      }

      await deps.repository.removeRange(range.id);
      await deps.audit.record(
        entryFor(ctx, {
          action: 'address.rangeDeleted',
          targetType: 'portRange',
          targetId: range.id,
          metadata: { label: range.label },
        }),
      );
    },

    async listAllocations(ctx) {
      requireAddressManage(ctx.actor);

      const [allocations, names] = await Promise.all([
        deps.repository.listAllocations(),
        deps.serverNames?.() ?? Promise.resolve(new Map<string, string>()),
      ]);

      return allocations
        .slice()
        .sort((a, b) => a.port - b.port)
        .map((allocation) => ({
          id: allocation.id,
          port: allocation.port,
          protocol: allocation.protocol,
          rangeId: allocation.rangeId,
          serverId: allocation.serverId,
          serverName: allocation.serverId ? (names.get(allocation.serverId) ?? null) : null,
          allocatedAt: allocation.allocatedAt.toISOString(),
          permissions: computePortAllocationPermissions(ctx.actor, allocation),
        }));
    },

    async releaseAllocation(ctx, allocationId) {
      requireAddressManage(ctx.actor);

      const allocation = await deps.repository.findAllocationById(allocationId);

      if (!allocation) {
        throw new AdminError('PORT_ALLOCATION_NOT_FOUND');
      }

      if (allocation.serverId !== null) {
        // Ports werden mit dem Server vergeben und mit ihm frei – nicht von Hand.
        throw new AdminError('PORT_RANGE_IN_USE');
      }

      await deps.repository.removeAllocation(allocation.id);
      await deps.audit.record(
        entryFor(ctx, {
          action: 'address.portReleased',
          targetType: 'portAllocation',
          targetId: allocation.id,
          metadata: { port: allocation.port, protocol: allocation.protocol, orphaned: true },
        }),
      );
    },

    async allocateForServer(serverId, requests) {
      const [ranges, byRange] = await Promise.all([
        deps.repository.listRanges(),
        allocationsByRange(),
      ]);

      // Belegte Ports je Protokoll, damit die Suche nicht je Anfrage erneut lädt.
      const takenByProtocol = new Map<PortProtocol, Set<number>>();

      for (const allocations of byRange.values()) {
        for (const allocation of allocations) {
          const taken = takenByProtocol.get(allocation.protocol) ?? new Set<number>();
          taken.add(allocation.port);
          takenByProtocol.set(allocation.protocol, taken);
        }
      }

      const created: PortAllocationRecord[] = [];

      try {
        for (const request of requests) {
          const usable = ranges
            .filter((range) => range.enabled && range.protocol === request.protocol)
            .filter(
              (range) =>
                range.nodeId === null ||
                request.nodeId === undefined ||
                request.nodeId === null ||
                range.nodeId === request.nodeId,
            )
            .sort((a, b) => a.startPort - b.startPort);

          const taken = takenByProtocol.get(request.protocol) ?? new Set<number>();
          takenByProtocol.set(request.protocol, taken);

          for (let index = 0; index < request.count; index += 1) {
            // Der in-memory berechnete freie Port kann zwischen Auswahl und Insert
            // von einer parallelen Vergabe belegt worden sein. Der Unique-Index
            // `port_allocations_port_protocol_idx` fängt das DB-seitig ab; hier gilt
            // der Port dann als belegt und der nächste freie wird versucht – statt
            // den rohen DB-Fehler als HTTP 500 durchzureichen. Die Schleife
            // terminiert, weil jeder Fehlversuch `taken` wachsen lässt und
            // `findFreePort` irgendwann nichts Freies mehr findet.
            let inserted: PortAllocationRecord | null = null;

            while (inserted === null) {
              const found = findFreePort(usable, taken);

              if (!found) {
                throw new AdminError('PORT_POOL_EXHAUSTED');
              }

              taken.add(found.port);

              try {
                inserted = await deps.repository.insertAllocation({
                  rangeId: found.rangeId,
                  port: found.port,
                  protocol: request.protocol,
                  serverId,
                });
              } catch (error) {
                if (isPortConflict(error)) {
                  // Rennen um diesen Port verloren – nächsten freien versuchen.
                  continue;
                }
                throw error;
              }
            }

            created.push(inserted);
          }
        }
      } catch (error) {
        // Scheitert die Vergabe nach bereits eingefügten Ports, werden diese
        // wieder freigegeben – ein halb vergebener Satz hinterließe sonst
        // verwaiste Zuordnungen ohne lauffähigen Server.
        for (const allocation of created) {
          try {
            await deps.repository.removeAllocation(allocation.id);
          } catch {
            // Beste Bemühung: der Aufräumfehler darf den eigentlichen Fehler
            // nicht verdecken.
          }
        }
        throw error;
      }

      if (created.length > 0) {
        await deps.audit.record({
          action: 'address.portAllocated',
          actorId: null,
          targetType: 'server',
          targetId: serverId,
          metadata: {
            ports: created.map((allocation) => ({
              port: allocation.port,
              protocol: allocation.protocol,
            })),
          },
        });
      }

      return created;
    },

    async releaseForServer(serverId) {
      const removed = await deps.repository.removeAllocationsForServer(serverId);

      if (removed > 0) {
        await deps.audit.record({
          action: 'address.portReleased',
          actorId: null,
          targetType: 'server',
          targetId: serverId,
          metadata: { releasedPorts: removed },
        });
      }

      return removed;
    },
  };
}
