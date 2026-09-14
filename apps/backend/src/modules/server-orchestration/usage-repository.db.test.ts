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
import { type CreateServerData, type ServerRepository } from './repository.js';
import { type ResourceCheckRequest } from './resource-guard.js';
import { createDrizzleServerUsageRepository } from './usage-repository.js';

const SCHWELLEN = { nodePercent: 90, serverPercent: 90 };

function warte(millisekunden: number): Promise<void> {
  return new Promise((fertig) => setTimeout(fertig, millisekunden));
}

/**
 * Port-Pool-Attrappe für die Reservierung.
 *
 * Diese Suite prüft Zählregel und Advisory-Lock; die Portvergabe innerhalb der
 * Transaktion (Fundpunkt 135) hat mit `port-allocation.db.test.ts` eine eigene.
 * Eine echte Vergabe hier hieße nur, jeden Testfall zusätzlich mit
 * Port-Bereichen auszustatten.
 */
function ohnePortvergabe(): {
  allocateForServer: () => Promise<never[]>;
  releaseForServer: () => Promise<number>;
} {
  return {
    allocateForServer: async () => [],
    releaseForServer: async () => 0,
  };
}

describeDatenbank('Kapazität gegen PostgreSQL', (kontext) => {
  it('zählt RAM nur für running und starting, die Server selbst für alle Zustände', async () => {
    const usage = createDrizzleServerUsageRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    // 1024 MiB zugewiesen – laufend, zählt vollständig.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'running',
      resourceLimits: { ramMb: 1024 },
    });
    // starting zählt mit: der Container läuft dort bereits.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'starting',
      resourceLimits: { ramMb: 2048 },
    });
    // stopped belegt kein RAM – der Container läuft nicht.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 4096 },
    });
    // creating ebenso – der Datensatz steht schon, der Container noch nicht.
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'creating',
      resourceLimits: { ramMb: 8192 },
    });

    const belegung = await usage.usageForUser(besitzer);

    expect(belegung).toEqual({
      runningRamMb: 1024 + 2048,
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
      resourceLimits: { ramMb: 8192 },
    });
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 1024 },
    });

    const ohne = await usage.usageForUser(besitzer, { excludeServerId: eigener });

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
      resourceLimits: { ramMb: 1024 },
    });
    await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: nodeB,
      status: 'running',
      resourceLimits: { ramMb: 2048 },
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
      resourceLimits: { ramMb: 1024 },
    });
    await legeServerAn(kontext.db, {
      ownerId: zweiterNutzer,
      hostId: node,
      status: 'stopped',
      resourceLimits: { ramMb: 2048 },
    });

    const belegung = await usage.usageForUsers([ersterNutzer, zweiterNutzer, ohneServer]);

    expect(belegung.get(ersterNutzer)?.runningRamMb).toBe(1024);
    expect(belegung.get(zweiterNutzer)?.runningRamMb).toBe(0);
    // Konten ohne Server fehlen in der Map – der Aufrufer liest sie als 0.
    expect(belegung.has(ohneServer)).toBe(false);
    expect(await usage.usageForUsers([])).toEqual(new Map());
  });

  it('lässt eine Reservierung durch, solange die Node Platz hat', async () => {
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, ohnePortvergabe);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 10_000 });

    const angelegt = await reservierung.reserve(anfrage(besitzer, node), async ({ servers }) =>
      servers.create(neuerServer(besitzer, node, 'erster')),
    );

    expect(angelegt.status).toBe('creating');
  });

  it('lässt von zwei gleichzeitigen Starts nur einen durch', async () => {
    /*
     * Der Kern von Punkt 98: Beide Vorgänge prüfen, bevor einer von beiden
     * geschrieben hat. Ohne `pg_advisory_xact_lock` bestünden beide die Prüfung
     * gegen dieselbe (leere) Belegung und das Kontingent wäre überbucht.
     *
     * Gemessen wird am Kontingent „gleichzeitig laufende Server", und der
     * Anlass ist deshalb der **Start**, nicht das Anlegen: Seit die Platte
     * nicht mehr zugewiesen, sondern gemessen wird, prüft das Anlegen allein
     * den freien Platz der Node – und den ändert kein Datensatz, den eine
     * Reservierung schreibt. Zwei gleichzeitige Anlegevorgänge sind damit gar
     * kein Wettlauf mehr. Der Start dagegen schreibt `starting`, und genau das
     * sieht die zweite Reservierung, sobald sie an die Sperre kommt.
     */
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, ohnePortvergabe);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 10_000 });
    await setzeKontingent(kontext.db, besitzer, { maxConcurrentServers: 1 });

    const eins = await legeServerAn(kontext.db, gestoppt(besitzer, node));
    const zwei = await legeServerAn(kontext.db, gestoppt(besitzer, node));

    const ergebnisse = await Promise.allSettled([
      reservierung.reserve(startAnfrage(besitzer, node, eins), ({ servers }) =>
        starte(servers, eins),
      ),
      reservierung.reserve(startAnfrage(besitzer, node, zwei), ({ servers }) =>
        starte(servers, zwei),
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

    // Und in der Datenbank steht genau ein startender Server – nicht zwei.
    const zeilen = await kontext.roh(
      "select count(*)::int as anzahl from game_servers where status = 'starting'",
    );
    expect(zeilen[0]?.anzahl).toBe(1);
  });

  it('hält die zweite Reservierung auf, solange die erste ihre Transaktion offen hat', async () => {
    /*
     * Belegt, dass tatsächlich die Sperre wirkt und nicht die zufällige
     * Reihenfolge: Die erste Reservierung bleibt in ihrem Schreibschritt
     * stehen; solange sie das tut, kommt die zweite nicht an ihrem
     * `pg_advisory_xact_lock` vorbei und ist noch nicht fertig.
     *
     * Die zweite Reservierung startet deshalb erst, wenn die erste ihre Sperre
     * nachweislich hält (`haeltSperre`). Ohne dieses Signal war der Test
     * flatterhaft: Beide Reservierungen liefen los, und wenn die zweite den
     * Zuschlag zuerst bekam, war sie längst fertig, bevor die Wartezeit unten
     * ablief – der Test scheiterte dann an der Reihenfolge, nicht an der
     * Sperre.
     */
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, ohnePortvergabe);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 10_000 });
    await setzeKontingent(kontext.db, besitzer, { maxConcurrentServers: 1 });

    const gehaltener = await legeServerAn(kontext.db, gestoppt(besitzer, node));
    const wartender = await legeServerAn(kontext.db, gestoppt(besitzer, node));

    let freigeben: () => void = () => undefined;
    const gehalten = new Promise<void>((fertig) => {
      freigeben = () => {
        fertig();
      };
    });

    let sperreErreicht: () => void = () => undefined;
    const haeltSperre = new Promise<void>((fertig) => {
      sperreErreicht = () => {
        fertig();
      };
    });

    const erste = reservierung.reserve(
      startAnfrage(besitzer, node, gehaltener),
      async ({ servers }) => {
        await starte(servers, gehaltener);
        sperreErreicht();
        await gehalten;
      },
    );

    // Ab hier steht fest: Die erste Reservierung ist in ihrer Transaktion und
    // hält die Sperre. Alles Weitere misst die Sperre, nicht das Wettrennen.
    await haeltSperre;

    let zweiteFertig = false;
    const zweite = reservierung
      .reserve(startAnfrage(besitzer, node, wartender), ({ servers }) => starte(servers, wartender))
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
    const reservierung = createDrizzleCapacityReservation(kontext.db, SCHWELLEN, ohnePortvergabe);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db, { totalDiskMb: 1_000_000 });
    await setzeKontingent(kontext.db, besitzer, { maxRamMb: 512 });

    const server = await legeServerAn(kontext.db, gestoppt(besitzer, node));

    let geschrieben = false;

    const fehler = await reservierung
      .reserve(startAnfrage(besitzer, node, server), async ({ servers }) => {
        geschrieben = true;

        await starte(servers, server);
      })
      .catch((ursache: unknown) => ursache);

    expect(geschrieben).toBe(false);
    expect(isResourceError(fehler) ? fehler.code : null).toBe('RESOURCE_LIMIT_EXCEEDED');

    // Der Server steht unverändert da, wo er stand.
    const zeilen = await kontext.roh('select status from game_servers');
    expect(zeilen[0]?.status).toBe('stopped');
  });
});

/** Anfrage über 6000 MiB Platte – zweimal passt sie nicht auf eine 10-GiB-Node. */
function anfrage(userId: string, hostId: string): ResourceCheckRequest {
  return {
    userId,
    hostId,
    serverId: null,
    requested: { ramMb: 1024, diskMb: 6000 },
    intent: 'create',
  };
}

/**
 * Dieselbe Anfrage, nur als Start eines vorhandenen Servers.
 *
 * `serverId` ist nicht Beiwerk: Die Prüfung rechnet den Server, um den es geht,
 * aus der Belegung heraus – sonst zählte seine eigene Zuweisung gegen ihn.
 */
function startAnfrage(userId: string, hostId: string, serverId: string): ResourceCheckRequest {
  return {
    userId,
    hostId,
    serverId,
    requested: { ramMb: 1024, diskMb: 6000 },
    intent: 'start',
  };
}

/** Ein gestoppter Server mit genau der Zuweisung aus {@link startAnfrage}. */
function gestoppt(
  ownerId: string,
  hostId: string,
): { ownerId: string; hostId: string; status: 'stopped'; resourceLimits: { ramMb: number } } {
  return { ownerId, hostId, status: 'stopped', resourceLimits: { ramMb: 1024 } };
}

/**
 * Der Schreibschritt eines Starts – derselbe, den der Dienst über
 * `applyTransition` ausführt: `stopped` → `starting`, und nur von dort aus.
 */
function starte(servers: ServerRepository, id: string): Promise<void> {
  const jetzt = new Date().toISOString();

  return servers.persistLifecycle(
    id,
    {
      status: 'starting',
      statusMessage: null,
      statusChangedAt: jetzt,
      lastStartedAt: jetzt,
      crashTimestamps: [],
    },
    'stopped',
  );
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
    resourceLimits: { ramMb: 1024 },
    configJson: {},
    startupParameters: '',
    autoShutdown: { enabled: false, idleTimeoutMinutes: 30, graceMinutes: 10 },
    clonedFromServerId: null,
  };
}
