/**
 * Serialisierte Kapazitätsreservierung (Pflichtenheft §10, WORK_STATUS.md Punkt 98).
 *
 * Schließt das TOCTOU-Fenster der Kapazitätsprüfung: Bisher las
 * `assertResourcesAvailable` die Belegung, und der Insert bzw. der Wechsel auf
 * `starting` folgte in einer getrennten Anweisung. Zwei gleichzeitige
 * Create/Start-Vorgänge derselben Node bestanden so beide die Prüfung und
 * überbuchten die Node- bzw. Nutzer-Kapazität.
 *
 * Diese Umsetzung führt Prüfung **und** belegende Schreiboperation in **einer**
 * Transaktion zusammen und serialisiert sie über zwei PostgreSQL-Advisory-Locks
 * (`pg_advisory_xact_lock`) – einen je Node und einen je Nutzer. Der Lock wird
 * am Transaktionsende automatisch freigegeben. Erst danach kommt eine zweite
 * Reservierung an die Prüfung – und sieht die inzwischen geschriebene Belegung.
 *
 * Es entsteht **keine** zweite Kapazitätslogik: geprüft wird weiterhin über B4
 * (`createResourceService` / `checkCapacity`), nur eben gegen die
 * transaktionsgebundenen Repositories. Hier kommt allein der transaktionale
 * Rahmen dazu (CLAUDE.md §3/§4).
 */

import { type ResourceWarningThresholds } from '@palantir/contracts';
import { sql } from 'drizzle-orm';
import { type Database } from '../../db/client.js';
import { createResourceService } from '../resources/index.js';
import {
  createDrizzleHostNodeRepository,
  createDrizzleUserResourceLimitRepository,
} from '../resources/repository.js';
import { createDrizzleServerRepository } from './repository.js';
import {
  type CapacityReservation,
  assertResourcesAvailable,
  createResourceGuardFromService,
} from './resource-guard.js';
import { createDrizzleServerUsageRepository } from './usage-repository.js';

/**
 * Klassen-Ids für die beiden Advisory-Lock-Räume.
 *
 * `pg_advisory_xact_lock(classId, objId)` trennt Node- und Nutzer-Sperren, damit
 * eine Node und ein zufällig gleich gehashter Nutzer sich nicht gegenseitig
 * blockieren.
 */
const NODE_LOCK_CLASS = 1;
const USER_LOCK_CLASS = 2;

export function createDrizzleCapacityReservation(
  db: Database,
  thresholds: ResourceWarningThresholds,
): CapacityReservation {
  return {
    async reserve(request, write) {
      return db.transaction(async (tx) => {
        // Immer erst die Node-, dann die Nutzer-Sperre – eine feste Reihenfolge
        // schließt eine Verklemmung zwischen zwei Reservierungen aus. `hashtext`
        // bildet die UUID auf den int4 ab, den der Lock erwartet; eine seltene
        // Kollision serialisiert nur unnötig, sie verfälscht nie eine Prüfung.
        await tx.execute(
          sql`select pg_advisory_xact_lock(${NODE_LOCK_CLASS}, hashtext(${request.hostId}))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(${USER_LOCK_CLASS}, hashtext(${request.userId}))`,
        );

        const guard = createResourceGuardFromService(
          createResourceService({
            limits: createDrizzleUserResourceLimitRepository(tx),
            nodes: createDrizzleHostNodeRepository(tx),
            usage: createDrizzleServerUsageRepository(tx),
            thresholds,
          }),
        );

        // Wirft bei Ablehnung `RESOURCE_LIMIT_EXCEEDED` und rollt die Transaktion
        // damit zurück, bevor irgendetwas geschrieben ist.
        await assertResourcesAvailable(guard, request);

        return write(createDrizzleServerRepository(tx));
      });
    },
  };
}
