/**
 * Geplante Aufgaben eines Servers (Arbeitspaket P3, Lastenheft §3.3).
 *
 * Geprüft wird der Dienst gegen ein Repository im Speicher: Anlegen, Ändern,
 * Löschen, die Abgrenzung zum Backup-Zeitplan – und der Durchlauf des
 * Zeitgebers samt der Reihenfolge „nächsten Termin fortschreiben, dann
 * ausführen", die eine gescheiterte Aufgabe davor bewahrt, dauerhaft fällig zu
 * bleiben.
 */

import { type ScheduleRunResult } from '@palantir/contracts';
import { type ScheduleInput } from '@palantir/validation';
import { describe, expect, it } from 'vitest';
import {
  type CreateServerScheduleData,
  type ServerScheduleRecord,
  type ServerScheduleRepository,
  type UpdateServerScheduleData,
} from './schedule-repository.js';
import { type ScheduleExecutor, createServerScheduleService, toScheduleDto } from './schedules.js';

const SERVER_ID = '11111111-1111-4111-8111-111111111111';
const FREMDER_SERVER_ID = '99999999-9999-4999-8999-999999999999';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';

/** Fester Zeitpunkt: Dienstag, 1. September 2026, 10:00 Uhr UTC. */
const JETZT = new Date('2026-09-01T10:00:00.000Z');

function eingabe(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    name: 'Nächtlicher Neustart',
    action: 'restart',
    command: null,
    cronExpression: '0 4 * * *',
    timezone: 'Europe/Berlin',
    enabled: true,
    ...overrides,
  };
}

/** Repository im Speicher – dieselbe Schnittstelle wie die Drizzle-Umsetzung. */
function createMemoryRepository(): ServerScheduleRepository & {
  readonly rows: ServerScheduleRecord[];
} {
  const rows: ServerScheduleRecord[] = [];
  let counter = 0;

  function ersetze(id: string, patch: Partial<ServerScheduleRecord>): ServerScheduleRecord {
    const index = rows.findIndex((row) => row.id === id);

    if (index < 0) {
      throw new Error(`Aufgabe ${id} existiert nicht.`);
    }

    const aktualisiert = { ...(rows[index] as ServerScheduleRecord), ...patch };
    rows[index] = aktualisiert;

    return aktualisiert;
  }

  return {
    rows,

    async listByServer(serverId) {
      return rows.filter((row) => row.serverId === serverId);
    },

    async findById(scheduleId) {
      return rows.find((row) => row.id === scheduleId) ?? null;
    },

    async create(data: CreateServerScheduleData) {
      counter += 1;

      const record: ServerScheduleRecord = {
        id: `schedule-${String(counter)}`,
        serverId: data.serverId,
        name: data.name,
        action: data.action,
        command: data.command,
        cronExpression: data.cronExpression,
        timezone: data.timezone,
        enabled: data.enabled,
        lastRunAt: null,
        lastRunResult: null,
        nextRunAt: data.nextRunAt,
      };

      rows.push(record);

      return record;
    },

    async update(scheduleId, data: UpdateServerScheduleData) {
      return ersetze(scheduleId, {
        name: data.name,
        action: data.action,
        command: data.command,
        cronExpression: data.cronExpression,
        timezone: data.timezone,
        enabled: data.enabled,
        nextRunAt: data.nextRunAt,
      });
    },

    async remove(scheduleId) {
      const index = rows.findIndex((row) => row.id === scheduleId);

      if (index >= 0) {
        rows.splice(index, 1);
      }
    },

    async listDue(now) {
      return rows.filter(
        (row) => row.enabled && row.nextRunAt !== null && row.nextRunAt.getTime() <= now.getTime(),
      );
    },

    async markRun(scheduleId, lastRunAt, nextRunAt) {
      ersetze(scheduleId, { lastRunAt, nextRunAt, lastRunResult: null });
    },

    async markResult(scheduleId, result: ScheduleRunResult) {
      ersetze(scheduleId, { lastRunResult: result });
    },
  };
}

interface Mitschrift {
  readonly restarts: { serverId: string; actorUserId: string }[];
  readonly commands: { serverId: string; command: string }[];
}

function createExecutor(options: { scheitert?: boolean } = {}): ScheduleExecutor & {
  readonly mitschrift: Mitschrift;
} {
  const mitschrift: Mitschrift = { restarts: [], commands: [] };

  return {
    mitschrift,
    async restartServer(serverId, actorUserId) {
      if (options.scheitert === true) {
        throw new Error('Neustart fehlgeschlagen.');
      }

      mitschrift.restarts.push({ serverId, actorUserId });

      return undefined;
    },
    async execConsole(serverId, commandLine) {
      if (options.scheitert === true) {
        throw new Error('Befehl fehlgeschlagen.');
      }

      mitschrift.commands.push({ serverId, command: commandLine });

      return undefined;
    },
  };
}

function buildService(options: { scheitert?: boolean } = {}) {
  const repository = createMemoryRepository();
  const executor = createExecutor(options);
  const service = createServerScheduleService({
    repository,
    servers: { findById: async () => ({ ownerId: OWNER_ID }) },
    executor,
    now: () => JETZT,
  });

  return { repository, executor, service };
}

describe('ServerScheduleService – Verwaltung', () => {
  it('legt eine Aufgabe an und rechnet den nächsten Lauf in ihrer Zeitzone aus', async () => {
    const { service } = buildService();

    const record = await service.create(SERVER_ID, eingabe());

    expect(record.name).toBe('Nächtlicher Neustart');
    expect(record.action).toBe('restart');
    expect(record.command).toBeNull();
    // 04:00 Berliner Zeit sind im September 02:00 UTC – am Folgetag, weil
    // 10:00 UTC bereits nach dem heutigen Termin liegt.
    expect(record.nextRunAt?.toISOString()).toBe('2026-09-02T02:00:00.000Z');
  });

  it('rechnet dieselbe Uhrzeit in einer anderen Zeitzone auf einen anderen Zeitpunkt', async () => {
    const { service } = buildService();

    const record = await service.create(SERVER_ID, eingabe({ timezone: 'America/New_York' }));

    expect(record.nextRunAt?.toISOString()).toBe('2026-09-02T08:00:00.000Z');
  });

  it('merkt sich den Konsolenbefehl nur bei der Aktion „command"', async () => {
    const { service } = buildService();

    const befehl = await service.create(
      SERVER_ID,
      eingabe({ action: 'command', command: 'say Neustart in 5 Minuten' }),
    );
    const neustart = await service.create(
      SERVER_ID,
      eingabe({ action: 'restart', command: 'wird verworfen' }),
    );

    expect(befehl.command).toBe('say Neustart in 5 Minuten');
    expect(neustart.command).toBeNull();
  });

  it('speichert eine abgeschaltete Aufgabe ohne nächsten Lauf', async () => {
    const { service } = buildService();

    const record = await service.create(SERVER_ID, eingabe({ enabled: false }));

    expect(record.nextRunAt).toBeNull();
    expect(
      toScheduleDto(record, { canEdit: true, canDelete: true, canToggle: true }).nextRunAt,
    ).toBeNull();
  });

  it('weist den Backup-Zeitplan ab – der gehört zu den Sicherungen', async () => {
    const { service } = buildService();

    await expect(service.create(SERVER_ID, eingabe({ action: 'backup' }))).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('weist eine unbekannte Zeitzone ab', async () => {
    const { service } = buildService();

    await expect(
      service.create(SERVER_ID, eingabe({ timezone: 'Mars/Olympus_Mons' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('weist einen unerfüllbaren Cron-Ausdruck ab', async () => {
    const { service } = buildService();

    await expect(
      service.create(SERVER_ID, eingabe({ cronExpression: '0 4 30 2 *' })),
    ).rejects.toMatchObject({ code: 'SCHEDULE_INVALID_CRON' });
  });

  it('ändert eine Aufgabe und schreibt den nächsten Lauf neu', async () => {
    const { service } = buildService();
    const angelegt = await service.create(SERVER_ID, eingabe());

    const geaendert = await service.update(
      SERVER_ID,
      angelegt.id,
      eingabe({ name: 'Mittagsneustart', cronExpression: '30 12 * * *' }),
    );

    expect(geaendert.name).toBe('Mittagsneustart');
    expect(geaendert.nextRunAt?.toISOString()).toBe('2026-09-01T10:30:00.000Z');
  });

  it('meldet eine Aufgabe an einem anderen Server als nicht gefunden', async () => {
    const { service } = buildService();
    const angelegt = await service.create(SERVER_ID, eingabe());

    await expect(service.update(FREMDER_SERVER_ID, angelegt.id, eingabe())).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
    });
    await expect(service.remove(FREMDER_SERVER_ID, angelegt.id)).rejects.toMatchObject({
      code: 'SCHEDULE_NOT_FOUND',
    });
  });

  it('löscht eine Aufgabe', async () => {
    const { repository, service } = buildService();
    const angelegt = await service.create(SERVER_ID, eingabe());

    await service.remove(SERVER_ID, angelegt.id);

    expect(await service.list(SERVER_ID)).toHaveLength(0);
    expect(repository.rows).toHaveLength(0);
  });
});

describe('ServerScheduleService – Durchlauf des Zeitgebers', () => {
  it('führt eine fällige Neustart-Aufgabe im Namen des Besitzers aus', async () => {
    const { executor, repository, service } = buildService();
    const angelegt = await service.create(SERVER_ID, eingabe());
    await repository.markRun(angelegt.id, JETZT, new Date(JETZT.getTime() - 60_000));

    const result = await service.tick();

    expect(result.executedScheduleIds).toEqual([angelegt.id]);
    expect(executor.mitschrift.restarts).toEqual([{ serverId: SERVER_ID, actorUserId: OWNER_ID }]);
  });

  it('schreibt den nächsten Termin fort und hält den Ausgang fest', async () => {
    const { repository, service } = buildService();
    const angelegt = await service.create(SERVER_ID, eingabe());
    await repository.markRun(angelegt.id, JETZT, new Date(JETZT.getTime() - 60_000));

    await service.tick();

    const danach = await repository.findById(angelegt.id);

    expect(danach?.lastRunAt?.toISOString()).toBe(JETZT.toISOString());
    expect(danach?.lastRunResult).toBe('success');
    expect(danach?.nextRunAt?.toISOString()).toBe('2026-09-02T02:00:00.000Z');
  });

  it('schickt einen Konsolenbefehl über die Konsole', async () => {
    const { executor, repository, service } = buildService();
    const angelegt = await service.create(
      SERVER_ID,
      eingabe({ action: 'command', command: 'say hallo' }),
    );
    await repository.markRun(angelegt.id, JETZT, new Date(JETZT.getTime() - 60_000));

    await service.tick();

    expect(executor.mitschrift.commands).toEqual([{ serverId: SERVER_ID, command: 'say hallo' }]);
  });

  it('lässt eine gescheiterte Aufgabe nicht dauerhaft fällig bleiben', async () => {
    const { repository, service } = buildService({ scheitert: true });
    const angelegt = await service.create(SERVER_ID, eingabe());
    await repository.markRun(angelegt.id, JETZT, new Date(JETZT.getTime() - 60_000));

    const result = await service.tick();
    const danach = await repository.findById(angelegt.id);

    expect(result.failedScheduleIds).toEqual([angelegt.id]);
    expect(danach?.lastRunResult).toBe('failed');
    expect(danach?.nextRunAt?.getTime()).toBeGreaterThan(JETZT.getTime());
  });

  it('lässt abgeschaltete und noch nicht fällige Aufgaben unangetastet', async () => {
    const { executor, service } = buildService();
    await service.create(SERVER_ID, eingabe({ enabled: false }));
    await service.create(SERVER_ID, eingabe());

    const result = await service.tick();

    expect(result.executedScheduleIds).toHaveLength(0);
    expect(executor.mitschrift.restarts).toHaveLength(0);
  });
});
