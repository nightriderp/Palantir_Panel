/**
 * Belegung durch Gameserver für die Kapazitätsprüfung aus B4 (Pflichtenheft §10).
 *
 * B4 definiert die Schnittstelle `ServerUsageRepository` und schreibt die
 * Zählweise vor; die Zahlen selbst stehen in `game_servers` und damit in B3.
 * Genau deshalb liegt die Umsetzung hier und nicht dort – B4 zählt nicht selbst
 * in einer fremden Tabelle, und B3 baut keine eigene Kapazitätsprüfung.
 *
 * Zählweise (aus `resources/ports.ts`, hier eingehalten):
 * - `running*`: nur Server in `running` **oder** `starting` – sie belegen RAM
 *   und CPU tatsächlich. `starting` zählt mit, weil der Container dort bereits
 *   läuft; ihn auszulassen würde zwei gleichzeitige Starts beide durchwinken.
 * - `allocatedDiskMb`: **alle** Server, unabhängig vom Zustand – der Datenordner
 *   bleibt auch im gestoppten Zustand liegen.
 */

import {
  type NodeResourceUsage,
  type ServerResourceLimits,
  type UserResourceUsage,
} from '@palantir/contracts';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { type DbConnection } from '../../db/client.js';
import { gameServers } from '../../db/schema.js';
import { type ServerUsageRepository, type UsageQueryOptions } from '../resources/index.js';

/** Zustände, in denen ein Server RAM und CPU tatsächlich belegt. */
const CONSUMING_STATUSES = new Set(['running', 'starting']);

interface UsageRow {
  readonly status: string;
  readonly resourceLimits: ServerResourceLimits;
}

function summarize(rows: readonly UsageRow[]): UserResourceUsage & NodeResourceUsage {
  let runningRamMb = 0;
  let runningCpuCores = 0;
  let allocatedDiskMb = 0;
  let runningServers = 0;

  for (const row of rows) {
    allocatedDiskMb += row.resourceLimits.diskMb;

    if (!CONSUMING_STATUSES.has(row.status)) {
      continue;
    }

    runningRamMb += row.resourceLimits.ramMb;
    runningCpuCores += row.resourceLimits.cpuCores;
    runningServers += 1;
  }

  return {
    runningRamMb,
    runningCpuCores,
    allocatedDiskMb,
    runningServers,
    totalServers: rows.length,
  };
}

export function createDrizzleServerUsageRepository(db: DbConnection): ServerUsageRepository {
  async function load(
    column: typeof gameServers.ownerId | typeof gameServers.hostId,
    value: string,
    options: UsageQueryOptions | undefined,
  ): Promise<readonly UsageRow[]> {
    const base = eq(column, value);

    return db
      .select({ status: gameServers.status, resourceLimits: gameServers.resourceLimits })
      .from(gameServers)
      .where(
        options?.excludeServerId === undefined
          ? base
          : and(base, ne(gameServers.id, options.excludeServerId)),
      );
  }

  return {
    async usageForUser(userId: string, options?: UsageQueryOptions): Promise<UserResourceUsage> {
      return summarize(await load(gameServers.ownerId, userId, options));
    },

    /**
     * Belegung mehrerer Nutzer in einer Abfrage (Mockup-Abgleich 12.1.3).
     *
     * Eine Nutzerliste braucht die Belegung je Zeile; einzeln wären das so
     * viele Abfragen wie Zeilen. Gruppiert wird bewusst im Code und nicht in
     * SQL: Die Zählregeln (RAM/CPU nur laufend, Platte über alle) stehen in
     * `summarize` und sollen nicht ein zweites Mal als SQL danebenstehen.
     */
    async usageForUsers(
      userIds: readonly string[],
    ): Promise<ReadonlyMap<string, UserResourceUsage>> {
      const belegung = new Map<string, UserResourceUsage>();

      if (userIds.length === 0) {
        return belegung;
      }

      const rows = await db
        .select({
          ownerId: gameServers.ownerId,
          status: gameServers.status,
          resourceLimits: gameServers.resourceLimits,
        })
        .from(gameServers)
        .where(inArray(gameServers.ownerId, [...userIds]));

      const jeNutzer = new Map<string, typeof rows>();

      for (const row of rows) {
        const vorhandene = jeNutzer.get(row.ownerId);

        if (vorhandene === undefined) {
          jeNutzer.set(row.ownerId, [row]);
        } else {
          vorhandene.push(row);
        }
      }

      for (const [userId, eigene] of jeNutzer) {
        belegung.set(userId, summarize(eigene));
      }

      return belegung;
    },

    async usageForNode(nodeId: string, options?: UsageQueryOptions): Promise<NodeResourceUsage> {
      return summarize(await load(gameServers.hostId, nodeId, options));
    },
  };
}
