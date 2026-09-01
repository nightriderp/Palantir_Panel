/**
 * Drizzle-Umsetzung der Schnittstellen aus `ports.ts` (Pflichtenheft §6).
 *
 * Enthält ausschließlich Datenzugriff – jede fachliche Regel (Berechtigung,
 * Zusammenführen von Teil-Updates, Kapazitätsvergleich) liegt in `service.ts`
 * bzw. `capacity.ts`.
 *
 * {@link ServerUsageRepository} fehlt hier bewusst: es zählt über die Tabelle
 * `game_servers` aus Arbeitspaket B3, die noch nicht existiert. Für Tests und
 * für den Betrieb, solange B3 nicht steht, liefert
 * {@link createEmptyServerUsageRepository} eine leere Belegung.
 */

import {
  NO_USER_RESOURCE_LIMITS,
  type NodeResourceUsage,
  type UserResourceLimits,
  type UserResourceUsage,
} from '@palantir/contracts';
import { eq, inArray } from 'drizzle-orm';
import type { DbConnection } from '../../db/index.js';
import { hostNodes, userResourceLimits } from '../../db/schema/resources.js';
import { users } from '../../db/schema/users.js';
import type {
  HostNodeRecord,
  HostNodeRepository,
  ServerUsageRepository,
  UserResourceLimitRecord,
  UserResourceLimitRepository,
} from './ports.js';

type HostNodeRow = typeof hostNodes.$inferSelect;

function toNodeRecord(row: HostNodeRow): HostNodeRecord {
  return {
    id: row.id,
    name: row.name,
    wireguardIp: row.wireguardIp,
    status: row.status,
    // Die drei Spalten sind in der Datenbank getrennt, im Vertrag ein Objekt
    // (`HostNode.totalResources`, Pflichtenheft §6).
    totalResources: {
      ramMb: row.totalRamMb,
      cpuCores: row.totalCpuCores,
      diskMb: row.totalDiskMb,
    },
    // Gemessene Auslastung nur, wenn sie vollstaendig vorliegt (Gefundener
    // Punkt 96): Ein halber Messwert waere schlechter als keiner.
    measuredUsage:
      row.measuredAt === null ||
      row.measuredRamAvailableMb === null ||
      row.measuredDiskAvailableMb === null
        ? null
        : {
            ramAvailableMb: row.measuredRamAvailableMb,
            diskAvailableMb: row.measuredDiskAvailableMb,
            cpuLoad1m: row.measuredCpuLoad1m,
            observedAt: row.measuredAt,
          },
  };
}

export function createDrizzleHostNodeRepository(db: DbConnection): HostNodeRepository {
  return {
    async findById(nodeId) {
      const [row] = await db.select().from(hostNodes).where(eq(hostNodes.id, nodeId)).limit(1);

      return row ? toNodeRecord(row) : null;
    },

    async listAll() {
      const rows = await db.select().from(hostNodes).orderBy(hostNodes.name);

      return rows.map(toNodeRecord);
    },
  };
}

export function createDrizzleUserResourceLimitRepository(
  db: DbConnection,
): UserResourceLimitRepository {
  /**
   * Nutzer samt Kontingent lesen.
   *
   * Bewusst ein Left-Join statt zweier Abfragen: der Unterschied zwischen
   * „Konto existiert nicht" (→ `null`) und „Konto ohne Kontingent" (→ Datensatz
   * mit `NO_USER_RESOURCE_LIMITS`) muss in einer Abfrage entscheidbar sein.
   */
  async function load(userId: string): Promise<UserResourceLimitRecord | null> {
    const [row] = await db
      .select({ user: users, limits: userResourceLimits })
      .from(users)
      .leftJoin(userResourceLimits, eq(userResourceLimits.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      userId: row.user.id,
      userDisplayName: row.user.displayName,
      limits: row.limits
        ? {
            maxRamMb: row.limits.maxRamMb,
            maxCpuCores: row.limits.maxCpuCores,
            maxDiskMb: row.limits.maxDiskMb,
            maxConcurrentServers: row.limits.maxConcurrentServers,
          }
        : NO_USER_RESOURCE_LIMITS,
      updatedAt: row.limits?.updatedAt ?? null,
    };
  }

  return {
    findByUserId: load,

    /**
     * Kontingente mehrerer Konten in einer Abfrage.
     *
     * Nur die Kontingent-Tabelle, kein Join auf `users`: Der Aufrufer hat die
     * Konten bereits – ihm fehlen nur die Grenzen. Konten ohne Datensatz fehlen
     * in der Antwort; für sie gilt `NO_USER_RESOURCE_LIMITS`.
     */
    async findManyByUserId(userIds: readonly string[]) {
      const gefunden = new Map<string, UserResourceLimits>();

      if (userIds.length === 0) {
        return gefunden;
      }

      const rows = await db
        .select()
        .from(userResourceLimits)
        .where(inArray(userResourceLimits.userId, [...userIds]));

      for (const row of rows) {
        gefunden.set(row.userId, {
          maxRamMb: row.maxRamMb,
          maxCpuCores: row.maxCpuCores,
          maxDiskMb: row.maxDiskMb,
          maxConcurrentServers: row.maxConcurrentServers,
        });
      }

      return gefunden;
    },

    async upsert(userId: string, limits: UserResourceLimits) {
      await db
        .insert(userResourceLimits)
        .values({ userId, ...limits })
        .onConflictDoUpdate({
          target: userResourceLimits.userId,
          set: { ...limits, updatedAt: new Date() },
        });

      return load(userId);
    },

    async remove(userId: string) {
      await db.delete(userResourceLimits).where(eq(userResourceLimits.userId, userId));
    },
  };
}

const EMPTY_USER_USAGE: UserResourceUsage = {
  runningRamMb: 0,
  runningCpuCores: 0,
  allocatedDiskMb: 0,
  runningServers: 0,
  totalServers: 0,
};

const EMPTY_NODE_USAGE: NodeResourceUsage = {
  runningRamMb: 0,
  runningCpuCores: 0,
  allocatedDiskMb: 0,
  runningServers: 0,
  totalServers: 0,
};

/**
 * Belegung „nichts läuft" – Platzhalter, bis B3 die Tabelle `game_servers` und
 * damit die echte Zählung mitbringt.
 *
 * Bewusst kein Schätzwert und keine Hilfstabelle in diesem Paket: eine zweite
 * Quelle für die Server-Belegung wäre genau die Parallelstruktur, die
 * CLAUDE.md §3 ausschließt. Solange dieser Platzhalter im Einsatz ist, greift
 * die harte Node-Prüfung rechnerisch immer – sie kann nur nichts abziehen, was
 * bereits läuft.
 */
export function createEmptyServerUsageRepository(): ServerUsageRepository {
  return {
    async usageForUser() {
      return EMPTY_USER_USAGE;
    },

    async usageForUsers() {
      return new Map();
    },

    async usageForNode() {
      return EMPTY_NODE_USAGE;
    },
  };
}
