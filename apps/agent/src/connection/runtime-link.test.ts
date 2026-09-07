/**
 * Tests des Verbindungsaufbaus zur Container-Runtime (Audit agent-conn-01).
 *
 * Geprüft wird der Ablauf, der bisher fehlte: Ein Fehlschlag beim Start darf
 * den Agent nicht für seine gesamte Laufzeit ohne Ereignisstrom zurücklassen.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionLogger } from './agent-connection.js';
import type { OutboundEventSink } from './runtime-adapter.js';
import { startRuntimeLink } from './runtime-link.js';

const stillesLog: ConnectionLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const emit: OutboundEventSink = () => undefined;

/** Adapter-Attrappe: Der Test interessiert sich nur dafür, ob er angehängt wird. */
function adapterAttrappe(): { start: (senke: OutboundEventSink) => void; aufrufe: number } {
  const attrappe = {
    aufrufe: 0,
    start: (_senke: OutboundEventSink): void => {
      attrappe.aufrufe += 1;
    },
  };
  return attrappe;
}

describe('Verbindungsaufbau zur Container-Runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hängt den Adapter an, sobald connect() gelingt', async () => {
    const adapter = adapterAttrappe();
    const link = startRuntimeLink({
      runtime: { connect: async () => undefined },
      adapter,
      emit,
      logger: stillesLog,
    });

    await vi.advanceTimersByTimeAsync(0);

    expect(adapter.aufrufe).toBe(1);
    link.stop();
  });

  it('versucht es nach einem Fehlschlag erneut', async () => {
    // Der Docker-Socket-Proxy ist beim Start noch nicht da (Startreihenfolge in
    // deploy/gamenode/docker-compose.yml).
    let versuche = 0;
    const connect = async (): Promise<void> => {
      versuche += 1;
      if (versuche === 1) throw new Error('ECONNREFUSED');
    };
    const adapter = adapterAttrappe();

    const link = startRuntimeLink({
      runtime: { connect },
      adapter,
      emit,
      logger: stillesLog,
      backoff: { jitterRatio: 0 },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(versuche).toBe(1);
    expect(adapter.aufrufe).toBe(0);

    await vi.advanceTimersByTimeAsync(1_000);

    expect(versuche).toBe(2);
    expect(adapter.aufrufe).toBe(1);
    link.stop();
  });

  it('wartet nach jedem Fehlschlag länger', async () => {
    let versuche = 0;
    const connect = async (): Promise<void> => {
      versuche += 1;
      throw new Error('ECONNREFUSED');
    };
    const adapter = adapterAttrappe();

    const link = startRuntimeLink({
      runtime: { connect },
      adapter,
      emit,
      logger: stillesLog,
      backoff: { jitterRatio: 0 },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(versuche).toBe(2);

    // Der dritte Versuch kommt erst nach der doppelten Wartezeit.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(versuche).toBe(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(versuche).toBe(3);

    link.stop();
  });

  it('unternimmt nach stop() keinen weiteren Versuch', async () => {
    let versuche = 0;
    const connect = async (): Promise<void> => {
      versuche += 1;
      throw new Error('ECONNREFUSED');
    };
    const adapter = adapterAttrappe();

    const link = startRuntimeLink({
      runtime: { connect },
      adapter,
      emit,
      logger: stillesLog,
      backoff: { jitterRatio: 0 },
    });

    await vi.advanceTimersByTimeAsync(0);
    link.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(versuche).toBe(1);
  });
});
