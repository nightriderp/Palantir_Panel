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
  TEST_HOST_ID,
  TEST_OTHER_HOST_ID,
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
  /** Was ins Audit-Log ging (Fundpunkt 237). */
  protokoll: { action: string; targetId: string; metadata: Record<string, unknown> }[];
}

/** Aufrufkontext, wie ihn die Route aus dem Request baut. */
const AUFRUFER = {
  actorId: testId('2'),
  actorDisplayName: 'Alex',
  ipHint: '10.0.0.x',
};

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
    /** Bestand; als Funktion, wenn er die erst hier erzeugten Ids braucht. */
    bestand?:
      | readonly BackupRecord[]
      | ((besitzerId: string, server: BackupServerRecord) => readonly BackupRecord[]);
    /** Mit Manifest-Quelle aufbauen (P8); ohne sie exportiert B5 nur die Weltdaten. */
    manifest?: boolean;
    /**
     * Umhüllt das Repository, um Ausfälle mitten im Lauf nachzubilden (z. B.
     * eine kurz abgerissene Datenbankverbindung, Audit bb-06). Die Prüfungen
     * lesen weiterhin den echten Bestand.
     */
    repositoryUmhuellung?: (basis: BackupRepository) => BackupRepository;
  } = {},
): Aufbau & { fertig(): Promise<void> } {
  const besitzerId = testId('2');
  const server = options.server ?? testServer({ ownerId: besitzerId });
  const bestand =
    typeof options.bestand === 'function'
      ? options.bestand(besitzerId, server)
      : (options.bestand ?? []);
  const repository = inMemoryBackupRepository(bestand);
  const agent = fakeAgent();
  const events = recordingEventPublisher();
  const offeneJobs: (() => Promise<void>)[] = [];
  const protokoll: { action: string; targetId: string; metadata: Record<string, unknown> }[] = [];

  const service = createBackupService({
    repository: options.repositoryUmhuellung?.(repository) ?? repository,
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
    audit: {
      record(entry) {
        protokoll.push({
          action: entry.action,
          targetId: entry.targetId,
          metadata: entry.metadata,
        });
      },
    },
  });

  return {
    service,
    repository,
    agent,
    events,
    server,
    besitzerId,
    protokoll,
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

  /**
   * Audit W2-9, bb-10: `findActiveByServer()` und `create()` sind zwei
   * Schritte. Beim Doppelklick bestehen beide Aufrufe die Vorprüfung, den
   * zweiten Insert fängt erst `backups_one_active_per_server_idx` – bisher als
   * roher 23505 und damit als 500 statt als `BACKUP_ALREADY_RUNNING` (409).
   */
  it('beantwortet den Unique-Index (23505) mit BACKUP_ALREADY_RUNNING', async () => {
    const t = aufbau({
      repositoryUmhuellung: (basis) => ({
        ...basis,
        // Der Gewinner des Rennens hat sein `INSERT` noch nicht abgeschlossen,
        // als dieser Aufruf die Vorprüfung passiert.
        findActiveByServer: () => Promise.resolve(null),
        create: () =>
          Promise.reject(
            Object.assign(new Error('duplicate key value violates unique constraint'), {
              code: '23505',
            }),
          ),
      }),
    });

    await expect(
      t.service.createManual(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
        stopServer: false,
      }),
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

  /**
   * Die Nutzlast muss den Vertrag erfüllen: Ohne `ownerId` fand die
   * Empfängerauflösung niemanden, ohne `serverName`/`failureCode` stand
   * „undefined" in der Meldung – und beides fiel nie auf, weil die
   * Notification-Engine Fehler bewusst schluckt (Audit W1-7, event-flow-02).
   */
  it('meldet backup.failed mit allen Feldern des Vertrags', async () => {
    const t = aufbau();
    t.agent.createResponse = fail('AGENT_RUNTIME_UNAVAILABLE', 'Der Agent ist nicht verbunden.');

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );
    await t.fertig();

    const gescheitert = t.events.published.find((e) => e.event === 'backup.failed');

    expect(gescheitert?.payload).toEqual({
      at: JETZT.toISOString(),
      // Ein Fehlschlag entsteht im Hintergrundlauf, nicht durch eine Handlung.
      actorId: null,
      backupId: dto.id,
      serverId: t.server.id,
      serverName: t.server.name,
      ownerId: t.besitzerId,
      failureCode: 'AGENT_RUNTIME_UNAVAILABLE',
      failureMessage: 'Der Agent ist nicht verbunden.',
    });
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

  it('lässt ein fertiges Backup fertig, wenn die Aufbewahrung danach scheitert (Audit bb-06)', async () => {
    let brich = false;
    const t = aufbau({
      server,
      repositoryUmhuellung: (basis) => ({
        ...basis,
        // Der Aufbewahrungslauf am Ende des Jobs liest hierüber den Bestand;
        // zum Zeitpunkt des Fehlers steht der Datensatz bereits auf `completed`.
        listByServer: (id) =>
          brich
            ? Promise.reject(new Error('Datenbankverbindung kurz weg.'))
            : basis.listByServer(id),
      }),
    });

    await t.service.createManual(actorMit('backup.manage.own'), besitzer, serverId, {
      stopServer: false,
    });
    brich = true;
    await t.fertig();

    const [backup] = await t.repository.listByServer(serverId);

    // Das Archiv existiert vollständig – es nachträglich auf `failed` zu setzen
    // kostete es den Schutz „neuestes abgeschlossenes automatisches Backup“ und
    // meldete B6 einen Fehlschlag, den es nie gab.
    expect(backup?.status).toBe('completed');
    expect(backup?.failureCode).toBeNull();
    expect(t.events.published.map((eintrag) => eintrag.event)).not.toContain('backup.failed');
  });

  it('macht auch aus einem Fehler nach dem Abschluss-Update kein failed', async () => {
    const t = aufbau({
      server,
      repositoryUmhuellung: (basis) => ({
        ...basis,
        // Geschrieben ist geschrieben: Das Update geht durch, erst die Antwort
        // geht verloren. Der Fänger in `startBackup` griffe danach ins Leere.
        update: async (id, data) => {
          const record = await basis.update(id, data);

          if (data.status === 'completed') {
            throw new Error('Verbindung nach dem Schreiben verloren.');
          }

          return record;
        },
      }),
    });

    await t.service.createManual(actorMit('backup.manage.own'), besitzer, serverId, {
      stopServer: false,
    });
    await t.fertig();

    const [backup] = await t.repository.listByServer(serverId);

    expect(backup?.status).toBe('completed');
    expect(t.events.published.map((eintrag) => eintrag.event)).not.toContain('backup.failed');
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

    /*
     * Fundpunkt 225: Die Antwort ist der Auftrag, nicht das Ergebnis - das
     * Entpacken laeuft im Hintergrund. `fertig()` laesst ihn durchlaufen.
     */
    const job = await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);
    expect(job.status).toBe('queued');
    expect(t.agent.restoredBackupIds).toEqual([]);

    await t.fertig();

    expect(t.agent.restoredBackupIds).toEqual([dto.id]);
  });

  it('gibt dem Agent die gespeicherte Prüfsumme zur Verifikation mit', async () => {
    // Der Agent prüft das Archiv vor dem Entpacken dagegen (Fundpunkt 99).
    const t = aufbau();
    const dto = await fertigesBackup(t);

    await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);
    await t.fertig();

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

describe('Kehraus abgerissener Laeufe (Audit W1-6, bb-03)', () => {
  const FUENF_STUNDEN_MS = 5 * 60 * 60 * 1000;

  /**
   * Ein Lauf, den der Neustart des Backends mitten im Sichern erwischt hat: Der
   * Job lebte nur im Prozess, der Datensatz blieb stehen.
   */
  function haengenderLauf(serverId: string, startedAt: Date): BackupRecord {
    return testBackup({
      serverId,
      status: 'running',
      type: 'automatic',
      storagePath: null,
      checksumSha256: null,
      startedAt,
      completedAt: null,
    });
  }

  it('setzt einen seit Stunden haengenden Lauf auf failed und meldet ihn', async () => {
    let lauf!: BackupRecord;
    const t = aufbau({
      bestand: (_besitzerId, server) => {
        lauf = haengenderLauf(server.id, new Date(JETZT.getTime() - FUENF_STUNDEN_MS));

        return [lauf];
      },
    });

    expect(await t.service.sweepOrphanedRuns()).toEqual([lauf.id]);

    const danach = await t.repository.findById(lauf.id);

    expect(danach?.status).toBe('failed');
    // Benannter Code aus dem Katalog, kein Freitext (CLAUDE.md §5). Die Ursache
    // liegt beim Panel selbst und nicht beim Homeserver.
    expect(danach?.failureCode).toBe('INTERNAL_ERROR');
    expect(danach?.failureMessage).toContain('Neustart');
    expect(t.events.published.map((eintrag) => eintrag.event)).toContain('backup.failed');
  });

  it('gibt den gesperrten Server wieder frei', async () => {
    const t = aufbau({
      bestand: (_besitzerId, server) => [
        haengenderLauf(server.id, new Date(JETZT.getTime() - FUENF_STUNDEN_MS)),
      ],
    });

    // Vorher sperrt der abgerissene Datensatz jedes weitere Backup – genau der
    // Zustand, aus dem bisher nur ein Eingriff von Hand herausführte.
    await expect(
      t.service.createManual(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'BACKUP_ALREADY_RUNNING' });

    await t.service.sweepOrphanedRuns();

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );

    expect(dto.status).toBe('pending');
  });

  it('erreicht auch die Zombie-Zeilen geloeschter Server (Audit backend-db-06)', async () => {
    /*
     * `server_id` steht nach dem Loeschen des Servers auf NULL, und NULL-Werte
     * kollidieren im partiellen Unique-Index nicht: Mehrere „aktive" Zeilen
     * ohne Server sind damit moeglich. Aufgeraeumt werden sie hier und nicht
     * ueber den Index – ein Index, der die NULL-Faelle mitzaehlt, liesse das
     * Loeschen des Servers selbst an einer Unique-Verletzung scheitern.
     */
    const abgerissen = new Date(JETZT.getTime() - FUENF_STUNDEN_MS);
    let laufend!: BackupRecord;
    let wartend!: BackupRecord;
    const t = aufbau({
      bestand: () => {
        laufend = testBackup({
          serverId: null,
          status: 'running',
          storagePath: null,
          checksumSha256: null,
          startedAt: abgerissen,
          completedAt: null,
        });
        wartend = testBackup({
          serverId: null,
          status: 'pending',
          storagePath: null,
          checksumSha256: null,
          createdAt: abgerissen,
          startedAt: null,
          completedAt: null,
        });

        return [laufend, wartend];
      },
    });

    expect([...(await t.service.sweepOrphanedRuns())].sort()).toEqual(
      [laufend.id, wartend.id].sort(),
    );
    expect((await t.repository.findById(laufend.id))?.status).toBe('failed');
    expect((await t.repository.findById(wartend.id))?.status).toBe('failed');
    // Ohne Server gibt es keinen vertragsgemaessen Empfaenger fuer
    // `backup.failed`; den Ausgang traegt der Datensatz.
    expect(t.events.published.map((eintrag) => eintrag.event)).not.toContain('backup.failed');
  });

  it('laesst einen jungen Lauf unangetastet – er arbeitet noch', async () => {
    let lauf!: BackupRecord;
    const t = aufbau({
      bestand: (_besitzerId, server) => {
        lauf = haengenderLauf(server.id, new Date(JETZT.getTime() - 10 * 60 * 1000));

        return [lauf];
      },
    });

    expect(await t.service.sweepOrphanedRuns()).toEqual([]);
    expect((await t.repository.findById(lauf.id))?.status).toBe('running');
  });
});

describe('Aufbewahrung ueber den gesamten Bestand (Audit W1-6, bb-07)', () => {
  it('raeumt abgelaufene automatische Backups auch ohne neuen Lauf weg', async () => {
    let alt!: BackupRecord;
    let neu!: BackupRecord;
    let manuell!: BackupRecord;
    const t = aufbau({
      bestand: (besitzerId, server) => {
        alt = testBackup({
          serverId: server.id,
          ownerId: besitzerId,
          type: 'automatic',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        neu = testBackup({
          serverId: server.id,
          ownerId: besitzerId,
          type: 'automatic',
          createdAt: new Date('2026-08-25T00:00:00.000Z'),
        });
        manuell = testBackup({
          serverId: server.id,
          ownerId: besitzerId,
          type: 'manual',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        });

        return [alt, neu, manuell];
      },
    });

    const ergebnis = await t.service.applyRetentionToAll();

    expect(ergebnis.removedBackupIds).toEqual([alt.id]);
    // Das neueste abgeschlossene automatische Backup und jedes manuelle bleiben.
    expect(await t.repository.findById(neu.id)).not.toBeNull();
    expect(await t.repository.findById(manuell.id)).not.toBeNull();
  });

  it('erreicht auch Backups geloeschter Server', async () => {
    let gescheitert!: BackupRecord;
    let fertig!: BackupRecord;
    const t = aufbau({
      bestand: (besitzerId) => {
        gescheitert = testBackup({
          serverId: null,
          ownerId: besitzerId,
          type: 'automatic',
          status: 'failed',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        });
        fertig = testBackup({
          serverId: null,
          ownerId: besitzerId,
          type: 'automatic',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        });

        return [gescheitert, fertig];
      },
    });

    const ergebnis = await t.service.applyRetentionToAll();

    /*
     * Ohne Server bildet jedes Backup seine eigene Gruppe (`groupKey`, s. o.):
     * Der abgeschlossene Lauf gilt als „neuester" seiner Gruppe und bleibt –
     * genau das zeigt auch sein DTO an. Der gescheiterte Lauf traegt keine
     * Daten, ist nicht geschuetzt und faellt nach der Frist. Bisher sah ihn
     * ueberhaupt niemand an: Ein Aufbewahrungslauf gab es nur je Server.
     */
    expect(ergebnis.removedBackupIds).toEqual([gescheitert.id]);
    expect(await t.repository.findById(fertig.id)).not.toBeNull();
  });
});

/**
 * Eine Sicherung weiß, auf welcher Node sie liegt (Fundpunkt 174).
 *
 * Geprüft wird hier die Seite von B5: dass die Node beim Anlegen aus dem Server
 * übernommen und bei den beiden server-losen Befehlen weitergereicht wird. An
 * welche Maschine der Befehl daraufhin geht, prüft
 * `server-orchestration/backup-ports.test.ts` mit zwei laufenden Agents.
 */
describe('Node am Backup-Datensatz (Fundpunkt 174)', () => {
  it('übernimmt beim Anlegen die Node des gesicherten Servers', async () => {
    const t = aufbau();

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
    );

    expect((await t.repository.findById(dto.id))?.hostId).toBe(TEST_HOST_ID);
  });

  it('nimmt die Node des Servers und nicht eine feste Vorgabe', async () => {
    // Zweiter Server auf der zweiten Node: Stünde hier irgendwo ein fester
    // Wert, fiele es erst im Mehr-Node-Betrieb auf – also nie im Test.
    const besitzerId = testId('2');
    const t = aufbau({
      server: testServer({ ownerId: besitzerId, hostId: TEST_OTHER_HOST_ID }),
    });

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.server.ownerId,
      t.server.id,
      { stopServer: false },
    );

    expect((await t.repository.findById(dto.id))?.hostId).toBe(TEST_OTHER_HOST_ID);
  });

  it('hält die Node auch bei einem geplanten Lauf fest', async () => {
    const t = aufbau({ server: testServer({ hostId: TEST_OTHER_HOST_ID }) });

    const dto = await t.service.createScheduled(t.server.id, testId('4'), false);

    expect((await t.repository.findById(dto.id))?.hostId).toBe(TEST_OTHER_HOST_ID);
  });

  it('löscht das Archiv auf der Node des Backups', async () => {
    const t = aufbau({
      bestand: (besitzerId, server) => [
        testBackup({ serverId: server.id, ownerId: besitzerId, hostId: TEST_OTHER_HOST_ID }),
      ],
    });
    const [backup] = await t.repository.listByOwner(t.besitzerId);

    await t.service.remove(actorMit('backup.manage.any'), t.besitzerId, backup?.id ?? '');

    expect(t.agent.deletedHostIds).toEqual([TEST_OTHER_HOST_ID]);
  });

  it('holt die Blöcke von der Node des Backups', async () => {
    const inhalt = Buffer.from('Palantir');
    const t = aufbau({
      bestand: (besitzerId, server) => [
        testBackup({
          serverId: server.id,
          ownerId: besitzerId,
          hostId: TEST_OTHER_HOST_ID,
          sizeBytes: inhalt.length,
          checksumSha256: createHash('sha256').update(inhalt).digest('hex'),
        }),
      ],
    });
    const [backup] = await t.repository.listByOwner(t.besitzerId);

    t.agent.downloadResponses = [
      ok({
        backupId: backup?.id ?? '',
        offset: 0,
        contentBase64: inhalt.toString('base64'),
        bytesRead: inhalt.length,
        totalBytes: inhalt.length,
        eof: true,
      }),
    ];

    const download = await t.service.openDownload(
      actorMit('backup.manage.any'),
      t.besitzerId,
      backup?.id ?? '',
    );

    for await (const _ of download.chunks()) {
      // Nur der Vollständigkeit halber durchlaufen; geprüft wird die Node.
    }

    expect(t.agent.downloadedHostIds).toEqual([TEST_OTHER_HOST_ID]);
  });

  it('reicht eine Sicherung ohne Node als „unbekannt" weiter, statt eine zu erfinden', async () => {
    // Zeile von vor der Spalte oder ausgemusterte Node: Der Service tut hier
    // nichts – die Entscheidung, auf `defaultHost()` zurückzufallen und das zu
    // melden, gehört ins Gateway, das die Nodes kennt.
    const t = aufbau({
      bestand: (besitzerId, server) => [
        testBackup({ serverId: server.id, ownerId: besitzerId, hostId: null }),
      ],
    });
    const [backup] = await t.repository.listByOwner(t.besitzerId);

    await t.service.remove(actorMit('backup.manage.any'), t.besitzerId, backup?.id ?? '');

    expect(t.agent.deletedHostIds).toEqual([null]);
  });
});

/**
 * Wiederherstellung als Auftrag (Fundpunkt 225).
 *
 * Vorher wartete die HTTP-Anfrage auf den Agent-Befehl, und dessen Frist steht
 * auf zwei Stunden. Jeder Vermittler davor gab vorher auf; der Nutzer sah einen
 * Fehlschlag, waehrend das Entpacken in Ruhe zu Ende lief.
 */
describe('Wiederherstellung als Auftrag (Fundpunkt 225)', () => {
  /** Ein abgeschlossenes Backup, wie es die Wiederherstellung voraussetzt. */
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

  it('antwortet sofort mit einem Auftrag und meldet ihn im Kanal', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);
    t.events.published.length = 0;

    const job = await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);

    expect(job.backupId).toBe(dto.id);
    expect(job.status).toBe('queued');
    expect(job.finishedAt).toBeNull();
    expect(t.events.published.map((e) => e.event)).toContain('backupRestore.progressed');
  });

  it('fuehrt den Auftrag zu Ende und meldet das Ergebnis', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);

    const job = await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);
    await t.fertig();

    const stand = await t.service.findRestoreJob(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
      job.id,
    );

    expect(stand?.status).toBe('completed');
    expect(stand?.progressPercent).toBe(100);
    expect(stand?.finishedAt).not.toBeNull();
  });

  it('schreibt einen Fehlschlag in den Auftrag, statt zu werfen', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);
    t.agent.restoreResponse = {
      success: false,
      data: null,
      error: { code: 'AGENT_COMMAND_FAILED', message: 'Das Archiv liess sich nicht entpacken.' },
    };

    const job = await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);
    // Kein Wurf: Auf diesen Hintergrundlauf wartet niemand mehr.
    await t.fertig();

    const stand = await t.service.findRestoreJob(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
      job.id,
    );

    expect(stand?.status).toBe('failed');
    expect(stand?.statusMessage).not.toBeNull();
  });

  it('kennt keinen Auftrag an einer fremden Sicherung', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);

    const job = await t.service.restore(actorMit('backup.manage.own'), t.besitzerId, dto.id);
    await t.fertig();

    const stand = await t.service.findRestoreJob(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
      // Auftragskennung, die es an dieser Sicherung nicht gibt.
      '00000000-0000-4000-8000-000000000000',
    );

    expect(stand).toBeNull();
    void job;
  });
});

describe('Protokolleintraege der Sicherungen (Fundpunkt 237)', () => {
  async function fertigesBackup(t: ReturnType<typeof aufbau>) {
    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
      AUFRUFER,
    );
    await t.fertig();

    return dto;
  }

  it('haelt das Anlegen fest', async () => {
    const t = aufbau();

    const dto = await t.service.createManual(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
      AUFRUFER,
    );

    expect(t.protokoll).toEqual([
      {
        action: 'backup.created',
        targetId: dto.id,
        metadata: {
          serverId: t.server.id,
          serverName: t.server.name,
          isExport: false,
          stopServer: false,
        },
      },
    ]);
  });

  it('unterscheidet den Export vom gewoehnlichen Backup', async () => {
    const t = aufbau();

    await t.service.createExport(
      actorMit('backup.manage.own'),
      t.besitzerId,
      t.server.id,
      { stopServer: false },
      AUFRUFER,
    );

    expect(t.protokoll[0]?.metadata.isExport).toBe(true);
  });

  it('haelt das Zurueckspielen beim Anstossen fest', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);
    t.protokoll.length = 0;

    const job = await t.service.restore(
      actorMit('backup.manage.own'),
      t.besitzerId,
      dto.id,
      AUFRUFER,
    );

    // Der Eintrag entsteht beim Anstossen: Ab hier wird der Datenordner
    // ueberschrieben, und genau das ist das Protokollwuerdige.
    expect(t.protokoll).toEqual([
      {
        action: 'backup.restored',
        targetId: dto.id,
        metadata: { serverId: t.server.id, serverName: t.server.name, jobId: job.id },
      },
    ]);
  });

  it('haelt das Loeschen fest', async () => {
    const t = aufbau();
    const dto = await fertigesBackup(t);
    t.protokoll.length = 0;

    await t.service.remove(actorMit('backup.manage.own'), t.besitzerId, dto.id, AUFRUFER);

    expect(t.protokoll).toHaveLength(1);
    expect(t.protokoll[0]).toMatchObject({
      action: 'backup.deleted',
      targetId: dto.id,
      metadata: { serverId: t.server.id, type: 'manual', isExport: false },
    });
  });

  it('protokolliert Betriebsvorgaenge ohne Aufrufer nicht', async () => {
    const t = aufbau();

    // Geplantes Backup und Aufbewahrungslauf haben keinen Handelnden. Eine
    // Zeile je naechtlichem Lauf verdeckte genau die Zeilen, wegen derer das
    // Protokoll gefuehrt wird; sichtbar bleiben sie in der Sicherungsliste.
    await t.service.createScheduled(t.server.id, testId('9'), false);
    await t.fertig();
    await t.service.applyRetention(t.server.id);

    expect(t.protokoll).toEqual([]);
  });
});
