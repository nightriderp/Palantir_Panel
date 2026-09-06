/**
 * Fehler an wartenden Pool-Verbindungen (Audit W0-5, backend-db-01).
 *
 * `pg.Pool` meldet Fehler idle gewordener Verbindungen als `error`-Ereignis.
 * Ohne Listener wird daraus eine unbehandelte Ausnahme – ein Neustart von
 * PostgreSQL beendete damit das Backend. `pg` und `env` sind hier Attrappen:
 * Es geht allein um die Registrierung des Listeners, nicht um die Datenbank.
 */

import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env.js', () => ({
  env: { DATABASE_URL: 'postgres://palantir:geheim@localhost:5432/palantir' },
}));

// `vi.mock` wird über die Imports gehoben – der `EventEmitter` kommt deshalb
// innerhalb der Fabrik, nicht aus dem Modul-Import oben.
vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events');

  class FakePool extends EventEmitter {
    readonly options: unknown;

    constructor(options: unknown) {
      super();
      this.options = options;
    }

    end(): Promise<void> {
      return Promise.resolve();
    }
  }

  return { default: { Pool: FakePool } };
});

import { attachPoolErrorHandler, closeDb, getPool } from './client.js';

afterEach(async () => {
  await closeDb();
  vi.restoreAllMocks();
});

describe('attachPoolErrorHandler()', () => {
  it('loggt einen Fehler an einer wartenden Verbindung, statt ihn als Ausnahme zu werfen', () => {
    const pool = new EventEmitter();
    const errors: { details: Record<string, unknown>; message: string }[] = [];

    attachPoolErrorHandler(pool, {
      error: (details, message) => {
        errors.push({ details, message });
      },
    });

    // Ohne Listener würde `emit('error')` werfen – genau das ist der Absturz.
    expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      details: { error: 'Connection terminated unexpectedly' },
    });
    expect(errors[0]?.message).toContain('Datenbank-Pool');
  });
});

describe('getPool()', () => {
  it('registriert den error-Listener am erzeugten Pool', () => {
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const pool = getPool();

    expect(pool.listenerCount('error')).toBe(1);
    expect(() => pool.emit('error', new Error('idle client error'))).not.toThrow();
    expect(konsole).toHaveBeenCalledTimes(1);
  });

  it('erzeugt den Pool nur einmal und hängt den Listener nicht doppelt an', () => {
    const erster = getPool();
    const zweiter = getPool();

    expect(zweiter).toBe(erster);
    expect(erster.listenerCount('error')).toBe(1);
  });
});
