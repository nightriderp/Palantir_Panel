/**
 * Die Kapazitätsprüfung fragt über **eine** Verbindung – nacheinander
 * (Fundpunkt 293).
 *
 * `capacity-reservation.ts` baut den Ressourcen-Service mit Repositories über
 * dem Transaktions-Handle: Prüfung und Schreiben sollen unter einer Sperre
 * zusammenliegen. Eine Transaktion ist genau eine Verbindung, und drei
 * gleichzeitige Abfragen darauf reiht `pg` heute ein und verwarnt
 * („client is already executing a query"); mit `pg@9` wird daraus ein Fehler.
 *
 * Auf der VPS am 14.09.2026 im Betrieb aufgetreten, beim Start eines Servers.
 * Ohne Transaktion – also über dem Pool – war dieselbe Stelle harmlos, weil
 * jede Abfrage ihre eigene Verbindung bekommt. Genau deshalb fällt so etwas in
 * keinem Test auf, der nur das Ergebnis prüft: Dieser hier misst die
 * Gleichzeitigkeit selbst.
 */

import { NO_USER_RESOURCE_LIMITS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import type {
  HostNodeRecord,
  HostNodeRepository,
  ServerUsageRepository,
  UserResourceLimitRepository,
} from './ports.js';
import { createResourceService } from './service.js';

const USER_ID = 'b4e5b6c2-0000-4000-8000-000000000010';
const NODE_ID = 'b4e5b6c2-0000-4000-8000-000000000001';

const NODE: HostNodeRecord = {
  id: NODE_ID,
  name: 'homeserver',
  wireguardIp: '10.10.0.2',
  status: 'online',
  totalResources: { ramMb: 32_768, cpuCores: 16, diskMb: 2_097_152 },
  measuredUsage: null,
};

/**
 * Zählt, wie viele Abfragen gleichzeitig offen sind.
 *
 * Jede Fake-Methode meldet sich an, wartet einen Tick und meldet sich ab. Ohne
 * die Korrektur stünden alle drei zugleich offen; nacheinander bleibt der
 * Höchststand bei eins.
 */
function verbindungsZaehler() {
  let offen = 0;
  let hoechststand = 0;

  return {
    get hoechststand(): number {
      return hoechststand;
    },
    async abfrage<T>(ergebnis: T): Promise<T> {
      offen += 1;
      hoechststand = Math.max(hoechststand, offen);

      // Ein Tick reicht: Danach hätte eine parallel gestartete Abfrage längst
      // ihre eigene Anmeldung hinter sich.
      await new Promise((resolve) => setImmediate(resolve));

      offen -= 1;

      return ergebnis;
    },
  };
}

describe('Kapazitätsprüfung über einer Transaktion (Fundpunkt 293)', () => {
  it('setzt ihre Abfragen nacheinander ab, nicht nebeneinander', async () => {
    const zaehler = verbindungsZaehler();

    const limits: UserResourceLimitRepository = {
      findByUserId: () => zaehler.abfrage(null),
      findManyByUserId: () => zaehler.abfrage(new Map()),
      upsert: () => zaehler.abfrage(null),
      remove: () => zaehler.abfrage(undefined),
    };

    const nodes: HostNodeRepository = {
      findById: () => zaehler.abfrage(NODE),
      listAll: () => zaehler.abfrage([NODE]),
    };

    const usage: ServerUsageRepository = {
      usageForUser: () =>
        zaehler.abfrage({
          runningRamMb: 0,
          runningCpuCores: 0,
          allocatedDiskMb: 0,
          runningServers: 0,
          totalServers: 0,
        }),
      usageForUsers: () => zaehler.abfrage(new Map()),
      usageForNode: () =>
        zaehler.abfrage({
          runningRamMb: 0,
          runningCpuCores: 0,
          allocatedDiskMb: 0,
          runningServers: 0,
          totalServers: 0,
        }),
    };

    const service = createResourceService({
      limits,
      nodes,
      usage,
      thresholds: { nodePercent: 85, serverPercent: 90 },
    });

    const ergebnis = await service.assertStartCapacity({
      ownerId: USER_ID,
      nodeId: NODE_ID,
      requested: { ramMb: 4096, cpuCores: 2, diskMb: 20_480 },
    });

    expect(ergebnis.allowed).toBe(true);
    expect(NO_USER_RESOURCE_LIMITS.maxRamMb).toBeNull();
    expect(zaehler.hoechststand).toBe(1);
  });
});
