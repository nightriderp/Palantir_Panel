/**
 * `ServerRepository` gegen echtes SQL (Audit-Maßnahme W2-28, `test-gaps-05`).
 *
 * Die fachlichen Abläufe prüft `service.test.ts` gegen eine Attrappe. Was dort
 * grundsätzlich nicht auffallen kann, sind Fehler in den Abfragen selbst: der
 * Sichtbarkeitsfilter aus `listByOwnerOrMembership` (ein `and` statt `or`, das
 * leere `inArray`), das bedingte `UPDATE` von `persistLifecycle`, der
 * `onConflict`-Zweig beim Anheften und beim Mitglied, die `left join`s der
 * Grundabfrage. Genau diese Stellen stehen hier – ohne Attrappe.
 *
 * Läuft nur mit `DATABASE_URL` **und** `PALANTIR_TEST_DB=1`; sonst wird die
 * Suite mit Grund übersprungen (siehe `src/test-support/db.ts`).
 */

import { expect, it } from 'vitest';
import { describeDatenbank } from '../../test-support/db.js';
import {
  legeMitgliedAn,
  legeNodeAn,
  legeNutzerAn,
  legeServerAn,
} from '../../test-support/fixtures.js';
import { ServerOrchestrationError } from './errors.js';
import { createDrizzleServerRepository } from './repository.js';

describeDatenbank('ServerRepository gegen PostgreSQL', (kontext) => {
  it('liefert Besitzer- und Node-Namen aus den beiden left joins', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db, { displayName: 'Besitzerin' });
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });

    const geladen = await repository.findById(serverId);

    expect(geladen?.ownerDisplayName).toBe('Besitzerin');
    expect(geladen?.hostName).not.toBeNull();
    // Zeitstempel kommen als ISO-Zeichenketten heraus, nicht als Date.
    expect(geladen?.statusChangedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('findet nichts zu einer unbekannten Id', async () => {
    const repository = createDrizzleServerRepository(kontext.db);

    expect(await repository.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('zeigt einem Konto ohne Mitgliedschaft nur die eigenen Server', async () => {
    /*
     * Der Zweig ohne Mitgliedschaften ist der gefährliche: `inArray(id, [])`
     * wirft in Drizzle, deshalb baut das Repository die Bedingung dort anders
     * zusammen. Ohne diesen Test bliebe der Zweig unbelegt.
     */
    const repository = createDrizzleServerRepository(kontext.db);
    const eigen = await legeNutzerAn(kontext.db);
    const fremd = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const eigener = await legeServerAn(kontext.db, { ownerId: eigen, hostId: node });
    await legeServerAn(kontext.db, { ownerId: fremd, hostId: node });

    const sichtbar = await repository.listByOwnerOrMembership(eigen);

    expect(sichtbar.map((server) => server.id)).toEqual([eigener]);
  });

  it('zeigt zusätzlich die Server, auf denen das Konto Mitglied ist', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const eigen = await legeNutzerAn(kontext.db);
    const fremd = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const eigener = await legeServerAn(kontext.db, { ownerId: eigen, hostId: node });
    const fremderMitMitgliedschaft = await legeServerAn(kontext.db, {
      ownerId: fremd,
      hostId: node,
    });
    const fremderOhne = await legeServerAn(kontext.db, { ownerId: fremd, hostId: node });
    await legeMitgliedAn(kontext.db, fremderMitMitgliedschaft, eigen, 'operator');

    const sichtbar = await repository.listByOwnerOrMembership(eigen);
    const ids = sichtbar.map((server) => server.id).sort();

    expect(ids).toEqual([eigener, fremderMitMitgliedschaft].sort());
    expect(ids).not.toContain(fremderOhne);
  });

  it('erkennt eine belegte Subdomain und lässt den eigenen Server außen vor', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      subdomain: 'belegt',
    });

    expect(await repository.isSubdomainTaken('belegt')).toBe(true);
    expect(await repository.isSubdomainTaken('belegt', serverId)).toBe(false);
    expect(await repository.isSubdomainTaken('frei')).toBe(false);
  });

  it('legt einen Server im Zustand creating an und liest ihn unmittelbar wieder', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    const angelegt = await repository.create({
      ownerId: besitzer,
      hostId: node,
      name: 'Frisch',
      gameType: 'minecraft',
      subdomain: 'frisch',
      assignedPorts: [
        {
          publicPort: 30_000,
          containerPort: 25_565,
          protocol: 'tcp',
          label: 'Spiel-Port',
          primary: true,
        },
      ],
      resourceLimits: { ramMb: 4096, cpuCores: 2, diskMb: 20_480 },
      configJson: { motd: 'Hallo' },
      startupParameters: '-Xmx4G',
      autoShutdown: { enabled: true, idleTimeoutMinutes: 15, graceMinutes: 5 },
      clonedFromServerId: null,
    });

    expect(angelegt.status).toBe('creating');
    // Die jsonb-Spalten müssen unverändert zurückkommen.
    expect(angelegt.assignedPorts).toEqual([
      {
        publicPort: 30_000,
        containerPort: 25_565,
        protocol: 'tcp',
        label: 'Spiel-Port',
        primary: true,
      },
    ]);
    expect(angelegt.configJson).toEqual({ motd: 'Hallo' });
    expect(angelegt.autoShutdown.idleTimeoutMinutes).toBe(15);
  });

  it('schreibt beim Teil-Update nur die angegebenen Felder fort', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      name: 'Alt',
    });

    await repository.update(serverId, { dockerContainerId: 'container-1' });
    const nachher = await repository.findById(serverId);

    expect(nachher?.dockerContainerId).toBe('container-1');
    expect(nachher?.name).toBe('Alt');
  });

  it('findet einen Server über seine Container-Id', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });

    await repository.update(serverId, { dockerContainerId: 'abc123' });

    expect((await repository.findByContainerId('abc123'))?.id).toBe(serverId);
    expect(await repository.findByContainerId('gibtesnicht')).toBeNull();
  });

  it('schreibt den Zustandswechsel nur aus dem erwarteten Zustand heraus fort', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'stopped',
    });

    const wechsel = {
      status: 'starting' as const,
      statusMessage: null,
      statusChangedAt: new Date().toISOString(),
      lastStartedAt: null,
      crashTimestamps: [],
    };

    await repository.persistLifecycle(serverId, wechsel, 'stopped');
    expect((await repository.findById(serverId))?.status).toBe('starting');

    // Zweiter Versuch aus demselben (inzwischen überholten) Zustand heraus.
    await expect(repository.persistLifecycle(serverId, wechsel, 'stopped')).rejects.toThrow(
      ServerOrchestrationError,
    );
  });

  it('meldet den Konflikt mit dem Katalog-Code SERVER_STATE_CONFLICT', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'running',
    });

    const fehler = await repository
      .persistLifecycle(
        serverId,
        {
          status: 'stopped',
          statusMessage: null,
          statusChangedAt: new Date().toISOString(),
          lastStartedAt: null,
          crashTimestamps: [],
        },
        'stopped',
      )
      .catch((ursache: unknown) => ursache);

    expect(fehler).toBeInstanceOf(ServerOrchestrationError);
    expect((fehler as ServerOrchestrationError).code).toBe('SERVER_STATE_CONFLICT');
  });

  it('hält die Absturz-Zeitpunkte als Textfeld-Array fest', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, {
      ownerId: besitzer,
      hostId: node,
      status: 'running',
    });

    const zeitpunkte = ['2026-01-01T00:00:00.000Z', '2026-01-01T00:05:00.000Z'];

    await repository.persistLifecycle(
      serverId,
      {
        status: 'error',
        statusMessage: 'Absturzschleife',
        statusChangedAt: new Date().toISOString(),
        lastStartedAt: null,
        crashTimestamps: zeitpunkte,
      },
      'running',
    );

    expect((await repository.findById(serverId))?.crashTimestamps).toEqual(zeitpunkte);
  });

  it('zählt die Server je Besitzer und lässt Konten ohne Server weg', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const mitZwei = await legeNutzerAn(kontext.db);
    const ohne = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);

    await legeServerAn(kontext.db, { ownerId: mitZwei, hostId: node });
    await legeServerAn(kontext.db, { ownerId: mitZwei, hostId: node });

    const anzahl = await repository.countByOwners([mitZwei, ohne]);

    expect(anzahl.get(mitZwei)).toBe(2);
    expect(anzahl.has(ohne)).toBe(false);
    expect(await repository.countByOwners([])).toEqual(new Map());
  });

  it('heftet einen Server an, ohne beim zweiten Mal zu scheitern', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const nutzer = await legeNutzerAn(kontext.db);
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: nutzer, hostId: node });

    await repository.pinServer(nutzer, serverId);
    await repository.pinServer(nutzer, serverId);

    expect([...(await repository.listPinnedServerIds(nutzer))]).toEqual([serverId]);

    await repository.unpinServer(nutzer, serverId);
    expect((await repository.listPinnedServerIds(nutzer)).size).toBe(0);

    // Ein nicht angehefteter Server ist beim Lösen kein Fehler.
    await expect(repository.unpinServer(nutzer, serverId)).resolves.toBeUndefined();
  });

  /*
   * Fundpunkt 231: Die Serverliste baute je Server eine eigene
   * Mitglieder-Abfrage - bei neun Servern zehn Abfragen. Die Sammelabfrage
   * liefert dieselbe Auskunft in einer Runde.
   */
  it('liefert die Mitglieder mehrerer Server in einer Abfrage', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const mitglied = await legeNutzerAn(kontext.db, { displayName: 'Mitspielerin' });
    const node = await legeNodeAn(kontext.db);
    const mitMitglied = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });
    const ohneMitglied = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });

    await repository.upsertMember(mitMitglied, mitglied, 'manager');

    const karte = await repository.listMembersOf([mitMitglied, ohneMitglied]);

    expect(karte.get(mitMitglied)).toHaveLength(1);
    expect(karte.get(mitMitglied)?.[0]?.displayName).toBe('Mitspielerin');
    // Server ohne Mitglieder fehlen in der Karte - der Aufrufer liest sie als
    // leere Liste.
    expect(karte.get(ohneMitglied)).toBeUndefined();
    // Dieselbe Auskunft wie die Einzelabfrage.
    expect(karte.get(mitMitglied)).toEqual(await repository.listMembers(mitMitglied));
  });

  it('fragt ohne Server-Ids gar nicht erst nach', async () => {
    const repository = createDrizzleServerRepository(kontext.db);

    expect((await repository.listMembersOf([])).size).toBe(0);
  });

  it('ersetzt die Stufe eines vorhandenen Mitglieds statt eine zweite Zeile anzulegen', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const besitzer = await legeNutzerAn(kontext.db);
    const mitglied = await legeNutzerAn(kontext.db, { displayName: 'Mitspielerin' });
    const node = await legeNodeAn(kontext.db);
    const serverId = await legeServerAn(kontext.db, { ownerId: besitzer, hostId: node });

    await repository.upsertMember(serverId, mitglied, 'viewer');
    await repository.upsertMember(serverId, mitglied, 'manager');

    const mitglieder = await repository.listMembers(serverId);

    expect(mitglieder).toHaveLength(1);
    expect(mitglieder[0]?.level).toBe('manager');
    // Der Anzeigename kommt aus dem inner join auf `users`.
    expect(mitglieder[0]?.displayName).toBe('Mitspielerin');
    expect(await repository.memberLevel(serverId, mitglied)).toBe('manager');

    await repository.removeMember(serverId, mitglied);
    expect(await repository.memberLevel(serverId, mitglied)).toBeNull();
  });

  it('setzt eine Node auf online und lässt eine Wartung unangetastet', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const offline = await legeNodeAn(kontext.db, { status: 'offline' });
    const wartung = await legeNodeAn(kontext.db, { status: 'maintenance' });

    await repository.markHostConnected(offline);
    await repository.markHostConnected(wartung);

    expect((await repository.findHost(offline))?.status).toBe('online');
    expect((await repository.findHost(wartung))?.status).toBe('maintenance');

    await repository.markHostDisconnected(offline);
    await repository.markHostDisconnected(wartung);

    expect((await repository.findHost(offline))?.status).toBe('offline');
    expect((await repository.findHost(wartung))?.status).toBe('maintenance');
  });

  it('übernimmt gemessene Ressourcen und lässt alte Messwerte stehen, wenn keine mitkommen', async () => {
    const repository = createDrizzleServerRepository(kontext.db);
    const node = await legeNodeAn(kontext.db);

    await repository.updateMeasuredResources(node, {
      ramMb: 16_384,
      cpuCores: 4,
      diskMb: 500_000,
      usage: {
        ramAvailableMb: 8192,
        diskAvailableMb: 250_000,
        cpuLoad1m: 1.25,
        observedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await repository.updateMeasuredResources(node, {
      ramMb: 16_384,
      cpuCores: 4,
      diskMb: 600_000,
    });

    const [zeile] = await kontext.roh(
      'select total_disk_mb, measured_ram_available_mb, measured_cpu_load_1m from host_nodes where id = $1',
      [node],
    );

    expect(zeile?.total_disk_mb).toBe(600_000);
    expect(zeile?.measured_ram_available_mb).toBe(8192);
    expect(zeile?.measured_cpu_load_1m).toBe(1.25);
  });
});
