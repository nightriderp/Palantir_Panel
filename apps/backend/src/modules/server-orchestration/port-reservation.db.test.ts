/**
 * Portvergabe innerhalb der Reservierungs-Transaktion gegen echtes PostgreSQL
 * (Fundpunkt 135, Rest von backend-db-04 aus W2-10).
 *
 * Bis hierher lag die Vergabe **außerhalb** der Transaktion, in der der Server
 * entsteht: `PortPoolService.allocateForServer()` fängt die Kollision zweier
 * paralleler Vergaben über die Unique-Verletzung des Index ab und versucht den
 * nächsten freien Port – und ein Constraint-Fehler bricht innerhalb einer
 * Transaktion die ganze Transaktion ab. Seit die Drizzle-Umsetzung jeden
 * Einfügeversuch in einen eigenen Savepoint stellt, geht beides zusammen.
 *
 * Ohne Datenbank ist das nicht zu belegen: Das Blockieren am Unique-Index, der
 * `SQLSTATE 23505` beim Commit des Gegenübers und das Zurückrollen auf den
 * Savepoint sind Verhalten des Servers. Eine Attrappe stellt es selbst her und
 * beweist damit nur sich selbst. Der Mechanismus als solcher ist zusätzlich
 * ohne Datenbank geprüft (`admin/ports-savepoint.test.ts`).
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { expect, it } from 'vitest';
import { type DbConnection } from '../../db/client.js';
import { portAllocations, portRanges } from '../../db/schema/admin.js';
import { describeDatenbank } from '../../test-support/db.js';
import { legeNodeAn, legeNutzerAn } from '../../test-support/fixtures.js';
import { createAuditService } from '../admin/audit.js';
import { createPortPoolService } from '../admin/ports.js';
import {
  createDrizzleAuditLogRepository,
  createDrizzlePortPoolRepository,
} from '../admin/repositories.js';
import { createDrizzleCapacityReservation } from './capacity-reservation.js';
import { createGameRegistry } from './game-registry.js';
import { type PortPoolPort } from './ports.js';
import { type CreateServerData } from './repository.js';
import { type ResourceCheckRequest } from './resource-guard.js';

const SCHWELLEN = { nodePercent: 90, serverPercent: 90 };

/** Ein Spiel mit genau einem TCP-Port und ohne Hostname-Routing. */
const SPIEL = createGameRegistry(1).require('test-echo');

function warte(millisekunden: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, millisekunden));
}

/**
 * Der Port-Pool aus B8 über einer beliebigen Verbindung – dieselbe Fabrik, die
 * `server.ts` als `AdminModule.portPoolFor` herüberreicht.
 */
function portPoolFor(verbindung: DbConnection): PortPoolPort {
  return createPortPoolService({
    repository: createDrizzlePortPoolRepository(verbindung),
    audit: createAuditService(createDrizzleAuditLogRepository(verbindung)),
  });
}

describeDatenbank('Portvergabe in der Reservierung', (kontext) => {
  /** Ein ungebundener TCP-Bereich – beide Nodes vergeben daraus. */
  async function legeBereichAn(vonPort: number, bisPort: number): Promise<void> {
    await kontext.db.insert(portRanges).values({
      label: 'Testbereich',
      startPort: vonPort,
      endPort: bisPort,
      protocol: 'tcp',
      nodeId: null,
      enabled: true,
    });
  }

  it('gibt zwei gleichzeitigen Vergaben aus demselben Bereich verschiedene Ports', async () => {
    /*
     * Der eigentliche Fall: Zwei Vorgänge greifen auf denselben Bereich zu,
     * ohne voneinander zu wissen. Node- und Nutzer-Sperre der Reservierung
     * greifen hier **nicht** – zwei verschiedene Nodes, zwei verschiedene
     * Konten. Genau dann entscheidet der Unique-Index.
     *
     * Die Reihenfolge wird erzwungen, statt sie dem Zufall zu überlassen: Der
     * erste Vorgang hält seine Transaktion offen, nachdem er Port 27000
     * eingefügt hat. Der zweite sieht diese Zeile nicht (sie ist nicht
     * festgeschrieben), wählt ebenfalls 27000 – und bleibt am Index hängen, bis
     * der erste festschreibt. Dann bekommt er 23505, rollt auf seinen Savepoint
     * zurück und nimmt 27001. Ohne Savepoint wäre seine Transaktion an dieser
     * Stelle abgebrochen.
     */
    await legeBereichAn(27_000, 27_009);

    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, portPoolFor);
    const nutzerA = await legeNutzerAn(kontext.db);
    const nutzerB = await legeNutzerAn(kontext.db);
    const nodeA = await legeNodeAn(kontext.db);
    const nodeB = await legeNodeAn(kontext.db);

    let freigeben: () => void = () => undefined;
    const gehalten = new Promise<void>((fertig) => {
      freigeben = () => {
        fertig();
      };
    });

    let ersterHatVergeben: () => void = () => undefined;
    const ersteVergabe = new Promise<void>((fertig) => {
      ersterHatVergeben = () => {
        fertig();
      };
    });

    const erste = reservierung.reserve(anfrage(nutzerA, nodeA), async ({ servers, ports }) => {
      const server = await servers.create(neuerServer(nutzerA, nodeA, 'eins'));
      const zugewiesen = await ports.allocate(server.id, SPIEL, {
        nodeId: nodeA,
        virtualHostPort: null,
      });

      ersterHatVergeben();
      await gehalten;

      return zugewiesen;
    });

    await ersteVergabe;

    const zweite = reservierung.reserve(anfrage(nutzerB, nodeB), async ({ servers, ports }) => {
      const server = await servers.create(neuerServer(nutzerB, nodeB, 'zwei'));

      return ports.allocate(server.id, SPIEL, { nodeId: nodeB, virtualHostPort: null });
    });

    // Der zweite hängt jetzt am Unique-Index des ersten. Erst das Freigeben
    // löst ihn – als Kollision, nicht als Sieg.
    await warte(200);
    freigeben();

    const [ersteZuweisung, zweiteZuweisung] = await Promise.all([erste, zweite]);

    expect(ersteZuweisung[0]?.publicPort).toBe(27_000);
    expect(zweiteZuweisung[0]?.publicPort).toBe(27_001);

    const zeilen = await kontext.roh('select port from port_allocations order by port');
    expect(zeilen.map((zeile) => zeile.port)).toEqual([27_000, 27_001]);
  });

  it('lässt nach einem gescheiterten Anlegen keinen vergebenen Port zurück', async () => {
    /*
     * Der Gewinn des Umbaus: Vorher standen Datensatz und Portvergabe in
     * getrennten Transaktionen, und ein Fehler dazwischen hinterließ eine
     * belegte Zuordnung, die erst ein Aufräumschritt wieder losgeworden ist.
     * Jetzt nimmt der Rollback beides mit – den Server, die Ports und den
     * Audit-Eintrag über die Vergabe.
     */
    await legeBereichAn(27_000, 27_009);

    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, portPoolFor);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const fehler = await reservierung
      .reserve(anfrage(besitzer, node), async ({ servers, ports }) => {
        const server = await servers.create(neuerServer(besitzer, node, 'scheitert'));
        await ports.allocate(server.id, SPIEL, { nodeId: node, virtualHostPort: null });

        throw new Error('Anlegen abgebrochen');
      })
      .catch((ursache: unknown) => ursache);

    expect((fehler as Error).message).toBe('Anlegen abgebrochen');

    const [server] = await kontext.roh('select count(*)::int as anzahl from game_servers');
    const [zuordnungen] = await kontext.roh('select count(*)::int as anzahl from port_allocations');
    const [protokoll] = await kontext.roh(
      "select count(*)::int as anzahl from audit_log where action = 'address.portAllocated'",
    );

    expect(server?.anzahl).toBe(0);
    expect(zuordnungen?.anzahl).toBe(0);
    // Der Audit-Eintrag geht mit zurück: Er behauptete sonst eine Vergabe, die
    // nie bestanden hat – mit `targetId` auf einen Server, den es nie gab.
    expect(protokoll?.anzahl).toBe(0);
  });

  it('schreibt bei Erfolg Server, Ports und Audit-Eintrag gemeinsam fest', async () => {
    await legeBereichAn(27_000, 27_009);

    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, portPoolFor);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const zugewiesen = await reservierung.reserve(
      anfrage(besitzer, node),
      async ({ servers, ports }) => {
        const server = await servers.create(neuerServer(besitzer, node, 'erfolgreich'));

        return ports.allocate(server.id, SPIEL, { nodeId: node, virtualHostPort: null });
      },
    );

    expect(zugewiesen[0]?.publicPort).toBe(27_000);

    const zuordnungen = await kontext.db.select().from(portAllocations);
    const [protokoll] = await kontext.roh(
      "select count(*)::int as anzahl from audit_log where action = 'address.portAllocated'",
    );

    expect(zuordnungen).toHaveLength(1);
    expect(zuordnungen[0]?.serverId).not.toBeNull();
    expect(protokoll?.anzahl).toBe(1);
  });
});

/** Anfrage, die auf einer Vorgabe-Node bequem Platz hat. */
function anfrage(userId: string, hostId: string): ResourceCheckRequest {
  return {
    userId,
    hostId,
    serverId: null,
    requested: { ramMb: 1024, cpuCores: 1, diskMb: 6000 },
    intent: 'create',
  };
}

function neuerServer(ownerId: string, hostId: string, subdomain: string): CreateServerData {
  return {
    ownerId,
    hostId,
    name: subdomain,
    gameType: SPIEL.id,
    subdomain,
    assignedPorts: [],
    resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 6000 },
    configJson: {},
    startupParameters: '',
    autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
    clonedFromServerId: null,
  };
}
