import { describe, expect, it, vi } from 'vitest';
import type { OutboundEvent } from '../../connection/ports.js';
import { JobScheduler } from '../scheduler.js';
import { FakeTimers } from '../test-timers.js';
import type { ServerProbe, ServerProbeResult } from './probe.js';
import { ServerQueryJob, queryJobName } from './server-query-job.js';

const SERVER_A = '3f1d6f4e-1b1e-4b6a-9a3f-2c1d4e5f6a7b';
const SERVER_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const ERREICHBAR: ServerProbeResult = {
  reachable: true,
  pingMs: 5,
  playersOnline: null,
  playersMax: null,
  players: [],
  reason: null,
};

function aufbau(ergebnis: ServerProbeResult | (() => ServerProbeResult) = ERREICHBAR) {
  const timers = new FakeTimers();
  const scheduler = new JobScheduler({ timers });
  const events: OutboundEvent[] = [];
  const check = vi.fn<ServerProbe['check']>(async () =>
    typeof ergebnis === 'function' ? ergebnis() : ergebnis,
  );
  const probe: ServerProbe = { check };

  const job = new ServerQueryJob({
    scheduler,
    probe,
    emit: (event) => events.push(event),
    defaultIntervalSeconds: 60,
    timeoutMs: 3_000,
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  });

  return { timers, scheduler, events, check, job };
}

const ZIEL = {
  containerId: 'container-a',
  hostPort: 30_000,
  query: { kind: 'portConnect' } as const,
};

describe('ServerQueryJob – Ziele setzen (SET_SERVER_QUERY)', () => {
  it('meldet das gesetzte Ziel mit dem tatsächlich benutzten Takt', () => {
    const { job } = aufbau();
    expect(job.setTarget(SERVER_A, ZIEL)).toEqual({
      serverId: SERVER_A,
      active: true,
      intervalSeconds: 60,
    });
  });

  it('nimmt den Takt aus dem Ziel, wenn einer mitkommt', () => {
    const { job } = aufbau();
    expect(job.setTarget(SERVER_A, { ...ZIEL, intervalSeconds: 15 }).intervalSeconds).toBe(15);
  });

  it('beendet die Abfrage mit target: null', () => {
    const { job, scheduler } = aufbau();
    job.setTarget(SERVER_A, ZIEL);

    expect(job.setTarget(SERVER_A, null)).toEqual({
      serverId: SERVER_A,
      active: false,
      intervalSeconds: null,
    });
    expect(job.activeServerIds).toEqual([]);
    expect(scheduler.jobNames).toEqual([]);
  });

  it('ersetzt ein bestehendes Ziel, statt ein zweites anzulegen', () => {
    // Idempotenz: Das Backend darf den Befehl nach jedem Verbindungsaufbau
    // für alle laufenden Server wiederholen.
    const { job, scheduler } = aufbau();
    job.setTarget(SERVER_A, ZIEL);
    job.setTarget(SERVER_A, { ...ZIEL, hostPort: 30_001 });

    expect(scheduler.jobNames).toEqual([queryJobName(SERVER_A)]);
    expect(job.getTarget(SERVER_A)?.hostPort).toBe(30_001);
  });

  it('hält mehrere Server unabhängig voneinander', () => {
    const { job } = aufbau();
    job.setTarget(SERVER_A, ZIEL);
    job.setTarget(SERVER_B, ZIEL);

    expect(job.activeServerIds).toEqual([SERVER_A, SERVER_B]);

    job.setTarget(SERVER_A, null);
    expect(job.activeServerIds).toEqual([SERVER_B]);
  });

  it('beendet über stopAll() jede Abfrage', () => {
    const { job, scheduler } = aufbau();
    job.setTarget(SERVER_A, ZIEL);
    job.setTarget(SERVER_B, ZIEL);

    job.stopAll();
    expect(job.activeServerIds).toEqual([]);
    expect(scheduler.jobNames).toEqual([]);
  });
});

describe('ServerQueryJob – Abfrage und Meldung', () => {
  it('fragt im eingestellten Takt ab', async () => {
    const { job, timers, check } = aufbau();
    job.setTarget(SERVER_A, { ...ZIEL, intervalSeconds: 10 });

    await timers.advance(9_000);
    expect(check).not.toHaveBeenCalled();

    await timers.advance(21_000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('prüft den Host-Port auf 127.0.0.1 – die Portbindung liegt am Homeserver', async () => {
    const { job, check } = aufbau();
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    expect(check).toHaveBeenCalledWith(
      { host: '127.0.0.1', port: 30_000, query: { kind: 'portConnect' } },
      3_000,
    );
  });

  it('nimmt eine abweichende Adresse aus dem Ziel', async () => {
    const { job, check } = aufbau();
    job.setTarget(SERVER_A, { ...ZIEL, host: '10.10.0.2' });
    await job.queryOnce(SERVER_A);

    expect(check.mock.calls[0]?.[0]).toMatchObject({ host: '10.10.0.2' });
  });

  it('meldet das Ergebnis als STATS_UPDATE mit der Server-Id', async () => {
    const { job, events } = aufbau({
      reachable: true,
      pingMs: 7,
      playersOnline: 4,
      playersMax: 20,
      players: [],
      reason: null,
    });
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    expect(events).toEqual([
      {
        event: 'STATS_UPDATE',
        serverId: SERVER_A,
        payload: {
          source: 'serverQuery',
          containerId: 'container-a',
          reachable: true,
          playersOnline: 4,
          playersMax: 20,
          pingMs: 7,
          reason: null,
          at: '2026-08-26T12:00:00.000Z',
        },
      },
    ]);
  });

  it('meldet auch einen nicht erreichbaren Server, statt zu schweigen', async () => {
    // Für das Backend sähe Schweigen genauso aus wie ein Agent, der gar nicht
    // fragt. Der Unterschied muss sichtbar bleiben.
    const { job, events } = aufbau({
      reachable: false,
      pingMs: null,
      playersOnline: null,
      playersMax: null,
      players: [],
      reason: 'Der Server war nicht erreichbar (ECONNREFUSED).',
    });
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      reachable: false,
      reason: 'Der Server war nicht erreichbar (ECONNREFUSED).',
    });
  });

  it('fragt einen abgemeldeten Server nicht mehr ab', async () => {
    const { job, timers, check } = aufbau();
    job.setTarget(SERVER_A, { ...ZIEL, intervalSeconds: 10 });
    await timers.advance(10_000);
    expect(check).toHaveBeenCalledTimes(1);

    job.setTarget(SERVER_A, null);
    await timers.advance(60_000);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('läuft ins Leere, wenn das Ziel zwischen Takt und Abfrage entfällt', async () => {
    const { job, events } = aufbau();
    await job.queryOnce(SERVER_A);
    expect(events).toEqual([]);
  });

  it('bringt eine gescheiterte Abfrage den Takt nicht zum Erliegen', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers, onError: () => undefined });
    let aufrufe = 0;
    const job = new ServerQueryJob({
      scheduler,
      probe: {
        check: async () => {
          aufrufe += 1;
          if (aufrufe === 1) {
            throw new Error('Socket kaputt');
          }
          return ERREICHBAR;
        },
      },
      emit: () => undefined,
      defaultIntervalSeconds: 10,
      timeoutMs: 1_000,
    });

    job.setTarget(SERVER_A, ZIEL);
    await timers.advance(30_000);

    expect(aufrufe).toBeGreaterThanOrEqual(3);
  });
});
