/**
 * Attrappen für die Tests des Admin-Moduls.
 *
 * Alle Regeln dieses Moduls sind ohne laufende PostgreSQL-Instanz prüfbar
 * (CLAUDE.md §4) – genau dafür stehen die Repositories hinter Schnittstellen.
 *
 * Die Datei liegt bewusst neben dem Modul und nicht in einem `__mocks__`-Ordner:
 * Sie gehört zum Modul und ändert sich mit ihm.
 */

import type { AgentStorageEntry, Permission } from '@palantir/contracts';
import type { AuditLogQuery } from '@palantir/validation';
import {
  type PermissionActor,
  type RoleRecord,
  type RoleRepository,
  buildPermissionActor,
  createRoleService,
} from '../rbac/index.js';
import type {
  AppendAuditEntry,
  AuditArchiveRepository,
  AuditEntryRecord,
  AuditLogRepository,
  AuditService,
} from './audit.js';
import { type AdminContext, contextOf } from './context.js';
import type { HostNodeRecord, HostNodeRepository } from './nodes.js';
import type { PortAllocationRecord, PortPoolRepository, PortRangeRecord } from './ports.js';
import { type RoleAdminService, createRoleAdminService } from './roles.js';
import type { StorageRepository, StorageSnapshotRecord } from './storage.js';

export const NODE_ID = '11111111-1111-4111-8111-111111111111';
export const SERVER_ID = '22222222-2222-4222-8222-222222222222';
export const USER_ID = '33333333-3333-4333-8333-333333333333';
// Rollen-Ids sind echte UUIDs: Die Routen prüfen den Pfadparameter gegen
// `idSchema`, ein Platzhalter wie „role-1" käme dort nie durch.
export const ROLE_ID = '55555555-5555-4555-8555-555555555555';
export const GUEST_ROLE_ID = '66666666-6666-4666-8666-666666666666';

/** Handelnder mit genau den genannten Rechten. */
export function actorWith(
  ...permissions: Parameters<typeof buildPermissionActor>[0]['roles'][number]['grantedPermissions']
): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

export function ownerActor(): PermissionActor {
  return buildPermissionActor({ isOwner: true, roles: [] });
}

export function ctxWith(actor: PermissionActor): AdminContext {
  return contextOf(actor, { userId: USER_ID, displayName: 'Test-Admin', ipHint: '10.0.0.x' });
}

// ---------------------------------------------------------------------------
// Audit-Log
// ---------------------------------------------------------------------------

export interface FakeAuditRepository extends AuditLogRepository, AuditArchiveRepository {
  readonly rows: AuditEntryRecord[];
}

export function createFakeAuditRepository(seed: AuditEntryRecord[] = []): FakeAuditRepository {
  const rows: AuditEntryRecord[] = [...seed];
  let nextId = seed.length + 1;

  return {
    rows,

    async append(entry: AppendAuditEntry) {
      const record: AuditEntryRecord = {
        id: `audit-${nextId++}`,
        action: entry.action,
        actorId: entry.actorId ?? null,
        actorDisplayName: entry.actorDisplayName ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ipHint: entry.ipHint ?? null,
        metadata: entry.metadata ?? {},
        timestamp: new Date('2026-08-26T10:00:00.000Z'),
      };
      rows.push(record);

      return record;
    },

    async list(query: AuditLogQuery) {
      const matching = rows
        .filter((row) => (query.action ? row.action === query.action : true))
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return {
        entries: matching.slice(query.offset, query.offset + query.limit),
        total: matching.length,
      };
    },

    async listOlderThan(cutoff: Date) {
      return rows
        .filter((row) => row.timestamp < cutoff)
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    },

    async deleteOlderThan(cutoff: Date) {
      const remaining = rows.filter((row) => row.timestamp >= cutoff);
      const removed = rows.length - remaining.length;
      rows.splice(0, rows.length, ...remaining);

      return removed;
    },
  };
}

export function auditEntry(overrides: Partial<AuditEntryRecord> = {}): AuditEntryRecord {
  return {
    id: 'audit-0',
    action: 'user.approved',
    actorId: USER_ID,
    actorDisplayName: 'Test-Admin',
    targetType: 'user',
    targetId: USER_ID,
    ipHint: '10.0.0.x',
    metadata: {},
    timestamp: new Date('2026-08-26T10:00:00.000Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

export function nodeRecord(overrides: Partial<HostNodeRecord> = {}): HostNodeRecord {
  return {
    id: NODE_ID,
    name: 'Homeserver',
    wireguardIp: '10.10.0.2',
    totalResources: { ramMb: 32_768, cpuCores: 8, diskMb: 2_000_000 },
    status: 'online',
    statusMessage: null,
    lastSeenAt: new Date('2026-08-26T09:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createFakeHostNodeRepository(
  seed: HostNodeRecord[] = [],
): HostNodeRepository & { rows: HostNodeRecord[] } {
  const rows: HostNodeRecord[] = [...seed];
  /** Vergebene Agent-Token je Node, als Hash – wie in der Datenbank. */
  const tokenHashes = new Map<string, string>();
  let nextId = 1;

  return {
    rows,

    async listAll() {
      return [...rows];
    },

    async findByAgentTokenHash(hash) {
      for (const [nodeId, gespeichert] of tokenHashes) {
        if (gespeichert === hash) {
          return rows.find((row) => row.id === nodeId) ?? null;
        }
      }

      return null;
    },

    async setAgentTokenHash(id, hash) {
      tokenHashes.set(id, hash);
    },

    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },

    async findByNameOrIp(name, wireguardIp) {
      return (
        rows.find(
          (row) =>
            (name !== undefined && row.name.toLowerCase() === name.toLowerCase()) ||
            (wireguardIp !== undefined && row.wireguardIp === wireguardIp),
        ) ?? null
      );
    },

    async create(data) {
      const node = nodeRecord({
        id: `node-${nextId++}`,
        name: data.name,
        wireguardIp: data.wireguardIp,
        totalResources: data.totalResources,
        status: 'offline',
        lastSeenAt: null,
      });
      rows.push(node);

      return node;
    },

    async update(id, data) {
      const index = rows.findIndex((row) => row.id === id);
      const current = rows[index];

      if (!current) {
        throw new Error('Node nicht gefunden');
      }

      const updated: HostNodeRecord = { ...current, ...data };
      rows[index] = updated;

      return updated;
    },

    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);

      if (index >= 0) {
        rows.splice(index, 1);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Port-Pool
// ---------------------------------------------------------------------------

export function portRange(overrides: Partial<PortRangeRecord> = {}): PortRangeRecord {
  return {
    id: 'range-1',
    label: 'Standardbereich',
    startPort: 27_000,
    endPort: 27_002,
    protocol: 'udp',
    nodeId: null,
    enabled: true,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function createFakePortPoolRepository(
  seedRanges: PortRangeRecord[] = [],
  seedAllocations: PortAllocationRecord[] = [],
): PortPoolRepository & { ranges: PortRangeRecord[]; allocations: PortAllocationRecord[] } {
  const ranges: PortRangeRecord[] = [...seedRanges];
  const allocations: PortAllocationRecord[] = [...seedAllocations];
  let nextRangeId = seedRanges.length + 1;
  let nextAllocationId = seedAllocations.length + 1;

  return {
    ranges,
    allocations,

    async listRanges() {
      return [...ranges];
    },

    async findRangeById(id) {
      return ranges.find((range) => range.id === id) ?? null;
    },

    async createRange(data) {
      const range = portRange({ ...data, id: `range-${nextRangeId++}` });
      ranges.push(range);

      return range;
    },

    async updateRange(id, data) {
      const index = ranges.findIndex((range) => range.id === id);
      const current = ranges[index];

      if (!current) {
        throw new Error('Bereich nicht gefunden');
      }

      const updated: PortRangeRecord = { ...current, ...data };
      ranges[index] = updated;

      return updated;
    },

    async removeRange(id) {
      const index = ranges.findIndex((range) => range.id === id);

      if (index >= 0) {
        ranges.splice(index, 1);
      }
    },

    async listAllocations() {
      return [...allocations];
    },

    async findAllocationById(id) {
      return allocations.find((allocation) => allocation.id === id) ?? null;
    },

    async insertAllocation(data) {
      const duplicate = allocations.some(
        (allocation) => allocation.port === data.port && allocation.protocol === data.protocol,
      );

      if (duplicate) {
        // Entspricht dem Unique-Index in der Datenbank – inklusive des
        // PostgreSQL-SQLSTATE 23505, den `pg` als `code` auf den Fehler legt,
        // damit der Aufrufer die Kollision wie in Produktion erkennen kann.
        const fehler = new Error(`Port ${data.port}/${data.protocol} ist bereits vergeben.`);
        (fehler as Error & { code?: string }).code = '23505';
        throw fehler;
      }

      const allocation: PortAllocationRecord = {
        id: `allocation-${nextAllocationId++}`,
        rangeId: data.rangeId,
        port: data.port,
        protocol: data.protocol,
        serverId: data.serverId,
        allocatedAt: new Date('2026-08-26T10:00:00.000Z'),
      };
      allocations.push(allocation);

      return allocation;
    },

    async removeAllocation(id) {
      const index = allocations.findIndex((allocation) => allocation.id === id);

      if (index >= 0) {
        allocations.splice(index, 1);
      }
    },

    async removeAllocationsForServer(serverId) {
      const remaining = allocations.filter((allocation) => allocation.serverId !== serverId);
      const removed = allocations.length - remaining.length;
      allocations.splice(0, allocations.length, ...remaining);

      return removed;
    },
  };
}

// ---------------------------------------------------------------------------
// Speicherübersicht
// ---------------------------------------------------------------------------

export function agentEntry(overrides: Partial<AgentStorageEntry> = {}): AgentStorageEntry {
  return {
    kind: 'serverData',
    path: `/srv/palantir/servers/${SERVER_ID}`,
    sizeBytes: 5_000_000,
    serverId: SERVER_ID,
    backupFileName: null,
    imageId: null,
    imageTag: null,
    inUse: true,
    lastModifiedAt: '2026-08-26T09:00:00.000Z',
    ...overrides,
  };
}

export function createFakeStorageRepository(
  seed: StorageSnapshotRecord | null = null,
): StorageRepository & { snapshot: StorageSnapshotRecord | null } {
  const state: { snapshot: StorageSnapshotRecord | null } = { snapshot: seed };

  return {
    get snapshot() {
      return state.snapshot;
    },

    async findSnapshot(nodeId) {
      return state.snapshot && state.snapshot.nodeId === nodeId ? state.snapshot : null;
    },

    async saveSnapshot(snapshot) {
      state.snapshot = snapshot;
    },
  };
}

export function snapshotRecord(
  entries: AgentStorageEntry[],
  overrides: Partial<StorageSnapshotRecord> = {},
): StorageSnapshotRecord {
  return {
    nodeId: NODE_ID,
    scannedAt: new Date('2026-08-26T09:00:00.000Z'),
    totalBytes: 2_000_000_000_000,
    usedBytes: 900_000_000_000,
    freeBytes: 1_100_000_000_000,
    entries,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rollenverwaltung
// ---------------------------------------------------------------------------

export function roleRecord(overrides: Partial<RoleRecord> = {}): RoleRecord {
  return {
    id: ROLE_ID,
    name: 'Nutzer',
    description: 'Darf eigene Server verwalten.',
    permissions: ['server.create'],
    isProtected: false,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Ablage der Rollen im Arbeitsspeicher.
 *
 * Bildet die Zusicherungen der Tabelle nach, auf die der Service baut: die
 * Eindeutigkeit des Namens ohne Rücksicht auf Groß-/Kleinschreibung, die
 * Eindeutigkeit einer Zuweisung und ON DELETE CASCADE auf `user_roles`.
 */
export function createFakeRoleRepository(
  seed: RoleRecord[] = [],
): RoleRepository & { rows: RoleRecord[]; assignments: { userId: string; roleId: string }[] } {
  const rows: RoleRecord[] = [...seed];
  const assignments: { userId: string; roleId: string }[] = [];
  let nextId = seed.length + 1;

  return {
    rows,
    assignments,

    async listAll() {
      return [...rows].sort((a, b) => a.name.localeCompare(b.name));
    },

    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },

    async findByName(name) {
      return rows.find((row) => row.name.toLowerCase() === name.toLowerCase()) ?? null;
    },

    async create(data) {
      const role = roleRecord({
        // Ebenfalls UUID-förmig, damit angelegte Rollen über die Routen
        // wieder adressierbar sind.
        id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
        name: data.name,
        description: data.description,
        permissions: [...data.permissions],
        isProtected: data.isProtected,
      });
      rows.push(role);

      return role;
    },

    async update(id, data) {
      const index = rows.findIndex((row) => row.id === id);
      const current = rows[index];

      if (!current) {
        throw new Error('Rolle nicht gefunden');
      }

      const updated: RoleRecord = {
        ...current,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.permissions !== undefined ? { permissions: [...data.permissions] } : {}),
      };
      rows[index] = updated;

      return updated;
    },

    async remove(id) {
      const index = rows.findIndex((row) => row.id === id);

      if (index >= 0) {
        rows.splice(index, 1);
      }

      // Bildet ON DELETE CASCADE auf `user_roles` nach (Pflichtenheft §6).
      for (let i = assignments.length - 1; i >= 0; i -= 1) {
        if (assignments[i]?.roleId === id) {
          assignments.splice(i, 1);
        }
      }
    },

    async countMembers() {
      const counts = new Map<string, number>();

      for (const assignment of assignments) {
        counts.set(assignment.roleId, (counts.get(assignment.roleId) ?? 0) + 1);
      }

      return counts;
    },

    async listRolesForUser(userId) {
      return assignments
        .filter((assignment) => assignment.userId === userId)
        .flatMap((assignment) => rows.filter((row) => row.id === assignment.roleId));
    },

    async assignToUser(userId, roleId) {
      // Doppelte Zuweisung ist kein Fehler – derselbe Zielzustand.
      if (!assignments.some((a) => a.userId === userId && a.roleId === roleId)) {
        assignments.push({ userId, roleId });
      }
    },

    async removeFromUser(userId, roleId) {
      const index = assignments.findIndex((a) => a.userId === userId && a.roleId === roleId);

      if (index >= 0) {
        assignments.splice(index, 1);
      }
    },
  };
}

/**
 * Rollenverwaltung mit Attrappen – darunter der echte `RoleService` aus B2,
 * damit in den Tests dieselben Regeln greifen wie im Betrieb.
 */
export function createTestRoleAdminService(options: {
  repository: RoleRepository;
  audit: AuditService;
  knownUserIds?: readonly string[];
}): RoleAdminService {
  const known = options.knownUserIds ?? [USER_ID];

  return createRoleAdminService({
    roles: createRoleService(options.repository),
    audit: options.audit,
    users: { exists: (userId) => Promise.resolve(known.includes(userId)) },
  });
}

/** Rechtebündel, wie es der Rollen-Editor aus F10 schicken würde. */
export const ROLE_PERMISSION_BUNDLE: readonly Permission[] = ['server.create', 'node.view'];
