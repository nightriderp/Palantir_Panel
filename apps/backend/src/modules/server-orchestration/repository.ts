/**
 * Datenzugriff der Server-Orchestrierung.
 *
 * Der Dienst (`service.ts`) kennt ausschließlich diese Schnittstelle und nie
 * Drizzle. Das ist derselbe Schnitt wie bei `RoleRepository` in B2 und hat
 * denselben Grund: Die fachlichen Abläufe – Lifecycle, Crash-Loop, Klonen –
 * sind so ohne laufende Datenbank prüfbar (CLAUDE.md §4).
 */

import {
  type GameConfigValues,
  type ServerMemberLevel,
  type ServerResourceLimits,
  type ServerStatus,
} from '@palantir/contracts';
import { type ServerAutoShutdown, type ServerPortAssignment } from './types.js';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { gameServers, hostNodes, serverMembers, users } from '../../db/schema.js';

/** Ein Gameserver, wie ihn der Dienst braucht. */
export interface ServerRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerDisplayName: string | null;
  readonly hostId: string;
  readonly hostName: string | null;
  readonly name: string;
  readonly gameType: string;
  readonly status: ServerStatus;
  readonly statusMessage: string | null;
  readonly statusChangedAt: string;
  readonly lastStartedAt: string | null;
  readonly lastActivityAt: string | null;
  readonly crashTimestamps: readonly string[];
  readonly dockerContainerId: string | null;
  readonly subdomain: string;
  readonly dnsRecordId: string | null;
  readonly assignedPorts: readonly ServerPortAssignment[];
  readonly resourceLimits: ServerResourceLimits;
  readonly configJson: GameConfigValues;
  readonly startupParameters: string;
  readonly autoShutdown: ServerAutoShutdown;
  readonly restartRequired: boolean;
  readonly clonedFromServerId: string | null;
  readonly createdAt: string;
}

export interface CreateServerData {
  readonly ownerId: string;
  readonly hostId: string;
  readonly name: string;
  readonly gameType: string;
  readonly subdomain: string;
  readonly assignedPorts: readonly ServerPortAssignment[];
  readonly resourceLimits: ServerResourceLimits;
  readonly configJson: GameConfigValues;
  readonly startupParameters: string;
  readonly autoShutdown: ServerAutoShutdown;
  readonly clonedFromServerId: string | null;
}

/** Teil-Update; nur gesetzte Felder werden geschrieben. */
export interface UpdateServerData {
  readonly name?: string;
  readonly subdomain?: string;
  readonly resourceLimits?: ServerResourceLimits;
  readonly configJson?: GameConfigValues;
  readonly startupParameters?: string;
  readonly autoShutdown?: ServerAutoShutdown;
  readonly restartRequired?: boolean;
  readonly dockerContainerId?: string | null;
  readonly dnsRecordId?: string | null;
  readonly assignedPorts?: readonly ServerPortAssignment[];
  readonly lastActivityAt?: string | null;
}

/** Zustandswechsel, wie ihn die State Machine liefert. */
export interface PersistLifecycleData {
  readonly status: ServerStatus;
  readonly statusMessage: string | null;
  readonly statusChangedAt: string;
  readonly lastStartedAt: string | null;
  readonly crashTimestamps: readonly string[];
}

export interface HostNodeRecord {
  readonly id: string;
  readonly name: string;
  readonly wireguardIp: string;
  readonly status: string;
}

export interface ServerMemberRecord {
  readonly userId: string;
  readonly displayName: string;
  readonly level: ServerMemberLevel;
  readonly addedAt: string;
}

export interface ServerRepository {
  findById(id: string): Promise<ServerRecord | null>;
  findByContainerId(containerId: string): Promise<ServerRecord | null>;
  listByHost(hostId: string): Promise<readonly ServerRecord[]>;
  /** Alle Server, die der Aufrufer sehen darf – gefiltert wird im Dienst. */
  listAll(): Promise<readonly ServerRecord[]>;
  listByOwnerOrMembership(userId: string): Promise<readonly ServerRecord[]>;
  isSubdomainTaken(subdomain: string, excludeServerId?: string): Promise<boolean>;
  create(data: CreateServerData): Promise<ServerRecord>;
  update(id: string, data: UpdateServerData): Promise<void>;
  persistLifecycle(id: string, data: PersistLifecycleData): Promise<void>;
  delete(id: string): Promise<void>;
  listMembers(serverId: string): Promise<readonly ServerMemberRecord[]>;
  memberLevel(serverId: string, userId: string): Promise<ServerMemberLevel | null>;
  upsertMember(serverId: string, userId: string, level: ServerMemberLevel): Promise<void>;
  removeMember(serverId: string, userId: string): Promise<void>;
  /**
   * Die einzige Node dieser Installation.
   *
   * Phase 1 betreibt genau einen Homeserver (Pflichtenheft §1, §2.1: feste
   * Adressen für VPS und Homeserver). Mehrere Nodes brauchen ein Token je Node,
   * damit sich eine Verbindung überhaupt einer Node zuordnen lässt – das gehört
   * zu B8 und ist in WORK_STATUS.md vermerkt.
   */
  defaultHost(): Promise<HostNodeRecord | null>;
  findHost(hostId: string): Promise<HostNodeRecord | null>;
  /**
   * Hält den Verbindungszustand einer Node fest, wenn ihr Agent den Handshake
   * abschließt bzw. die Verbindung abbricht (Pflichtenheft §6, `HostNode.status`).
   *
   * `maintenance` wird dabei **nie** überschrieben: Das ist eine ausdrückliche
   * Entscheidung eines Admins über die Node-Verwaltung (B8) und darf nicht
   * dadurch verschwinden, dass der Agent sich neu verbindet oder kurz wegfällt.
   * Deshalb wechselt der Status ausschließlich zwischen `online` und `offline`.
   * `lastSeenAt` trägt den Zeitpunkt der letzten belegten Verbindung und wird
   * nur beim Verbinden gesetzt.
   */
  markHostConnected(hostId: string): Promise<void>;
  markHostDisconnected(hostId: string): Promise<void>;
  /**
   * Übernimmt die vom Agent **gemessenen** Gesamtressourcen der Node in
   * `total_ram_mb` / `total_cpu_cores` / `total_disk_mb` (Pflichtenheft §11).
   *
   * Damit rechnet die Kapazitätsprüfung gegen das, was die VM wirklich hat,
   * statt gegen den Seed- oder Admin-Sollwert. Bewusste Folge: Sobald ein Agent
   * verbunden ist, führt die Messung diese Spalten – eine Vergrößerung der
   * Platte wirkt ohne Nachpflege, ein manuell gesetzter Wert wird überschrieben.
   */
  updateMeasuredResources(
    hostId: string,
    resources: { ramMb: number; cpuCores: number; diskMb: number },
  ): Promise<void>;
}

function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

type ServerJoinRow = {
  server: typeof gameServers.$inferSelect;
  ownerDisplayName: string | null;
  hostName: string | null;
};

function toRecord(row: ServerJoinRow): ServerRecord {
  const server = row.server;

  return {
    id: server.id,
    ownerId: server.ownerId,
    ownerDisplayName: row.ownerDisplayName,
    hostId: server.hostId,
    hostName: row.hostName,
    name: server.name,
    gameType: server.gameType,
    status: server.status,
    statusMessage: server.statusMessage,
    statusChangedAt: server.statusChangedAt.toISOString(),
    lastStartedAt: toIso(server.lastStartedAt),
    lastActivityAt: toIso(server.lastActivityAt),
    crashTimestamps: server.crashTimestamps,
    dockerContainerId: server.dockerContainerId,
    subdomain: server.subdomain,
    dnsRecordId: server.dnsRecordId,
    assignedPorts: server.assignedPorts,
    resourceLimits: server.resourceLimits,
    configJson: server.configJson,
    startupParameters: server.startupParameters,
    autoShutdown: server.autoShutdown,
    restartRequired: server.restartRequired,
    clonedFromServerId: server.clonedFromServerId,
    createdAt: server.createdAt.toISOString(),
  };
}

export function createDrizzleServerRepository(db: DbConnection): ServerRepository {
  const baseSelect = {
    server: gameServers,
    ownerDisplayName: users.displayName,
    hostName: hostNodes.name,
  };

  /**
   * Grundabfrage mit den beiden Anzeigenamen, die jedes DTO braucht.
   *
   * `leftJoin` statt `innerJoin`: Fehlt der Besitzer oder die Node, soll der
   * Server trotzdem in der Liste auftauchen – ein unsichtbarer Server wäre
   * schlimmer als einer ohne Besitzernamen.
   */
  const baseQuery = () =>
    db
      .select(baseSelect)
      .from(gameServers)
      .leftJoin(users, eq(users.id, gameServers.ownerId))
      .leftJoin(hostNodes, eq(hostNodes.id, gameServers.hostId));

  return {
    async findById(id: string): Promise<ServerRecord | null> {
      const rows = await baseQuery().where(eq(gameServers.id, id)).limit(1);

      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async findByContainerId(containerId: string): Promise<ServerRecord | null> {
      const rows = await baseQuery().where(eq(gameServers.dockerContainerId, containerId)).limit(1);

      return rows[0] === undefined ? null : toRecord(rows[0]);
    },

    async listByHost(hostId: string): Promise<readonly ServerRecord[]> {
      const rows = await baseQuery().where(eq(gameServers.hostId, hostId));

      return rows.map(toRecord);
    },

    async listAll(): Promise<readonly ServerRecord[]> {
      const rows = await baseQuery();

      return rows.map(toRecord);
    },

    async listByOwnerOrMembership(userId: string): Promise<readonly ServerRecord[]> {
      const memberships = await db
        .select({ serverId: serverMembers.serverId })
        .from(serverMembers)
        .where(eq(serverMembers.userId, userId));

      const memberServerIds = memberships.map((row) => row.serverId);

      const rows = await baseQuery().where(
        memberServerIds.length === 0
          ? eq(gameServers.ownerId, userId)
          : or(eq(gameServers.ownerId, userId), inArray(gameServers.id, memberServerIds)),
      );

      return rows.map(toRecord);
    },

    async isSubdomainTaken(subdomain: string, excludeServerId?: string): Promise<boolean> {
      const condition =
        excludeServerId === undefined
          ? eq(gameServers.subdomain, subdomain)
          : and(eq(gameServers.subdomain, subdomain), ne(gameServers.id, excludeServerId));

      const rows = await db
        .select({ id: gameServers.id })
        .from(gameServers)
        .where(condition)
        .limit(1);

      return rows.length > 0;
    },

    async create(data: CreateServerData): Promise<ServerRecord> {
      const inserted = await db
        .insert(gameServers)
        .values({
          ownerId: data.ownerId,
          hostId: data.hostId,
          name: data.name,
          gameType: data.gameType,
          subdomain: data.subdomain,
          assignedPorts: [...data.assignedPorts],
          resourceLimits: data.resourceLimits,
          configJson: data.configJson,
          startupParameters: data.startupParameters,
          autoShutdown: data.autoShutdown,
          clonedFromServerId: data.clonedFromServerId,
          status: 'creating',
        })
        .returning({ id: gameServers.id });

      const id = inserted[0]?.id;

      if (id === undefined) {
        throw new Error('Der Server konnte nicht angelegt werden.');
      }

      const created = await this.findById(id);

      if (created === null) {
        throw new Error('Der angelegte Server war unmittelbar danach nicht auffindbar.');
      }

      return created;
    },

    async update(id: string, data: UpdateServerData): Promise<void> {
      const values: Record<string, unknown> = { updatedAt: new Date() };

      if (data.name !== undefined) values.name = data.name;
      if (data.subdomain !== undefined) values.subdomain = data.subdomain;
      if (data.resourceLimits !== undefined) values.resourceLimits = data.resourceLimits;
      if (data.configJson !== undefined) values.configJson = data.configJson;
      if (data.startupParameters !== undefined) values.startupParameters = data.startupParameters;
      if (data.autoShutdown !== undefined) values.autoShutdown = data.autoShutdown;
      if (data.restartRequired !== undefined) values.restartRequired = data.restartRequired;
      if (data.dockerContainerId !== undefined) values.dockerContainerId = data.dockerContainerId;
      if (data.dnsRecordId !== undefined) values.dnsRecordId = data.dnsRecordId;
      if (data.assignedPorts !== undefined) values.assignedPorts = [...data.assignedPorts];
      if (data.lastActivityAt !== undefined) {
        values.lastActivityAt = data.lastActivityAt === null ? null : new Date(data.lastActivityAt);
      }

      await db.update(gameServers).set(values).where(eq(gameServers.id, id));
    },

    async persistLifecycle(id: string, data: PersistLifecycleData): Promise<void> {
      await db
        .update(gameServers)
        .set({
          status: data.status,
          statusMessage: data.statusMessage,
          statusChangedAt: new Date(data.statusChangedAt),
          lastStartedAt: data.lastStartedAt === null ? null : new Date(data.lastStartedAt),
          crashTimestamps: [...data.crashTimestamps],
          updatedAt: new Date(),
        })
        .where(eq(gameServers.id, id));
    },

    async delete(id: string): Promise<void> {
      await db.delete(gameServers).where(eq(gameServers.id, id));
    },

    async listMembers(serverId: string): Promise<readonly ServerMemberRecord[]> {
      const rows = await db
        .select({
          userId: serverMembers.userId,
          displayName: users.displayName,
          level: serverMembers.permissionLevel,
          addedAt: serverMembers.addedAt,
        })
        .from(serverMembers)
        .innerJoin(users, eq(users.id, serverMembers.userId))
        .where(eq(serverMembers.serverId, serverId));

      return rows.map((row) => ({
        userId: row.userId,
        displayName: row.displayName,
        level: row.level,
        addedAt: row.addedAt.toISOString(),
      }));
    },

    async memberLevel(serverId: string, userId: string): Promise<ServerMemberLevel | null> {
      const rows = await db
        .select({ level: serverMembers.permissionLevel })
        .from(serverMembers)
        .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId)))
        .limit(1);

      return rows[0]?.level ?? null;
    },

    async upsertMember(serverId: string, userId: string, level: ServerMemberLevel): Promise<void> {
      await db
        .insert(serverMembers)
        .values({ serverId, userId, permissionLevel: level })
        .onConflictDoUpdate({
          target: [serverMembers.serverId, serverMembers.userId],
          set: { permissionLevel: level },
        });
    },

    async removeMember(serverId: string, userId: string): Promise<void> {
      await db
        .delete(serverMembers)
        .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId)));
    },

    async defaultHost(): Promise<HostNodeRecord | null> {
      const rows = await db
        .select({
          id: hostNodes.id,
          name: hostNodes.name,
          wireguardIp: hostNodes.wireguardIp,
          status: hostNodes.status,
        })
        .from(hostNodes)
        .limit(1);

      return rows[0] ?? null;
    },

    async findHost(hostId: string): Promise<HostNodeRecord | null> {
      const rows = await db
        .select({
          id: hostNodes.id,
          name: hostNodes.name,
          wireguardIp: hostNodes.wireguardIp,
          status: hostNodes.status,
        })
        .from(hostNodes)
        .where(eq(hostNodes.id, hostId))
        .limit(1);

      return rows[0] ?? null;
    },

    async markHostConnected(hostId: string): Promise<void> {
      const jetzt = new Date();

      await db
        .update(hostNodes)
        .set({
          // Nur ein offline gemeldeter Knoten wird online gesetzt; maintenance
          // bleibt unangetastet (siehe Kommentar an der Schnittstelle).
          status: sql`case when ${hostNodes.status} = 'offline' then 'online' else ${hostNodes.status} end`,
          lastSeenAt: jetzt,
          updatedAt: jetzt,
        })
        .where(eq(hostNodes.id, hostId));
    },

    async markHostDisconnected(hostId: string): Promise<void> {
      await db
        .update(hostNodes)
        .set({
          status: sql`case when ${hostNodes.status} = 'online' then 'offline' else ${hostNodes.status} end`,
          updatedAt: new Date(),
        })
        .where(eq(hostNodes.id, hostId));
    },

    async updateMeasuredResources(hostId, resources): Promise<void> {
      await db
        .update(hostNodes)
        .set({
          totalRamMb: resources.ramMb,
          totalCpuCores: resources.cpuCores,
          totalDiskMb: resources.diskMb,
          updatedAt: new Date(),
        })
        .where(eq(hostNodes.id, hostId));
    },
  };
}
