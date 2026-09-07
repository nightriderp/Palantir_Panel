import { type Permission } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type PermissionActor, buildPermissionActor } from '../rbac/index.js';
import type { BackupServerRecord } from './ports.js';
import type { BackupRepository } from './repository.js';
import { type BackupScheduleService, createBackupScheduleService } from './schedules.js';
import { createBackupService } from './service.js';
import {
  type FakeAgent,
  fakeAgent,
  fakeServerDirectory,
  fakeUserDirectory,
  inMemoryBackupRepository,
  recordingEventPublisher,
  testId,
  testServer,
} from './test-doubles.js';

/** 26.08.2026, 12:00 lokal – Zeitpläne werden in der Zeitzone des Backends ausgewertet. */
const JETZT = new Date(2026, 7, 26, 12, 0);

function actorMit(...permissions: Permission[]): PermissionActor {
  return buildPermissionActor({ isOwner: false, roles: [{ grantedPermissions: permissions }] });
}

interface Aufbau {
  schedules: BackupScheduleService;
  repository: BackupRepository;
  agent: FakeAgent;
  server: BackupServerRecord;
  besitzerId: string;
  jetzt: Date;
  fertig(): Promise<void>;
}

function aufbau(): Aufbau {
  const besitzerId = testId('2');
  const server = testServer({ ownerId: besitzerId });
  const repository = inMemoryBackupRepository();
  const agent = fakeAgent();
  const offeneJobs: (() => Promise<void>)[] = [];
  const uhr = { jetzt: JETZT };

  const backups = createBackupService({
    repository,
    servers: fakeServerDirectory([server]),
    users: fakeUserDirectory({ [besitzerId]: 'Alex' }),
    agent,
    events: recordingEventPublisher(),
    now: () => uhr.jetzt,
    runJob: (job) => {
      offeneJobs.push(job);
    },
  });

  const schedules = createBackupScheduleService({
    repository,
    servers: fakeServerDirectory([server]),
    backups,
    now: () => uhr.jetzt,
  });

  return {
    schedules,
    repository,
    agent,
    server,
    besitzerId,
    get jetzt() {
      return uhr.jetzt;
    },
    set jetzt(wert: Date) {
      uhr.jetzt = wert;
    },
    async fertig() {
      while (offeneJobs.length > 0) {
        await offeneJobs.shift()?.();
      }
    },
  } as Aufbau;
}

describe('Backup-Zeitplan setzen (Lastenheft §3.3)', () => {
  it('rechnet beim Speichern den nächsten Lauf aus', async () => {
    const t = aufbau();

    const dto = await t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 4 * * *',
      stopServer: false,
    });

    expect(dto.enabled).toBe(true);
    expect(dto.nextRunAt).toBe(new Date(2026, 7, 27, 4, 0).toISOString());
    expect(dto.permissions.canEdit).toBe(true);
  });

  it('lehnt einen ungültigen Ausdruck ab, bevor irgendetwas gespeichert wird', async () => {
    const t = aufbau();

    await expect(
      t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
        enabled: true,
        cronExpression: '0 99 * * *',
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID_CRON' });

    // Ein gespeicherter Zeitplan, der nie auslöst, wäre schlimmer als eine
    // abgelehnte Eingabe.
    expect(await t.repository.findScheduleByServer(t.server.id)).toBeNull();
  });

  it('nennt bei abgeschaltetem Zeitplan keinen nächsten Lauf', async () => {
    const t = aufbau();

    const dto = await t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      enabled: false,
      cronExpression: '0 4 * * *',
      stopServer: false,
    });

    expect(dto.nextRunAt).toBeNull();
  });

  it('ersetzt einen vorhandenen Zeitplan, statt einen zweiten anzulegen', async () => {
    const t = aufbau();
    const actor = actorMit('backup.manage.own');

    await t.schedules.set(actor, t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 4 * * *',
      stopServer: false,
    });
    const zweiter = await t.schedules.set(actor, t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 5 * * *',
      stopServer: true,
    });

    expect(zweiter.cronExpression).toBe('0 5 * * *');
    expect((await t.repository.findScheduleByServer(t.server.id))?.stopServer).toBe(true);
  });

  it('verweigert fremde Server, wenn nur backup.manage.own vorliegt', async () => {
    const t = aufbau();

    await expect(
      t.schedules.set(actorMit('backup.manage.own'), testId('7'), t.server.id, {
        enabled: true,
        cronExpression: '0 4 * * *',
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'SERVER_NOT_FOUND' });
  });

  it('liefert null, wenn für den Server kein Zeitplan eingerichtet ist', async () => {
    const t = aufbau();

    expect(
      await t.schedules.get(actorMit('backup.manage.own'), t.besitzerId, t.server.id),
    ).toBeNull();
  });

  it('lehnt einen unerfüllbaren Ausdruck mit SCHEDULE_UNSATISFIABLE ab (Audit bb-14)', async () => {
    const t = aufbau();

    // Den 30. Februar gibt es nicht: Der Ausdruck zerlegt sauber, trifft aber
    // nie zu. Gespeichert wäre er ein Zeitplan, der für immer stumm bleibt.
    await expect(
      t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
        enabled: true,
        cronExpression: '0 4 30 2 *',
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_UNSATISFIABLE' });

    expect(await t.repository.findScheduleByServer(t.server.id)).toBeNull();
  });

  it('lehnt ihn auch bei abgeschaltetem Zeitplan ab – sonst schlüge es erst beim Einschalten zu', async () => {
    const t = aufbau();

    await expect(
      t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
        enabled: false,
        cronExpression: '0 4 30 2 *',
        stopServer: false,
      }),
    ).rejects.toMatchObject({ code: 'SCHEDULE_UNSATISFIABLE' });
  });

  it('liefert „sauberer Spielstand“ im DTO zurück (contracts-validation-03)', async () => {
    const t = aufbau();

    const dto = await t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 4 * * *',
      stopServer: true,
    });

    // Ohne das Feld konnte kein Formular den Ist-Zustand anzeigen oder beim
    // Umschalten von `enabled` wieder mitschicken – die Einstellung ging bei
    // jeder Änderung still verloren.
    expect(dto.stopServer).toBe(true);
  });

  it('antwortet auf set() mit demselben DTO wie get() (Audit bb-15)', async () => {
    const t = aufbau();
    const actor = actorMit('backup.manage.own');

    const gesetzt = await t.schedules.set(actor, t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 4 * * *',
      stopServer: true,
    });

    expect(await t.schedules.get(actor, t.besitzerId, t.server.id)).toEqual(gesetzt);
  });

  it('nennt beim Speichern den letzten Lauf des Zeitplans, nicht null', async () => {
    const t = aufbau();
    const actor = actorMit('backup.manage.own');

    await t.schedules.set(actor, t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 4 * * *',
      stopServer: false,
    });

    t.jetzt = new Date(2026, 7, 27, 4, 0);
    await t.schedules.tick();
    await t.fertig();

    const [backup] = await t.repository.listByServer(t.server.id);
    const erneutGesetzt = await t.schedules.set(actor, t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: '0 5 * * *',
      stopServer: false,
    });

    // Vorher stand hier fest `null`: Nach dem Speichern zeigte die Oberfläche
    // „noch nie gelaufen“, bis der Nutzer die Seite neu lud.
    expect(erneutGesetzt.lastBackupId).toBe(backup?.id);
    expect(await t.schedules.get(actor, t.besitzerId, t.server.id)).toEqual(erneutGesetzt);
  });
});

describe('Fälliger Zeitplan (automatische Backups)', () => {
  async function mitZeitplan(t: Aufbau, cron = '0 4 * * *'): Promise<void> {
    await t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      enabled: true,
      cronExpression: cron,
      stopServer: false,
    });
  }

  it('stößt nichts an, solange der Termin nicht erreicht ist', async () => {
    const t = aufbau();
    await mitZeitplan(t);

    expect(await t.schedules.tick()).toEqual({ startedScheduleIds: [], skippedScheduleIds: [] });
  });

  it('erzeugt zum Termin ein automatisches Backup ohne Auslöser', async () => {
    const t = aufbau();
    await mitZeitplan(t);

    t.jetzt = new Date(2026, 7, 27, 4, 0);
    const ergebnis = await t.schedules.tick();

    expect(ergebnis.startedScheduleIds).toHaveLength(1);

    const [backup] = await t.repository.listByServer(t.server.id);

    expect(backup?.type).toBe('automatic');
    // Geplante Backups haben keinen Auslöser: Dem Einrichter des Zeitplans
    // etwas zuzuschreiben, das er nicht getan hat, wäre irreführend.
    expect(backup?.createdByUserId).toBeNull();
    expect(backup?.scheduleId).not.toBeNull();
  });

  it('schreibt den nächsten Termin fort, auch wenn der Lauf scheitert', async () => {
    const t = aufbau();
    await mitZeitplan(t);

    // Ein bereits laufendes Backup lässt den geplanten Lauf ausfallen.
    t.jetzt = new Date(2026, 7, 27, 4, 0);
    await t.schedules.tick();
    t.jetzt = new Date(2026, 7, 28, 4, 0);
    const zweiter = await t.schedules.tick();

    expect(zweiter.skippedScheduleIds).toHaveLength(1);

    // Entscheidend: Der Zeitplan bleibt nicht dauerhaft fällig, sonst löste er
    // bei jedem Durchlauf erneut aus.
    const gespeichert = await t.repository.findScheduleByServer(t.server.id);

    expect(gespeichert?.nextRunAt).toEqual(new Date(2026, 7, 29, 4, 0));
    expect(gespeichert?.lastRunAt).toEqual(new Date(2026, 7, 28, 4, 0));
  });

  it('läuft an mehreren Terminen hintereinander', async () => {
    const t = aufbau();
    await mitZeitplan(t);

    t.jetzt = new Date(2026, 7, 27, 4, 0);
    await t.schedules.tick();
    await t.fertig();

    t.jetzt = new Date(2026, 7, 28, 4, 0);
    await t.schedules.tick();
    await t.fertig();

    const alle = await t.repository.listByServer(t.server.id);

    expect(alle).toHaveLength(2);
    expect(alle.every((backup) => backup.type === 'automatic')).toBe(true);
  });

  it('ignoriert abgeschaltete Zeitpläne', async () => {
    const t = aufbau();
    await t.schedules.set(actorMit('backup.manage.own'), t.besitzerId, t.server.id, {
      enabled: false,
      cronExpression: '0 4 * * *',
      stopServer: false,
    });

    t.jetzt = new Date(2026, 7, 27, 4, 0);

    expect((await t.schedules.tick()).startedScheduleIds).toEqual([]);
  });
});
