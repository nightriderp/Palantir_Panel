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

/** Adresse des Containers im Spielenetz, wie `runtime.networkAddress` sie liefert. */
const NETZ_ADRESSE = '172.31.240.7';

function aufbau(
  ergebnis: ServerProbeResult | (() => ServerProbeResult) = ERREICHBAR,
  options: {
    resolveAddress?: (containerId: string) => Promise<string | null>;
    hostOverride?: string;
  } = {},
) {
  const timers = new FakeTimers();
  const scheduler = new JobScheduler({ timers });
  const events: OutboundEvent[] = [];
  const check = vi.fn<ServerProbe['check']>(async () =>
    typeof ergebnis === 'function' ? ergebnis() : ergebnis,
  );
  const probe: ServerProbe = { check };
  const resolveAddress = vi.fn(options.resolveAddress ?? (async () => NETZ_ADRESSE));

  const job = new ServerQueryJob({
    scheduler,
    probe,
    emit: (event) => events.push(event),
    defaultIntervalSeconds: 60,
    timeoutMs: 3_000,
    resolveAddress,
    ...(options.hostOverride === undefined ? {} : { hostOverride: options.hostOverride }),
    now: () => new Date('2026-08-26T12:00:00.000Z'),
  });

  return { timers, scheduler, events, check, resolveAddress, job };
}

const ZIEL = {
  containerId: 'container-a',
  hostPort: 30_000,
  containerPort: 25_565,
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

  it('fragt den Container an seiner Adresse im Spielenetz auf dem Container-Port (Fundpunkt 188)', async () => {
    /*
     * Nicht `127.0.0.1:<hostPort>`: Der Host-Port ist an 127.0.0.1 der Node
     * gebunden, und der Agent läuft im Compose-Netz – sein Loopback ist nicht
     * das der Node. Auf jeder echten Node kam dort ECONNREFUSED.
     */
    const { job, check, resolveAddress } = aufbau();
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    expect(resolveAddress).toHaveBeenCalledWith('container-a');
    expect(check).toHaveBeenCalledWith(
      { host: NETZ_ADRESSE, port: 25_565, query: { kind: 'portConnect' } },
      3_000,
    );
  });

  it('merkt sich die Adresse und löst erst nach einem Fehlschlag neu auf', async () => {
    let erreichbar = true;
    const { job, resolveAddress } = aufbau(() =>
      erreichbar ? ERREICHBAR : { ...ERREICHBAR, reachable: false, pingMs: null },
    );
    job.setTarget(SERVER_A, ZIEL);

    await job.queryOnce(SERVER_A);
    await job.queryOnce(SERVER_A);
    expect(resolveAddress).toHaveBeenCalledTimes(1);

    // Ein neu gebauter Container hat eine andere Adresse – nach einem
    // Fehlschlag darf die alte nicht weiter gefragt werden.
    erreichbar = false;
    await job.queryOnce(SERVER_A);
    erreichbar = true;
    await job.queryOnce(SERVER_A);
    expect(resolveAddress).toHaveBeenCalledTimes(2);
  });

  it('vergisst die Adresse, wenn ein neues Ziel gesetzt wird', async () => {
    const { job, resolveAddress } = aufbau();
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    job.setTarget(SERVER_A, { ...ZIEL, containerId: 'container-neu' });
    await job.queryOnce(SERVER_A);

    expect(resolveAddress).toHaveBeenCalledTimes(2);
    expect(resolveAddress).toHaveBeenLastCalledWith('container-neu');
  });

  it('meldet einen Container ohne Adresse im Spielenetz als nicht erreichbar, mit Grund', async () => {
    const { job, check, events } = aufbau(ERREICHBAR, { resolveAddress: async () => null });
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    // Die Sonde wird gar nicht erst gefragt – es gibt kein Ziel.
    expect(check).not.toHaveBeenCalled();
    expect(events[0]?.payload).toMatchObject({
      reachable: false,
      reason: expect.stringContaining('keine Adresse im Spielenetz') as string,
    });
  });

  it('meldet ein Ziel ohne Container-Port als nicht erreichbar, statt zu raten', async () => {
    const { containerPort: _weg, ...ohnePort } = ZIEL;
    const { job, check, events } = aufbau();
    job.setTarget(SERVER_A, ohnePort);
    await job.queryOnce(SERVER_A);

    expect(check).not.toHaveBeenCalled();
    expect(events[0]?.payload).toMatchObject({
      reachable: false,
      reason: expect.stringContaining('keinen Container-Port') as string,
    });
  });

  it('macht aus einem Fehler beim Auflösen ein Messergebnis, keinen Abbruch', async () => {
    const { job, events } = aufbau(ERREICHBAR, {
      resolveAddress: () => Promise.reject(new Error('Socket-Proxy antwortet nicht')),
    });
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    expect(events[0]?.payload).toMatchObject({
      reachable: false,
      reason: expect.stringContaining('Socket-Proxy antwortet nicht') as string,
    });
  });

  it('nimmt eine ausdrückliche Adresse aus dem Ziel, dann mit dem Host-Port', async () => {
    const { job, check, resolveAddress } = aufbau();
    job.setTarget(SERVER_A, { ...ZIEL, host: '10.10.0.2' });
    await job.queryOnce(SERVER_A);

    expect(resolveAddress).not.toHaveBeenCalled();
    expect(check.mock.calls[0]?.[0]).toMatchObject({ host: '10.10.0.2', port: 30_000 });
  });

  it('nimmt AGENT_QUERY_HOST als Adresse, wenn gesetzt – für Agents auf dem Docker-Host', async () => {
    const { job, check, resolveAddress } = aufbau(ERREICHBAR, { hostOverride: '127.0.0.1' });
    job.setTarget(SERVER_A, ZIEL);
    await job.queryOnce(SERVER_A);

    expect(resolveAddress).not.toHaveBeenCalled();
    expect(check.mock.calls[0]?.[0]).toMatchObject({ host: '127.0.0.1', port: 30_000 });
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
      resolveAddress: async () => NETZ_ADRESSE,
    });

    job.setTarget(SERVER_A, ZIEL);
    await timers.advance(30_000);

    expect(aufrufe).toBeGreaterThanOrEqual(3);
  });
});
