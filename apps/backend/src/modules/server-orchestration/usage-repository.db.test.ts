/**
 * Zählregel und Advisory-Lock gegen echtes SQL (Audit-Maßnahme W2-28,
 * `test-gaps-04`).
 *
 * `service.test.ts` prüft die Kapazität gegen eine Attrappe, die die Zählregel
 * aus `usage-repository.ts` **nachbaut** – wer die Regel ändert und die Attrappe
 * vergisst, bekommt grüne Tests und einen anders rechnenden Betrieb. Und der
 * Advisory-Lock aus `capacity-reservation.ts` ist ohne Datenbank gar nicht
 * prüfbar: Die Attrappe stellt die Serialisierung selbst her, also beweist sie
 * nur sich selbst.
 *
 * Hier zählt Postgres, und die beiden Reservierungen laufen wirklich
 * gleichzeitig.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`.
 */

import { expect, it } from 'vitest';
import { describeDatenbank } from '../../test-support/db.js';
import {
  legeNodeAn,
  legeNutzerAn,
  legeServerAn,
  setzeKontingent,
} from '../../test-support/fixtures.js';
import { isResourceError } from '../resources/index.js';
import { createDrizzleCapacityReservation } from './capacity-reservation.js';
import { type CreateServerData } from './repository.js';
import { type ResourceCheckRequest } from './resource-guard.js';
import { createDrizzleServerUsageRepository } from './usage-repository.js';

const SCHWELLEN = { nodePercent: 90, serverPercent: 90 };

function warte(millisekunden: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, millisekunden));
}

describeDatenbank('Kapazität gegen PostgreSQL', (kontext) => {
  it('zählt RAM und CPU nur für running und starting, Platte für alle Zustände', async () => {
    const usage = createDrizzleServerUsageRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    // 1024 MiB / 1 Kern / 5000 MiB Platte – laufend, zählt vollständig.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'running',
      resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 5000 },
    });
    // starting zählt mit: der Container läuft dort bereits.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'starting',
      resourceLimits: { ramMb: 2048, cpuCores: 0.5, diskMb: 6000 },
    });
    // stopped belegt nur den Datenordner.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 4096, cpuCores: 2, diskMb: 7000 },
    });
    // creating ebenso – der Ordner steht schon, der Container noch nicht.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'creating',
      resourceLimits: { ramMb: 8192, cpuCores: 4, diskMb: 8000 },
    });

    const belegung = await usage.usageForUser(besitzer);

    expect(belegung).toEqual({
      runningRamMb: 1024 + 2048,
      runningCpuCores: 1.5,
      allocatedDiskMb: 5000 + 6000 + 7000 + 8000,
      runningServers: 2,
      totalServers: 4,
    });
  });

  it('rechnet den zu startenden Server über excludeServerId heraus', async () => {
    const usage = createDrizzleServerUsageRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const eigener = await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 8192, cpuCores: 2, diskMb: 8192 },
    });
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 1024 },
    });

    const ohne = await usage.usageForUser(besitzer, { excludeServerId: eigener });

    expect(ohne.allocatedDiskMb).toBe(1024);
    expect(ohne.totalServers).toBe(1);
  });

  it('zählt je Node und trennt fremde Nodes sauber', async () => {
    const usage = createDrizzleServerUsageRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const nodeA = await legeNodeAn(kontext.db);
    const nodeB = await legeNodeAn(kontext.db);

    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: nodeA,
      status: 'running',
      resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 1000 },
    });
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: nodeB,
      status: 'running',
      resourceLimits: { ramMb: 2048, cpuCores: 2, diskMb: 2000 },
    });

    expect((await usage.usageForNode(nodeA)).runningRamMb).toBe(1024);
    expect((await usage.usageForNode(nodeB)).runningRamMb).toBe(2048);
  });

  it('liefert die Belegung mehrerer Konten in einer Abfrage', async () => {
    const usage = createDrizzleServerUsageRepository(kontext.db);
    const ersterNutzer = await legeNutzerAn(kontext.db);
    const zweiterNutzer = await legeNutzerAn(kontext.db);
    const ohneServer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    await legeServerAn(kontext.db, {
      ownerId: ersterNutzer,
      hostId: node,
      status: 'running',
      resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 1000 },
    });
    await legeServerAn(kontext.db, {
      ownerId: zweiterNutzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 2048, cpuCores: 2, diskMb: 2000 },
    });

    const belegung = await usage.usageForUsers([ersterNutzer, zweiterNutzer, ohneServer]);

    expect(belegung.get(ersterNutzer)?.runningRamMb).toBe(1024);
    expect(belegung.get(zweiterNutzer)?.runningRamMb).toBe(0);
    expect(belegung.get(zweiterNutzer)?.allocatedDiskMb).toBe(2000);
    // Konten ohne Server fehlen in der Map – der Aufrufer liest sie als 0.
    expect(belegung.has(ohneServer)).toBe(false);
    expect(await usage.usageForUsers([])).toEqual(new Map());
  });

  it('lässt eine Reservierung durch, solange die Node Platz hat', async () => {
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 10_000 });

    const angelegt = await reservierung.reserve(anfrage(besitzer, node), async (repository) =>
      repository.create({
        ownerId: besitzer,
        hostId: node,
        name: 'Erster',
        gameType: 'minecraft',
        subdomain: 'erster',
        assignedPorts: [],
        resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 6000 },
        configJson: {},
        startupParameters: '',
        autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
        clonedFromServerId: null,
      }),
    );

    expect(angelegt.status).toBe('creating');
  });

  it('lässt von zwei gleichzeitigen Reservierungen nur eine durch', async () => {
    /*
     * Der Kern von Punkt 98: Beide Vorgänge starten, bevor einer von beiden
     * geschrieben hat. Ohne `pg_advisory_xact_lock` bestünden beide die Prüfung
     * gegen dieselbe (leere) Belegung und die Node wäre überbucht.
     *
     * Gemessen wird am Platzbedarf, nicht am RAM: Ein frisch angelegter Server
     * steht in `creating` und belegt damit laut Zählregel Platte, aber kein RAM.
     */
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 10_000 });

    const ergebnisse = await Promise.allSettled([
      reservierung.reserve(anfrage(besitzer, node), (repository) =>
        repository.create(neuerServer(besitzer, node, 'eins')),
      ),
      reservierung.reserve(anfrage(besitzer, node), (repository) =>
        repository.create(neuerServer(besitzer, node, 'zwei')),
      ),
    ]);

    const erfuellt = ergebnisse.filter((ergebnis) => ergebnis.status === 'fulfilled');
    const abgelehnt = ergebnisse.filter((ergebnis) => ergebnis.status === 'rejected');

    expect(erfuellt).toHaveLength(1);
    expect(abgelehnt).toHaveLength(1);

    const verloren = ergebnisse.find((ergebnis) => ergebnis.status === 'rejected');
    const grund = verloren?.status === 'rejected' ? verloren.reason : undefined;
    expect(isResourceError(grund)).toBe(true);
    expect(isResourceError(grund) ? grund.code : null).toBe('RESOURCE_LIMIT_EXCEEDED');

    // Und in der Datenbank steht genau ein Server – nicht zwei.
    const zeilen = await kontext.roh('select count(*)::int as anzahl from game_servers');
    expect(zeilen[0]?.anzahl).toBe(1);
  });

  it('hält die zweite Reservierung auf, solange die erste ihre Transaktion offen hat', async () => {
    /*
     * Belegt, dass tatsächlich die Sperre wirkt und nicht die zufällige
     * Reihenfolge: Die erste Reservierung bleibt in ihrem Schreibschritt
     * stehen; solange sie das tut, kommt die zweite nicht an ihrem
     * `pg_advisory_xact_lock` vorbei und ist noch nicht fertig.
     */
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 10_000 });

    let freigeben: () => void = () => undefined;
    const gehalten = new Promise<void>((fertig) => {
      freigeben = () => {
        fertig();
      };
    });

    const erste = reservierung.reserve(anfrage(besitzer, node), async (repository) => {
      const server = await repository.create(neuerServer(besitzer, node, 'gehalten'));
      await gehalten;

      return server;
    });

    let zweiteFertig = false;
    const zweite = reservierung
      .reserve(anfrage(besitzer, node), (repository) =>
        repository.create(neuerServer(besitzer, node, 'wartend')),
      )
      .catch((fehler: unknown) => fehler)
      .then((ergebnis) => {
        zweiteFertig = true;

        return ergebnis;
      });

    await warte(300);
    expect(zweiteFertig).toBe(false);

    freigeben();
    await erste;

    const ergebnis = await zweite;
    expect(isResourceError(ergebnis)).toBe(true);
  });

  it('lehnt gegen das Nutzer-Kontingent ab, bevor irgendetwas geschrieben ist', async () => {
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 1_000_000 });
    await setzeKontingent(kontext.db, besitzer, { maxDiskMb: 4000 });

    let geschrieben = false;

    const fehler = await reservierung
      .reserve(anfrage(besitzer, node), async (repository) => {
        geschrieben = true;

        return repository.create(neuerServer(besitzer, node, 'darfnicht'));
      })
      .catch((ursache: unknown) => ursache);

    expect(geschrieben).toBe(false);
    expect(isResourceError(fehler) ? fehler.code : null).toBe('RESOURCE_LIMIT_EXCEEDED');

    const zeilen = await kontext.roh('select count(*)::int as anzahl from game_servers');
    expect(zeilen[0]?.anzahl).toBe(0);
  });
});

/** Anfrage über 6000 MiB Platte – zweimal passt sie nicht auf eine 10-GiB-Node. */
function anfrage(userId: string, hostId: string): ResourceCheckRequest {
  return {
    userId,
    hostId,
    serverId: null,
    requested: { ramMb: 1024, cpuCores: 1, diskMb: 6000 },
    intent: 'create',
  };
}

/** Bauplan eines Servers, der genau die Anfrage aus {@link anfrage} belegt. */
function neuerServer(ownerId: string, hostId: string, subdomain: string): CreateServerData {
  return {
    ownerId,
    hostId,
    name: subdomain,
    gameType: 'minecraft',
    subdomain,
    assignedPorts: [],
    resourceLimits: { ramMb: 1024, cpuCores: 1, diskMb: 6000 },
    configJson: {},
    startupParameters: '',
    autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
    clonedFromServerId: null,
  };
}
