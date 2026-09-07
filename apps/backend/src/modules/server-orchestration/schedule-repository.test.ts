import { describe, expect, it } from 'vitest';
import { type DbConnection } from '../../db/client.js';
import { createDrizzleServerScheduleRepository } from './schedule-repository.js';

/**
 * Audit W2-9, `orchestration-features-11`: Beide Schreibwege warfen einen rohen
 * `Error`, wenn `returning()` leer blieb – der globale Handler machte daraus
 * `INTERNAL_ERROR` (500), auch für den Alltagsfall „Aufgabe wurde im zweiten
 * Tab gelöscht". Geprüft wird ohne Datenbank: Der Drizzle-Aufrufbaum wird nur
 * so weit nachgebildet, wie das Repository ihn durchläuft.
 */

/** Nachbau der Kette `insert(...).values(...).returning()` – liefert keine Zeile. */
function dbOhneZeile(): DbConnection {
  const leer = { returning: () => Promise.resolve([]) };
  const attrappe = {
    insert: () => ({ values: () => leer }),
    update: () => ({ set: () => ({ where: () => leer }) }),
  };

  // Bewusst über `unknown` gecastet: Die echte Drizzle-Instanz hat Dutzende
  // Methoden, von denen dieser Test genau zwei anfasst.
  return attrappe as unknown as DbConnection;
}

const CREATE_DATA = {
  serverId: '11111111-1111-4111-8111-000000000001',
  name: 'Nächtlicher Neustart',
  action: 'restart' as const,
  command: null,
  cronExpression: '0 4 * * *',
  timezone: 'Europe/Berlin',
  enabled: true,
  nextRunAt: null,
};

describe('Geplante Aufgaben: Schreibwege ohne Ergebniszeile', () => {
  it('meldet eine zwischenzeitlich gelöschte Aufgabe als SCHEDULE_NOT_FOUND', async () => {
    const repository = createDrizzleServerScheduleRepository(dbOhneZeile());

    await expect(
      repository.update('22222222-2222-4222-8222-000000000002', CREATE_DATA),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' });
  });

  it('meldet ein wirkungsloses Anlegen mit einem benannten Code statt als rohem Fehler', async () => {
    const repository = createDrizzleServerScheduleRepository(dbOhneZeile());

    await expect(repository.create(CREATE_DATA)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});
