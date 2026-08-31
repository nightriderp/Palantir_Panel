/**
 * Drizzle-Implementierungen der Repositories des Admin-Moduls
 * (Pflichtenheft §6).
 *
 * Enthält ausschließlich Datenzugriff – jede fachliche Regel (Berechtigungen,
 * Überschneidungen von Port-Bereichen, Löschbarkeit eines Speicher-Postens)
 * liegt in den Services daneben. Genauso wie im RBAC-Modul aus B2.
 */

import type { AgentStorageEntry, LinkedAccountProfileDto } from '@palantir/contracts';
import type { AuditLogQuery, RegistrationRequestQuery } from '@palantir/validation';
import { and, asc, count, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { auditLog, portAllocations, portRanges, storageSnapshots } from '../../db/schema/admin.js';
// `auth_methods` gehört zu B1 (Pflichtenheft §7); die Warteliste liest die
// Profilangaben der verknüpften Anmeldeverfahren daraus mit (Lastenheft §3.1).
import { authMethods } from '../../db/schema/auth.js';
// `host_nodes` gehört zu B4 (Kapazitätsprüfung, Pflichtenheft §10); B8 verwaltet
// dieselbe Tabelle, statt eine zweite daneben anzulegen.
import { hostNodes } from '../../db/schema/resources.js';
import { roles, userRoles } from '../../db/schema/rbac.js';
import { users } from '../../db/schema/users.js';
import type { AuditArchiveRepository, AuditEntryRecord, AuditLogRepository } from './audit.js';
import { AdminError } from './errors.js';
import { toLinkedAccountProfile } from './linked-profiles.js';
import type { RoleMemberLookup } from './roles.js';
import type { HostNodeRecord, HostNodeRepository } from './nodes.js';
import type { PortAllocationRecord, PortPoolRepository, PortRangeRecord } from './ports.js';
import type {
  RegistrationRequestRepository,
  WaitlistUserRecord,
  WaitlistRole,
} from './registration-requests.js';
import { statusOf } from './registration-requests.js';
import type { StorageRepository, StorageSnapshotRecord } from './storage.js';

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

/**
 * Die Gesamt-Ressourcen liegen in drei Spalten statt als JSON – so hat B4 die
 * Tabelle angelegt, damit die Kapazitätsprüfung in SQL damit rechnen kann. Die
 * Zusammenfassung zum Objekt `NodeResources` passiert hier.
 */
function toNodeRecord(row: typeof hostNodes.$inferSelect): HostNodeRecord {
  return {
    id: row.id,
    name: row.name,
    wireguardIp: row.wireguardIp,
    totalResources: {
      ramMb: row.totalRamMb,
      cpuCores: row.totalCpuCores,
      diskMb: row.totalDiskMb,
    },
    status: row.status,
    statusMessage: row.statusMessage,
    lastSeenAt: row.lastSeenAt,
    // Nur das Ja/Nein verlässt das Repository, nie der Hash selbst.
    hasAgentToken: row.agentTokenHash !== null,
    createdAt: row.createdAt,
  };
}

export function createDrizzleHostNodeRepository(db: Database): HostNodeRepository {
  return {
    async listAll() {
      const rows = await db.select().from(hostNodes).orderBy(asc(hostNodes.name));

      return rows.map(toNodeRecord);
    },

    async findById(id) {
      const [row] = await db.select().from(hostNodes).where(eq(hostNodes.id, id)).limit(1);

      return row ? toNodeRecord(row) : null;
    },

    async findByAgentTokenHash(hash) {
      const [row] = await db
        .select()
        .from(hostNodes)
        .where(eq(hostNodes.agentTokenHash, hash))
        .limit(1);

      return row ? toNodeRecord(row) : null;
    },

    async setAgentTokenHash(id, hash) {
      await db
        .update(hostNodes)
        .set({ agentTokenHash: hash, updatedAt: new Date() })
        .where(eq(hostNodes.id, id));
    },

    async findByNameOrIp(name, wireguardIp) {
      // Der Name wird ohne Rücksicht auf Groß-/Kleinschreibung verglichen, die
      // Adresse exakt – sie ist eine technische Angabe, kein Anzeigename.
      const conditions = [
        ...(name === undefined ? [] : [sql`lower(${hostNodes.name}) = lower(${name})`]),
        ...(wireguardIp === undefined ? [] : [eq(hostNodes.wireguardIp, wireguardIp)]),
      ];

      if (conditions.length === 0) {
        return null;
      }

      const [row] = await db
        .select()
        .from(hostNodes)
        .where(sql.join(conditions, sql` or `))
        .limit(1);

      return row ? toNodeRecord(row) : null;
    },

    async create(data) {
      const [row] = await db
        .insert(hostNodes)
        .values({
          name: data.name,
          wireguardIp: data.wireguardIp,
          totalRamMb: data.totalResources.ramMb,
          totalCpuCores: data.totalResources.cpuCores,
          totalDiskMb: data.totalResources.diskMb,
        })
        .returning();

      if (!row) {
        throw new Error('Node konnte nicht angelegt werden.');
      }

      return toNodeRecord(row);
    },

    async update(id, data) {
      const [row] = await db
        .update(hostNodes)
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.wireguardIp !== undefined ? { wireguardIp: data.wireguardIp } : {}),
          ...(data.totalResources !== undefined
            ? {
                totalRamMb: data.totalResources.ramMb,
                totalCpuCores: data.totalResources.cpuCores,
                totalDiskMb: data.totalResources.diskMb,
              }
            : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(data.statusMessage !== undefined ? { statusMessage: data.statusMessage } : {}),
          updatedAt: new Date(),
        })
        .where(eq(hostNodes.id, id))
        .returning();

      if (!row) {
        throw new AdminError('NODE_NOT_FOUND');
      }

      return toNodeRecord(row);
    },

    async remove(id) {
      await db.delete(hostNodes).where(eq(hostNodes.id, id));
    },
  };
}

// ---------------------------------------------------------------------------
// Port-Pool
// ---------------------------------------------------------------------------

function toRangeRecord(row: typeof portRanges.$inferSelect): PortRangeRecord {
  return {
    id: row.id,
    label: row.label,
    startPort: row.startPort,
    endPort: row.endPort,
    protocol: row.protocol,
    nodeId: row.nodeId,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

function toAllocationRecord(row: typeof portAllocations.$inferSelect): PortAllocationRecord {
  return {
    id: row.id,
    rangeId: row.rangeId,
    port: row.port,
    protocol: row.protocol,
    serverId: row.serverId,
    allocatedAt: row.allocatedAt,
  };
}

export function createDrizzlePortPoolRepository(db: Database): PortPoolRepository {
  return {
    async listRanges() {
      const rows = await db.select().from(portRanges).orderBy(asc(portRanges.startPort));

      return rows.map(toRangeRecord);
    },

    async findRangeById(id) {
      const [row] = await db.select().from(portRanges).where(eq(portRanges.id, id)).limit(1);

      return row ? toRangeRecord(row) : null;
    },

    async createRange(data) {
      const [row] = await db
        .insert(portRanges)
        .values({
          label: data.label,
          startPort: data.startPort,
          endPort: data.endPort,
          protocol: data.protocol,
          nodeId: data.nodeId,
          enabled: data.enabled,
        })
        .returning();

      if (!row) {
        throw new Error('Port-Bereich konnte nicht angelegt werden.');
      }

      return toRangeRecord(row);
    },

    async updateRange(id, data) {
      const [row] = await db
        .update(portRanges)
        .set({
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.startPort !== undefined ? { startPort: data.startPort } : {}),
          ...(data.endPort !== undefined ? { endPort: data.endPort } : {}),
          ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
          updatedAt: new Date(),
        })
        .where(eq(portRanges.id, id))
        .returning();

      if (!row) {
        throw new AdminError('PORT_RANGE_NOT_FOUND');
      }

      return toRangeRecord(row);
    },

    async removeRange(id) {
      await db.delete(portRanges).where(eq(portRanges.id, id));
    },

    async listAllocations() {
      const rows = await db.select().from(portAllocations).orderBy(asc(portAllocations.port));

      return rows.map(toAllocationRecord);
    },

    async findAllocationById(id) {
      const [row] = await db
        .select()
        .from(portAllocations)
        .where(eq(portAllocations.id, id))
        .limit(1);

      return row ? toAllocationRecord(row) : null;
    },

    async insertAllocation(data) {
      const [row] = await db.insert(portAllocations).values(data).returning();

      if (!row) {
        throw new AdminError('PORT_POOL_EXHAUSTED');
      }

      return toAllocationRecord(row);
    },

    async removeAllocation(id) {
      await db.delete(portAllocations).where(eq(portAllocations.id, id));
    },

    async removeAllocationsForServer(serverId) {
      const removed = await db
        .delete(portAllocations)
        .where(eq(portAllocations.serverId, serverId))
        .returning({ id: portAllocations.id });

      return removed.length;
    },
  };
}

// ---------------------------------------------------------------------------
// Audit-Log
// ---------------------------------------------------------------------------

function toAuditRecord(row: typeof auditLog.$inferSelect): AuditEntryRecord {
  return {
    id: row.id,
    action: row.action,
    actorId: row.actorId,
    actorDisplayName: row.actorDisplayName,
    targetType: row.targetType,
    targetId: row.targetId,
    ipHint: row.ipHint,
    metadata: row.metadata,
    timestamp: row.timestamp,
  };
}

function auditFilters(query: AuditLogQuery) {
  return [
    ...(query.action ? [eq(auditLog.action, query.action)] : []),
    ...(query.actorId ? [eq(auditLog.actorId, query.actorId)] : []),
    ...(query.targetType ? [eq(auditLog.targetType, query.targetType)] : []),
    ...(query.targetId ? [eq(auditLog.targetId, query.targetId)] : []),
    ...(query.from ? [gte(auditLog.timestamp, new Date(query.from))] : []),
    ...(query.to ? [lte(auditLog.timestamp, new Date(query.to))] : []),
  ];
}

/**
 * Zugriff auf das Audit-Log – **nur Anhängen und Lesen**.
 *
 * Hier gibt es absichtlich kein `update` und kein `delete`. Ein Versuch würde
 * ohnehin am Trigger `audit_log_append_only` in der Datenbank scheitern
 * (Migration `0003`), aber die Schnittstelle soll gar nicht erst dazu einladen.
 */
export function createDrizzleAuditLogRepository(db: Database): AuditLogRepository {
  return {
    async append(entry) {
      const [row] = await db
        .insert(auditLog)
        .values({
          action: entry.action,
          actorId: entry.actorId ?? null,
          actorDisplayName: entry.actorDisplayName ?? null,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          ipHint: entry.ipHint ?? null,
          metadata: entry.metadata ?? {},
        })
        .returning();

      if (!row) {
        throw new Error('Der Audit-Eintrag konnte nicht geschrieben werden.');
      }

      return toAuditRecord(row);
    },

    async list(query) {
      const filters = auditFilters(query);
      const where = filters.length > 0 ? and(...filters) : undefined;

      const [rows, [totalRow]] = await Promise.all([
        db
          .select()
          .from(auditLog)
          .where(where)
          .orderBy(desc(auditLog.timestamp))
          .limit(query.limit)
          .offset(query.offset),
        db.select({ value: count() }).from(auditLog).where(where),
      ]);

      return { entries: rows.map(toAuditRecord), total: Number(totalRow?.value ?? 0) };
    },
  };
}

/**
 * Zugriff des Archivierungsprozesses (Pflichtenheft §6).
 *
 * `deleteOlderThan()` weist sich gegenüber dem Datenbank-Trigger über die
 * Sitzungsvariable `palantir.audit_archive` aus. `SET LOCAL` gilt nur innerhalb
 * der Transaktion – nach dem Commit ist das Log wieder für jeden unantastbar,
 * auch wenn dieselbe Verbindung weiterverwendet wird.
 */
export function createDrizzleAuditArchiveRepository(db: Database): AuditArchiveRepository {
  return {
    async listOlderThan(cutoff) {
      const rows = await db
        .select()
        .from(auditLog)
        .where(lt(auditLog.timestamp, cutoff))
        .orderBy(asc(auditLog.timestamp));

      return rows.map(toAuditRecord);
    },

    async deleteOlderThan(cutoff) {
      return db.transaction(async (tx) => {
        await tx.execute(sql.raw("SET LOCAL palantir.audit_archive = 'on'"));

        const removed = await tx
          .delete(auditLog)
          .where(lt(auditLog.timestamp, cutoff))
          .returning({ id: auditLog.id });

        return removed.length;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Speicherübersicht
// ---------------------------------------------------------------------------

export function createDrizzleStorageRepository(db: Database): StorageRepository {
  return {
    async findSnapshot(nodeId) {
      const [row] = await db
        .select()
        .from(storageSnapshots)
        .where(eq(storageSnapshots.nodeId, nodeId))
        .limit(1);

      if (!row) {
        return null;
      }

      return {
        nodeId: row.nodeId,
        scannedAt: row.scannedAt,
        totalBytes: row.totalBytes,
        usedBytes: row.usedBytes,
        freeBytes: row.freeBytes,
        entries: row.entries,
      };
    },

    async saveSnapshot(snapshot: StorageSnapshotRecord) {
      const entries = [...snapshot.entries] as AgentStorageEntry[];

      await db
        .insert(storageSnapshots)
        .values({
          nodeId: snapshot.nodeId,
          scannedAt: snapshot.scannedAt,
          totalBytes: snapshot.totalBytes,
          usedBytes: snapshot.usedBytes,
          freeBytes: snapshot.freeBytes,
          entries,
        })
        .onConflictDoUpdate({
          target: storageSnapshots.nodeId,
          set: {
            scannedAt: snapshot.scannedAt,
            totalBytes: snapshot.totalBytes,
            usedBytes: snapshot.usedBytes,
            freeBytes: snapshot.freeBytes,
            entries,
          },
        });
    },
  };
}

// ---------------------------------------------------------------------------
// Rollenverwaltung
// ---------------------------------------------------------------------------

/**
 * Nachschlagen eines Kontos für die Rollenverwaltung.
 *
 * Bewusst nur die Existenzfrage: Mehr braucht das Zuweisen und Entziehen
 * nicht, und die Abfrage bleibt damit ein Index-Treffer auf den
 * Primärschlüssel.
 */
export function createDrizzleRoleMemberLookup(db: Database): RoleMemberLookup {
  return {
    async exists(userId) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return row !== undefined;
    },
  };
}

// ---------------------------------------------------------------------------
// Freischalt-Warteliste
// ---------------------------------------------------------------------------

/**
 * Konten samt Rollen laden.
 *
 * Die Filterung nach Zustand (`pending`/`approved`/`blocked`) und die
 * Seitenaufteilung passieren bewusst in TypeScript und nicht in SQL: Der
 * Zustand ergibt sich erst aus der Rollen-Zusammensetzung, und die Instanz
 * bedient einen Freundeskreis (Lastenheft §1.2) – die Kontenzahl bleibt klein.
 * Wird sie es einmal nicht, gehört daraus eine SQL-Abfrage gemacht.
 *
 * **Profilangaben** (Discord-Tag/Avatar, Steam-Profilname, Twitch-Name) kommen
 * aus `auth_methods` (B1, Pflichtenheft §7). Sie werden für alle geladenen
 * Konten in einer zweiten Abfrage auf einmal geholt statt je Konto einzeln;
 * die Abbildung auf `LinkedAccountProfileDto` steht in `linked-profiles.ts`.
 */
export function createDrizzleRegistrationRequestRepository(
  db: Database,
): RegistrationRequestRepository {
  async function loadUsers(userIds?: readonly string[]): Promise<WaitlistUserRecord[]> {
    const userRows = await db
      .select()
      .from(users)
      .where(userIds ? inArray(users.id, [...userIds]) : undefined)
      .orderBy(asc(users.createdAt));

    if (userRows.length === 0) {
      return [];
    }

    const roleRows = await db
      .select({
        userId: userRoles.userId,
        id: roles.id,
        name: roles.name,
        isProtected: roles.isProtected,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        inArray(
          userRoles.userId,
          userRows.map((row) => row.id),
        ),
      );

    const rolesByUser = new Map<string, WaitlistRole[]>();

    for (const row of roleRows) {
      const list = rolesByUser.get(row.userId) ?? [];
      list.push({ id: row.id, name: row.name, isProtected: row.isProtected });
      rolesByUser.set(row.userId, list);
    }

    // Verknüpfte Anmeldeverfahren mit ihren Profilangaben (Lastenheft §3.1).
    // Älteste zuerst, damit die Reihenfolge in der Oberfläche stabil bleibt.
    const methodRows = await db
      .select({
        userId: authMethods.userId,
        type: authMethods.type,
        providerUserId: authMethods.providerUserId,
        providerDisplayName: authMethods.providerDisplayName,
        providerAvatarUrl: authMethods.providerAvatarUrl,
        createdAt: authMethods.createdAt,
      })
      .from(authMethods)
      .where(
        inArray(
          authMethods.userId,
          userRows.map((row) => row.id),
        ),
      )
      .orderBy(asc(authMethods.createdAt));

    const profilesByUser = new Map<string, LinkedAccountProfileDto[]>();

    for (const row of methodRows) {
      const list = profilesByUser.get(row.userId) ?? [];
      list.push(toLinkedAccountProfile(row));
      profilesByUser.set(row.userId, list);
    }

    return userRows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      isOwner: row.isOwner,
      banned: row.banned,
      createdAt: row.createdAt,
      roles: rolesByUser.get(row.id) ?? [],
      profiles: profilesByUser.get(row.id) ?? [],
    }));
  }

  return {
    async list(query: RegistrationRequestQuery) {
      const all = await loadUsers();
      const matching = all.filter((user) => statusOf(user) === query.status);

      return {
        rows: matching.slice(query.offset, query.offset + query.limit),
        total: matching.length,
      };
    },

    async findByUserId(userId) {
      const [user] = await loadUsers([userId]);

      return user ?? null;
    },

    async setBanned(userId, banned) {
      const updated = await db
        .update(users)
        .set({ banned })
        .where(eq(users.id, userId))
        .returning({ id: users.id });

      if (updated.length === 0) {
        throw new AdminError('USER_NOT_FOUND');
      }
    },
  };
}
