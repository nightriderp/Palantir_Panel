/**
 * Absicherung nicht abgewarteter Promises (Audit W0-5, Fundpunkt 126).
 *
 * Der Spion an `unhandledRejection` ist die eigentliche Prüfung: Node würde
 * den Prozess bei einer unbehandelten Ablehnung beenden – Vitest bricht den
 * Lauf dann ebenfalls ab. Der Spion macht die Erwartung ausdrücklich.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consoleFireAndForgetLogger, fireAndForget } from './fire-and-forget.js';

interface LoggedError {
  readonly details: Record<string, unknown>;
  readonly message: string;
}

const rejections: unknown[] = [];
const spion = (reason: unknown): void => {
  rejections.push(reason);
};

/** Lässt Mikrotasks und die Ablehnungs-Meldung von Node durchlaufen. */
async function tick(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function makeLog(): {
  errors: LoggedError[];
  log: { error(d: Record<string, unknown>, m: string): void };
} {
  const errors: LoggedError[] = [];

  return {
    errors,
    log: {
      error: (details, message): void => {
        errors.push({ details, message });
      },
    },
  };
}

beforeEach(() => {
  rejections.length = 0;
  process.on('unhandledRejection', spion);
});

afterEach(() => {
  process.off('unhandledRejection', spion);
});

describe('fireAndForget()', () => {
  it('loggt eine Ablehnung mit Kontext, statt sie unbehandelt zu lassen', async () => {
    const { errors, log } = makeLog();

    fireAndForget(Promise.reject(new Error('Datenbank weg')), log, {
      vorgang: 'Ist-Zustand abgleichen',
      hostId: 'host-1',
    });
    await tick();

    expect(rejections).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      message: 'Hintergrundvorgang fehlgeschlagen',
      details: { vorgang: 'Ist-Zustand abgleichen', hostId: 'host-1', error: 'Datenbank weg' },
    });
    expect(typeof errors[0]?.details.stack).toBe('string');
  });

  it('nimmt den Vorgang auch als schlichten Text', async () => {
    const { errors, log } = makeLog();

    fireAndForget(Promise.reject(new Error('kaputt')), log, 'Durchlauf des Zeitgebers');
    await tick();

    expect(errors[0]?.details.vorgang).toBe('Durchlauf des Zeitgebers');
  });

  it('loggt bei Erfolg nichts', async () => {
    const { errors, log } = makeLog();

    fireAndForget(Promise.resolve('fertig'), log, 'irgendwas');
    await tick();

    expect(errors).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('kommt mit einem synchron abgeschlossenen Handler zurecht', async () => {
    // `AgentSessionHandlers` dürfen `void` zurückgeben – dann gibt es nichts zu fangen.
    const { errors, log } = makeLog();

    fireAndForget(undefined, log, 'synchroner Handler');
    await tick();

    expect(errors).toEqual([]);
    expect(rejections).toEqual([]);
  });

  it('schreibt einen Nicht-Error-Grund als Text ins Log', async () => {
    const { errors, log } = makeLog();

    fireAndForget(Promise.reject('nur ein String'), log, 'x');
    await tick();

    expect(errors[0]?.details.error).toBe('nur ein String');
    expect(errors[0]?.details.stack).toBeUndefined();
  });

  it('lässt einen werfenden Logger nicht zur unbehandelten Ablehnung werden', async () => {
    const log = {
      error: (): void => {
        throw new Error('Logger kaputt');
      },
    };

    fireAndForget(Promise.reject(new Error('eigentlicher Fehler')), log, 'x');
    await tick();

    expect(rejections).toEqual([]);
  });

  it('bietet einen console-Rückfall für Stellen ohne strukturierten Logger', () => {
    // Nur die Form: Der Rückfall muss dieselbe Signatur haben wie `app.log.error`.
    expect(typeof consoleFireAndForgetLogger.error).toBe('function');
  });
});
