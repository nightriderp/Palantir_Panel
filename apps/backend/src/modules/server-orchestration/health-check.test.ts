/**
 * Tests des Health-Checks (Pflichtenheft §9).
 *
 * Der Port-Connect-Test wird gegen einen echten, kurzlebigen TCP-Listener
 * geprüft – eine Sonde, die nur gegen eine Attrappe getestet ist, würde ihren
 * eigentlichen Zweck (lauscht da wirklich jemand?) nicht belegen.
 */

import net from 'node:net';
import { type GameQuerySpec } from '@palantir/contracts';
import { afterAll, describe, expect, it } from 'vitest';
import {
  type HealthCheckResult,
  type HealthCheckTarget,
  type HealthProbe,
  awaitHealthy,
  createHealthProbe,
  createPortConnectProbe,
} from './health-check.js';

const PORT_CONNECT: GameQuerySpec = { kind: 'portConnect', containerPort: 8080 };

const listeners: net.Server[] = [];

async function startListener(): Promise<number> {
  const server = net.createServer();

  listeners.push(server);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Der Test-Listener hat keinen Port bekommen.');
  }

  return address.port;
}

afterAll(async () => {
  await Promise.all(
    listeners.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

describe('Port-Connect-Test', () => {
  it('meldet einen lauschenden Port als erreichbar', async () => {
    const port = await startListener();
    const result = await createPortConnectProbe().check(
      { host: '127.0.0.1', port, query: PORT_CONNECT },
      1_000,
    );

    expect(result.healthy).toBe(true);
    expect(result.pingMs).not.toBeNull();
    expect(result.reason).toBeNull();
  });

  it('meldet einen geschlossenen Port als nicht erreichbar', async () => {
    const port = await startListener();

    await new Promise<void>((resolve) => {
      listeners[listeners.length - 1]?.close(() => {
        resolve();
      });
    });

    const result = await createPortConnectProbe().check(
      { host: '127.0.0.1', port, query: PORT_CONNECT },
      1_000,
    );

    expect(result.healthy).toBe(false);
    expect(result.reason).not.toBeNull();
  });

  it('liefert keine Spielerzahl – dafür braucht es das Spieleprotokoll', async () => {
    const port = await startListener();
    const result = await createPortConnectProbe().check(
      { host: '127.0.0.1', port, query: PORT_CONNECT },
      1_000,
    );

    expect(result.playersOnline).toBeNull();
    expect(result.playersMax).toBeNull();
  });
});

describe('Auswahl der Sonde', () => {
  it('nutzt für portConnect den Port-Connect-Test', async () => {
    let called = false;
    const inner: HealthProbe = {
      check: (): Promise<HealthCheckResult> => {
        called = true;

        return Promise.resolve({
          healthy: true,
          pingMs: 1,
          playersOnline: null,
          playersMax: null,
          reason: null,
        });
      },
    };

    await createHealthProbe(inner).check({ host: '127.0.0.1', port: 1, query: PORT_CONNECT }, 100);

    expect(called).toBe(true);
  });

  it('meldet gamedig als noch nicht umgesetzt, statt still auf Port-Connect auszuweichen', async () => {
    // Ein stiller Rückfall würde eine Erreichbarkeit vortäuschen, die nie
    // geprüft wurde.
    const result = await createHealthProbe().check(
      {
        host: '127.0.0.1',
        port: 1,
        query: { kind: 'gamedig', protocol: 'minecraft', containerPort: 25_565 },
      },
      100,
    );

    expect(result.healthy).toBe(false);
    expect(result.reason).toContain('gamedig');
  });
});

describe('awaitHealthy() – Warten auf den Hochlauf', () => {
  const target: HealthCheckTarget = { host: '127.0.0.1', port: 1, query: PORT_CONNECT };

  function probeThatSucceedsAfter(attempts: number): { probe: HealthProbe; calls: () => number } {
    let calls = 0;

    return {
      probe: {
        check: (): Promise<HealthCheckResult> => {
          calls += 1;

          return Promise.resolve(
            calls >= attempts
              ? { healthy: true, pingMs: 5, playersOnline: null, playersMax: null, reason: null }
              : {
                  healthy: false,
                  pingMs: null,
                  playersOnline: null,
                  playersMax: null,
                  reason: 'fährt hoch',
                },
          );
        },
      },
      calls: () => calls,
    };
  }

  it('gibt einem Server Zeit zum Hochlaufen', async () => {
    // Ein einzelner fehlgeschlagener Versuch bedeutet nichts.
    const { probe, calls } = probeThatSucceedsAfter(3);
    let elapsed = 0;

    const result = await awaitHealthy({
      target,
      startupTimeoutMs: 60_000,
      attemptTimeoutMs: 1_000,
      intervalMs: 1_000,
      probe,
      sleep: (ms) => {
        elapsed += ms;

        return Promise.resolve();
      },
      now: () => elapsed,
    });

    expect(result.healthy).toBe(true);
    expect(calls()).toBe(3);
  });

  it('gibt auf, wenn die Startfrist abläuft', async () => {
    const probe: HealthProbe = {
      check: (): Promise<HealthCheckResult> =>
        Promise.resolve({
          healthy: false,
          pingMs: null,
          playersOnline: null,
          playersMax: null,
          reason: 'nichts da',
        }),
    };

    let elapsed = 0;

    const result = await awaitHealthy({
      target,
      startupTimeoutMs: 5_000,
      attemptTimeoutMs: 500,
      intervalMs: 1_000,
      probe,
      sleep: (ms) => {
        elapsed += ms;

        return Promise.resolve();
      },
      now: () => elapsed,
    });

    expect(result.healthy).toBe(false);
    expect(result.reason).toContain('5 Sekunden');
    expect(result.reason).toContain('nichts da');
  });

  it('wartet gar nicht, wenn der erste Versuch trägt', async () => {
    const { probe, calls } = probeThatSucceedsAfter(1);
    let slept = 0;

    await awaitHealthy({
      target,
      startupTimeoutMs: 60_000,
      attemptTimeoutMs: 1_000,
      intervalMs: 1_000,
      probe,
      sleep: (ms) => {
        slept += ms;

        return Promise.resolve();
      },
      now: () => 0,
    });

    expect(calls()).toBe(1);
    expect(slept).toBe(0);
  });
});
