import { createHash } from 'node:crypto';
import {
  type Permission,
  type ServerExportManifest,
  SERVER_EXPORT_MANIFEST_FILE,
  fail,
  ok,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, buildPermissionActor } from '../rbac/index.js';
import { type BackupService, createBackupService } from './service.js';
import {
  type FakeAgent,
  type RecordingEventPublisher,
  fakeAgent,
  fakeServerDirectory,
  fakeUserDirectory,
  inMemoryBackupRepository,
  recordingEventPublisher,
  testBackup,
  testId,
  testServer,
} from './test-doubles.js';
import type { BackupRecord, BackupRepository } from './repository.js';
import type { BackupServerRecord } from './ports.js';

const JETZT = new Date('2026-08-26T12:00:00.000Z');

function actorMit(...permissions: Permission[]): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

interface Aufbau {
  service: BackupService;
  repository: BackupRepository;
  agent: FakeAgent;
  events: RecordingEventPublisher;
  server: BackupServerRecord;
  besitzerId: string;
}

/**
 * Baut den Service mit Testdoubles auf.
 *
 * `runJob` **sammelt** die Hintergrundläufe, statt sie sofort auszuführen. Das
 * bildet den Betrieb genauer ab als ein sofortiger Lauf: Nach `createManual()`
 * steht das Backup wirklich noch auf `pending`. `fertig()` lässt sie dann
 * beobachtbar durchlaufen.
 */
function aufbau(
  options: {
    server?: BackupServerRecord;
    /** Bestand; als Funktion, wenn er die erst hier erzeugte Besitzer-Id braucht. */
    bestand?: readonly BackupRecord[] | ((besitzerId: string) => readonly BackupRecord[]);
    /** Mit Manifest-Quelle aufbauen (P8); ohne sie exportiert B5 nur die Weltdaten. */
    manifest?: boolean;
  } = {},
): Aufbau & { fertig(): Promise<void> } {
  const besitzerId = testId('2');
  const server = options.server ?? testServer({ ownerId: besitzerId });
  const bestand =
    typeof options.bestand === 'function' ? options.bestand(besitzerId) : (options.bestand ?? []);
  const repository = inMemoryBackupRepository(bestand);
  const agent = fakeAgent();
  const events = recordingEventPublisher();
  const offeneJobs: (() => Promise<void>)[] = [];

  const service = createBackupService({
    repository,
    servers: fakeServerDirectory([server]),
    users: fakeUserDirectory({ [besitzerId]: 'Alex' }),
    agent,
    events,
    ...(options.manifest === true
      ? {
          manifests: {
            buildManifest: (serverId: string) =>
              Promise.resolve(
                serverId === server.id
                  ? {
                      formatVersion: 1 as const,
                      exportedAt: JETZT.toISOString(),
                      server: {
                        id: server.id,
                        name: server.name,
                        gameType: 'test-echo',
                        subdomain: 'testserver',
                        startupParameters: '',
                        config: {},
                        resourceLimits: { ramMb: 2048, cpuCores: 2, diskMb: 10_240 },
                        autoShutdownEnabled: false,
                        autoShutdownTimeoutMinutes: 30,
                        createdAt: JETZT.toISOString(),
                      },
                    }
                  : null,
              ),
          },
        }
      : {}),
    now: () => JETZT,
    runJob: (job) => {
      offeneJobs.push(job);
    },
  });

  return {
    service,
    repository,
    agent,
    events,
    server,
    besitzerId,
    async fertig() {
      while (offeneJobs.length > 0) {
        await offeneJobs.shift()?.();
      }
    },
  };
}

describe('Manuelles Backup auf Knopfdruck (Lastenheft §3.3)', () => {
  it('legt den Datensatz sofort an und liefert ihn als noch laufend aus', async () => {
    const t = aufbau();

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );

    // Ein Backup dauert Minuten: Die Antwort kommt sofort, der Datensatz macht
    // den Fortschritt sichtbar.
    expect(dto.status).toBe('pending');
    expect(dto.type).toBe('manual');
    expect(dto.isExport).toBe(false);
    expect(dto.createdByUserId).toBe(t.besitzerId);
    // Manuelle Backups sind von der automatischen Löschung ausgenommen.
    expect(dto.retentionProtected).toBe(true);
    expect(dto.expiresAt).toBeNull();
  });

  it('trägt Größe, Ablageort und Prüfsumme nach, sobald der Agent fertig ist', async () => {
    const t = aufbau();

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: true },
    );
    await t.fertig();

    const gespeichert = await t.repository.findById(dto.id);

    expect(gespeichert?.status).toBe('completed');
    expect(gespeichert?.sizeBytes).toBe(1024);
    expect(gespeichert?.storagePath).toBe('/srv/palantir/backups/a.tar.zst');
    expect(gespeichert?.checksumSha256).toBe('a'.repeat(64));
    expect(t.agent.createdBackupIds).toEqual([dto.id]);
  });

  it('lehnt einen zweiten Lauf ab, solange einer läuft', async () => {
    const t = aufbau();
    const actor = actorMit('backup.manage.own');

    await t.service.createManual(actor, t.besitzerId, t.server.id, { stopServer: false });

    // Zwei gleichzeitige Läufe würden denselben Datenordner lesen, während er
    // sich ändert.
    await expect(
      t.service.createManual(actor, t.besitzerId, t.server.id, { stopServer: false }),
    ).rejects.toMatchObject({ code: 'BACKUP_ALREADY_RUNNING' });
  });

  it('meldet einen unbekannten Server als SERVER_NOT_FOUND', async () => {
    const t = aufbau();

    await expect(
      t.service.createManual(actorMit('backup.manage.own'), t.besitzerId, testId('9'), {
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });
  });
});

describe('Berechtigungen (Pflichtenheft §8)', () => {
  it('verweigert fremde Server, wenn nur backup.manage.own vorliegt', async () => {
    const t = aufbau();
    const fremder = testId('7');

    // Kein PERMISSION_DENIED: Sonst verriete die Antwort die Existenz fremder
    // Server.
    await expect(
      t.service.createManual(actorMit('backup.manage.own'), fremder, t.server.id, {
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });
  });

  it('lässt backup.manage.any auch fremde Server zu', async () => {
    const t = aufbau();

    const dto = await t.service.createManual(
      actorMit('backup.manage.any'),
      testId('7'),
      t.server.id,
      {
        stopServer: false,
      },
    );

    expect(dto.status).toBe('pending');
  });

  it('behandelt Mitverwalter eines Servers als eigen', async () => {
    const mitglied = testId('8');
    const t = aufbau({ server: testServer({ ownerId: testId('2'), memberUserIds: [mitglied] }) });

    const dto = await t.service.createManual(actorMit('backup.manage.own'), mitglied, t.server.id, {
      stopServer: false,
    });

    expect(dto.permissions.canView).toBe(true);
  });

  it('zeigt den Ablageport nur Aufrufern mit backup.manage.any', async () => {
    const t = aufbau();
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    const alsBesitzer = await t.service.get(actorMit('backup.manage.own'), t.besitzerId, dto.id);
    const alsAdmin = await t.service.get(actorMit('backup.manage.any'), testId('7'), dto.id);

    expect(alsBesitzer.storagePath).toBeNull();
    expect(alsAdmin.storagePath).toBe('/srv/palantir/backups/a.tar.zst');
  });
});

describe('Live-Stand einer Sicherung (Gefundener Punkt 51)', () => {
  it('meldet Beginn und Abschluss an den Live-Kanal', async () => {
    const t = aufbau();

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    const stand = t.events.published.filter((e) => e.event === 'backup.progressed');

    // Einmal beim Anstoßen („läuft"), einmal beim Abschluss – ohne das zweite
    // stünde die offene Ansicht dauerhaft auf „läuft".
    expect(stand.length).toBeGreaterThanOrEqual(2);
    expect(stand[0]?.payload['serverId']).toBe(t.server.id);

    const zuletzt = stand[stand.length - 1]?.payload['backup'] as {
      status: string;
      backupId: string;
    };

    expect(zuletzt.status).toBe('completed');
    expect(zuletzt.backupId).toBe(dto.id);
  });

  it('trägt keine aufrufer-abhängigen Angaben in die Nutzlast', async () => {
    const t = aufbau();

    await t.service.createManual(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      stopServer: false,
    });
    await t.fertig();

    const stand = t.events.published.find((e) => e.event === 'backup.progressed');
    const nutzlast = stand?.payload['backup'] as Record<string, unknown>;

    // `permissions` und `storagePath` gehen an alle Abonnenten des Themas – sie
    // haben in einem Live-Ereignis nichts verloren.
    expect(nutzlast).not.toHaveProperty('permissions');
    expect(nutzlast).not.toHaveProperty('storagePath');
  });
});

describe('Fehlgeschlagenes Backup (Event backup.failed, Pflichtenheft §14)', () => {
  it('setzt den Datensatz auf failed und löst das Ereignis aus', async () => {
    const t = aufbau();
    t.agent.createResponse = fail('AGENT_RUNTIME_UNAVAILABLE');

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    const gespeichert = await t.repository.findById(dto.id);

    expect(gespeichert?.status).toBe('failed');
    expect(gespeichert?.failureCode).toBe('AGENT_RUNTIME_UNAVAILABLE');
    // Neben `backup.failed` meldet der Lauf seit Punkt 51 auch seinen Stand an
    // den Live-Kanal (angestoßen und gescheitert) – geprüft wird hier die
    // Meldung an die Notification-Engine.
    const gescheitert = t.events.published.filter((e) => e.event === 'backup.failed');

    expect(gescheitert).toHaveLength(1);
    expect(gescheitert[0]?.payload['backupId']).toBe(dto.id);
  });

  it('wertet ein unbrauchbares Agent-Ergebnis als Fehlschlag', async () => {
    const t = aufbau();
    // „Hat geklappt“, aber ohne Ablageort: Ein Datensatz ohne Archiv wäre
    // schlimmer als ein sichtbarer Fehler.
    t.agent.createResponse = ok({ irgendwas: true });

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    expect((await t.repository.findById(dto.id))?.status).toBe('failed');
    expect(t.events.published.some((e) => e.event === 'backup.failed')).toBe(true);
  });
});

describe('Aufbewahrungsregel im Zusammenspiel mit dem Agent', () => {
  const serverId = testId('1');
  const besitzer = testId('2');
  const server = testServer({ id: serverId, ownerId: besitzer });

  const neuestesAuto = testBackup({
    serverId,
    ownerId: besitzer,
    type: 'automatic',
    createdAt: new Date('2026-08-25T04:00:00.000Z'),
    storagePath: '/srv/palantir/backups/neu.tar.zst',
    sizeBytes: 700,
  });
  const abgelaufenesAuto = testBackup({
    serverId,
    ownerId: besitzer,
    type: 'automatic',
    createdAt: new Date('2026-08-01T04:00:00.000Z'),
    storagePath: '/srv/palantir/backups/alt.tar.zst',
    sizeBytes: 500,
  });
  const altesManuelles = testBackup({
    serverId,
    ownerId: besitzer,
    type: 'manual',
    createdAt: new Date('2025-01-01T04:00:00.000Z'),
    storagePath: '/srv/palantir/backups/manuell.tar.zst',
    sizeBytes: 300,
  });

  it('entfernt genau die abgelaufenen automatischen Backups samt Archiv', async () => {
    const t = aufbau({
      server,
      bestand: [neuestesAuto, abgelaufenesAuto, altesManuelles],
    });

    const ergebnis = await t.service.applyRetention(serverId);

    expect(ergebnis.removedBackupIds).toEqual([abgelaufenesAuto.id]);
    expect(ergebnis.freedBytes).toBe(1024);
    // Nur das abgelaufene Archiv wird angefasst – nicht das neueste und nicht
    // das manuelle (Lastenheft §3.3).
    expect(t.agent.deletedStoragePaths).toEqual(['/srv/palantir/backups/alt.tar.zst']);
    expect(await t.repository.findById(neuestesAuto.id)).not.toBeNull();
    expect(await t.repository.findById(altesManuelles.id)).not.toBeNull();
  });

  it('lässt einen Lauf nicht abbrechen, wenn ein Archiv gerade nicht entfernt werden kann', async () => {
    const t = aufbau({ server, bestand: [neuestesAuto, abgelaufenesAuto] });
    t.agent.deleteResponse = fail('AGENT_RUNTIME_UNAVAILABLE');

    const ergebnis = await t.service.applyRetention(serverId);

    // Der Datensatz bleibt stehen; der nächste Durchgang holt das Löschen nach.
    expect(ergebnis.removedBackupIds).toEqual([]);
    expect(await t.repository.findById(abgelaufenesAuto.id)).not.toBeNull();
  });

  it('läuft nach einem erfolgreichen Backup von selbst mit', async () => {
    const t = aufbau({ server, bestand: [abgelaufenesAuto] });

    await t.service.createManual(actorMit('backup.manage.own'), besitzer, serverId, {
      stopServer: false,
    });
    await t.fertig();

    // Das frische Backup ist manuell und schützt nichts; das abgelaufene
    // automatische bleibt trotzdem, weil es nun das einzige – und damit das
    // neueste – automatische ist.
    expect(await t.repository.findById(abgelaufenesAuto.id)).not.toBeNull();
    expect(t.agent.deletedStoragePaths).toEqual([]);
  });
});

describe('Löschen, Wiederherstellen und Export', () => {
  async function fertigesBackup(t: ReturnType<typeof aufbau>) {
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    return dto;
  }

  it('entfernt beim Löschen auch das Archiv auf dem Homeserver', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);

    await t.service.remove(actorMit('backup.manage.own'), t.besitzerId, dto.id);

    expect(t.agent.deletedStoragePaths).toEqual(['/srv/palantir/backups/a.tar.zst']);
    expect(await t.repository.findById(dto.id)).toBeNull();
  });

  it('verweigert das Löschen eines noch laufenden Backups', async () => {
    const t = aufbau();
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );

    await expect(
      t.service.remove(actorMit('backup.manage.own'), t.besitzerId, dto.id),
    ).rejects.toMatchObject({ code: 'BACKUP_NOT_READY' });

    await t.fertig();
  });

  it('verweigert das Wiederherstellen eines nicht abgeschlossenen Backups', async () => {
    const t = aufbau();
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );

    await expect(
      t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id),
    ).rejects.toMatchObject({ code: 'BACKUP_NOT_READY' });

    await t.fertig();
  });

  it('schickt beim Wiederherstellen Archiv und Zielordner an den Agent', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);

    await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);

    expect(t.agent.restoredBackupIds).toEqual([dto.id]);
  });

  it('gibt dem Agent die gespeicherte Prüfsumme zur Verifikation mit', async () => {
    // Der Agent prüft das Archiv vor dem Entpacken dagegen (Fundpunkt 99).
    const t = aufbau();
    const dto = await fertigesBackup(t);

    await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);

    expect(t.agent.restoredChecksums).toEqual(['a'.repeat(64)]);
  });

  it('verweigert die Wiederherstellung ohne gespeicherte Prüfsumme', async () => {
    // Ohne Referenzwert ließe sich die Integrität nicht belegen.
    const t = aufbau({
      bestand: (besitzerId) => [
        testBackup({ serverId: null, ownerId: besitzerId, checksumSha256: null }),
      ],
    });
    const [nurBackup] = await t.repository.listByOwner(t.besitzerId);

    await expect(
      t.service.restore(actorMit('backup.manage.own'), t.besitzerId, nurBackup!.id),
    ).rejects.toMatchObject({ code: 'BACKUP_NOT_READY' });
  });

  it('erzeugt für den Datenexport ein manuelles Backup mit isExport', async () => {
    const t = aufbau();

    const dto = await t.service.createExport(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );

    // Der Export unterliegt derselben Ausnahme von der automatischen Löschung
    // wie jedes manuelle Backup (Lastenheft §3.3).
    expect(dto.type).toBe('manual');
    expect(dto.isExport).toBe(true);
    expect(dto.retentionProtected).toBe(true);

    await t.fertig();
  });

  it('legt die Konfiguration als Manifest mit ins Archiv (P8)', async () => {
    const t = aufbau({ manifest: true });

    await t.service.createExport(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      stopServer: false,
    });
    await t.fertig();

    const [zusatz] = t.agent.createdExtraFiles;

    expect(zusatz).toHaveLength(1);
    expect(zusatz?.[0]?.path).toBe(SERVER_EXPORT_MANIFEST_FILE);

    const manifest = JSON.parse(
      Buffer.from(zusatz?.[0]?.contentBase64 ?? '', 'base64').toString('utf8'),
    ) as ServerExportManifest;

    expect(manifest.formatVersion).toBe(1);
    expect(manifest.server.id).toBe(t.server.id);
    expect(manifest.server.name).toBe(t.server.name);
  });

  it('exportiert ohne Manifest-Quelle weiterhin nur die Weltdaten', async () => {
    const t = aufbau();

    await t.service.createExport(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      stopServer: false,
    });
    await t.fertig();

    expect(t.agent.createdExtraFiles).toEqual([[]]);
  });

  it('schickt bei einem gewöhnlichen Backup kein Manifest mit', async () => {
    const t = aufbau({ manifest: true });

    await t.service.createManual(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      stopServer: false,
    });
    await t.fertig();

    expect(t.agent.createdExtraFiles).toEqual([[]]);
  });
});

describe('Download aller Serverdaten (Lastenheft §3.3)', () => {
  it('gibt die Blöcke des Archivs in Reihenfolge weiter, bis das Dateiende erreicht ist', async () => {
    const t = aufbau();
    // Die gespeicherte Prüfsumme muss zum ausgelieferten Archiv passen, sonst
    // schlägt die Integritätsprüfung an (Fundpunkt 99).
    const palantirSha = createHash('sha256').update(Buffer.from('Palantir')).digest('hex');
    t.agent.createResponse = ok({
      backupId: '00000000-0000-4000-8000-000000000000',
      storagePath: '/srv/palantir/backups/a.tar.zst',
      sizeBytes: 8,
      checksumSha256: palantirSha,
      containerStopped: false,
      startedAt: '2026-08-26T04:00:00.000Z',
      completedAt: '2026-08-26T04:01:00.000Z',
    });

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    t.agent.downloadResponses = [
      ok({
        backupId: dto.id,
        offset: 0,
        contentBase64: Buffer.from('Palan').toString('base64'),
        bytesRead: 5,
        totalBytes: 8,
        eof: false,
      }),
      ok({
        backupId: dto.id,
        offset: 5,
        contentBase64: Buffer.from('tir').toString('base64'),
        bytesRead: 3,
        totalBytes: 8,
        eof: true,
      }),
    ];

    const download = await t.service.openDownload(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
    );

    const teile: Buffer[] = [];

    for await (const chunk of download.chunks()) {
      teile.push(chunk.bytes);
    }

    expect(Buffer.concat(teile).toString()).toBe('Palantir');
    expect(download.fileName).toContain('.tar.zst');
  });

  it('bricht den Download ab, wenn die Prüfsumme des Archivs nicht passt', async () => {
    // Ein beschädigtes oder verändertes Archiv darf nicht als vollständig
    // ausgeliefert werden (Fundpunkt 99). Der Bestand trägt die Prüfsumme des
    // korrekten Archivs; der Agent liefert hier abweichende Bytes.
    const palantirSha = createHash('sha256').update(Buffer.from('Palantir')).digest('hex');
    const t = aufbau();
    t.agent.createResponse = ok({
      backupId: '00000000-0000-4000-8000-000000000000',
      storagePath: '/srv/palantir/backups/a.tar.zst',
      sizeBytes: 8,
      checksumSha256: palantirSha,
      containerStopped: false,
      startedAt: '2026-08-26T04:00:00.000Z',
      completedAt: '2026-08-26T04:01:00.000Z',
    });

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    t.agent.downloadResponses = [
      ok({
        backupId: dto.id,
        offset: 0,
        contentBase64: Buffer.from('PALANTIR').toString('base64'),
        bytesRead: 8,
        totalBytes: 8,
        eof: true,
      }),
    ];

    const download = await t.service.openDownload(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
    );

    await expect(async () => {
      for await (const _chunk of download.chunks()) {
        // nur konsumieren
      }
    }).rejects.toMatchObject({ code: 'BACKUP_CHECKSUM_MISMATCH' });
  });

  it('bricht ab, wenn der Agent weder Fortschritt noch Dateiende meldet', async () => {
    const t = aufbau();
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    t.agent.downloadResponses = [
      ok({
        backupId: dto.id,
        offset: 0,
        contentBase64: '',
        bytesRead: 0,
        totalBytes: 8,
        eof: false,
      }),
    ];

    const download = await t.service.openDownload(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
    );

    // Ohne diese Prüfung liefe die Schleife endlos.
    await expect(async () => {
      for await (const _chunk of download.chunks()) {
        // nur konsumieren
      }
    }).rejects.toMatchObject({ code: 'AGENT_COMMAND_FAILED' });
  });
});

describe('Globale Übersicht (Lastenheft §3.7)', () => {
  it('verlangt backup.manage.any', async () => {
    const t = aufbau();

    await expect(t.service.overview(actorMit('backup.manage.own'), {})).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
  });

  it('summiert Anzahl und Speicherverbrauch je Nutzer und je Server', async () => {
    const t = aufbau();
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    const uebersicht = await t.service.overview(actorMit('backup.manage.any'), {});

    expect(uebersicht.totalCount).toBe(1);
    expect(uebersicht.totalSizeBytes).toBe(1024);
    expect(uebersicht.manualCount).toBe(1);
    expect(uebersicht.automaticCount).toBe(0);
    expect(uebersicht.perUser).toEqual([
      { id: t.besitzerId, name: 'Alex', backupCount: 1, totalSizeBytes: 1024 },
    ]);
    expect(uebersicht.perServer).toEqual([
      { id: t.server.id, name: t.server.name, backupCount: 1, totalSizeBytes: 1024 },
    ]);
    expect(uebersicht.permissions.canManageAny).toBe(true);
    expect(dto.id).toBeTruthy();
  });
});

describe('Backup ohne Server (ON DELETE SET NULL, Lastenheft §3.3)', () => {
  // Der Fremdschlüssel `backups.server_id -> game_servers.id` löscht bewusst
  // nicht mit, sondern setzt die Spalte auf NULL (R3): Ein Backup überlebt
  // seinen Server. Ab da trägt `ownerId` allein die `.own`-Prüfung.
  function mitVerwaistem() {
    let verwaist!: BackupRecord;
    const t = aufbau({
      bestand: (besitzerId) => {
        verwaist = testBackup({ serverId: null, ownerId: besitzerId, type: 'manual' });

        return [verwaist];
      },
    });

    return { t, verwaist };
  }

  it('bleibt für den Besitzer sichtbar und meldet keinen Servernamen', async () => {
    const { t, verwaist } = mitVerwaistem();

    const dto = await t.service.get(actorMit('backup.manage.own'), t.besitzerId, verwaist.id);

    expect(dto.serverId).toBeNull();
    expect(dto.serverName).toBeNull();
    expect(dto.permissions.canDownload).toBe(true);
  });

  it('lässt sich löschen – Datensatz und Archiv verschwinden gemeinsam', async () => {
    const { t, verwaist } = mitVerwaistem();

    await t.service.remove(actorMit('backup.manage.own'), t.besitzerId, verwaist.id);

    expect(t.agent.deletedStoragePaths).toEqual([verwaist.storagePath]);
    expect(await t.repository.findById(verwaist.id)).toBeNull();
  });

  it('verweigert das Wiederherstellen, weil das Ziel fehlt', async () => {
    const { t, verwaist } = mitVerwaistem();

    await expect(
      t.service.restore(actorMit('backup.manage.own'), t.besitzerId, verwaist.id),
    ).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });
  });

  it('rechnet die Aufbewahrung nicht über fremde Server hinweg', async () => {
    // Zwei automatische Backups zweier verschiedener, inzwischen gelöschter
    // Server. Würden sie als Geschwister gelten, wäre nur das neuere geschützt –
    // „neuestes automatisches Backup bleibt" gilt aber je Server.
    const t = aufbau({
      bestand: (besitzerId) => [
        testBackup({
          serverId: null,
          ownerId: besitzerId,
          type: 'automatic',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
        testBackup({
          serverId: null,
          ownerId: besitzerId,
          type: 'automatic',
          createdAt: new Date('2026-08-20T00:00:00.000Z'),
        }),
      ],
    });

    const liste = await t.service.listForOwner(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.besitzerId,
    );

    expect(liste).toHaveLength(2);
    expect(liste.map((dto) => dto.retentionProtected)).toEqual([true, true]);
  });
});
