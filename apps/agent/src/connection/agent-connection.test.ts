import {
  AGENT_PROTOCOL_VERSION,
  type AgentContainerState,
  type AgentNodeStats,
  type AgentToBackendFrame,
  type ApiResponse,
  fail,
  ok,
} from '@palantir/contracts';
import { agentToBackendFrameSchema } from '@palantir/validation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentConnection, type ConnectionLogger } from './agent-connection.js';
import type { AgentRuntimePort, CommandExecution } from './ports.js';
import type { Transport, TransportFactory, TransportHandlers } from './transport.js';

const CORRELATION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ANDERE_ID = '9c858901-8a57-4791-81fe-4c455b099bc9';
const SERVER_ID = '11111111-2222-4333-8444-555555555555';

const LAUFENDER_CONTAINER: AgentContainerState = {
  serverId: SERVER_ID,
  containerId: 'abc123',
  status: 'running',
  exitCode: null,
  startedAt: '2026-08-26T09:00:00.000Z',
  observedAt: '2026-08-26T10:00:00.000Z',
};

/**
 * Testdouble der Übertragung (Pflichtenheft §2.5): Die Verbindungslogik wird
 * ohne echten Server geprüft – und ohne Auth-Bypass, denn das Token gehört zur
 * WebSocket-Implementierung, nicht hierher (CLAUDE.md §2).
 */
class FakeTransport implements Transport {
  readonly gesendet: string[] = [];
  geschlossen = false;

  constructor(readonly handlers: TransportHandlers) {}

  send(raw: string): void {
    this.gesendet.push(raw);
  }

  close(code?: number, reason?: string): void {
    if (this.geschlossen) {
      return;
    }
    this.geschlossen = true;
    this.handlers.onClose({ code: code ?? 1000, reason: reason ?? '', unauthorized: false });
  }

  /** Das Backend beendet die Verbindung (Netzwerkabbruch, Neustart, ...). */
  trennenVonAussen(unauthorized = false): void {
    if (this.geschlossen) {
      return;
    }
    this.geschlossen = true;
    this.handlers.onClose({ code: 1006, reason: 'Verbindung abgebrochen', unauthorized });
  }

  empfangen(frame: unknown): void {
    this.handlers.onMessage(typeof frame === 'string' ? frame : JSON.stringify(frame));
  }

  frames(): AgentToBackendFrame[] {
    return this.gesendet.map((raw) => JSON.parse(raw) as AgentToBackendFrame);
  }

  framesVomTyp<K extends AgentToBackendFrame['kind']>(
    kind: K,
  ): Extract<AgentToBackendFrame, { kind: K }>[] {
    return this.frames().filter((frame): frame is Extract<AgentToBackendFrame, { kind: K }> => {
      return frame.kind === kind;
    });
  }
}

const stillerLogger: ConnectionLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface Harness {
  readonly connection: AgentConnection;
  readonly transports: FakeTransport[];
  readonly ausgefuehrt: CommandExecution[];
  aktuellerTransport(): FakeTransport;
}

function harness(
  runtime: Partial<AgentRuntimePort> = {},
  readNodeStats?: () => Promise<AgentNodeStats | null>,
): Harness {
  const transports: FakeTransport[] = [];
  const ausgefuehrt: CommandExecution[] = [];

  const factory: TransportFactory = (handlers) => {
    const transport = new FakeTransport(handlers);
    transports.push(transport);
    return transport;
  };

  const connection = new AgentConnection({
    transportFactory: factory,
    agentVersion: '0.1.0-test',
    logger: stillerLogger,
    // Jitter aus, damit die Wartezeiten im Test exakt vorhersagbar sind.
    backoff: { initialDelayMs: 1_000, factor: 2, jitterRatio: 0 },
    runtime: {
      execute: (execution) => {
        ausgefuehrt.push(execution);
        return Promise.resolve(ok({ containerId: 'abc123' }));
      },
      listContainerStates: () => Promise.resolve([LAUFENDER_CONTAINER]),
      ...runtime,
    },
    ...(readNodeStats ? { readNodeStats } : {}),
  });

  return {
    connection,
    transports,
    ausgefuehrt,
    aktuellerTransport(): FakeTransport {
      const letzter = transports.at(-1);
      if (!letzter) {
        throw new Error('Es wurde noch keine Verbindung aufgebaut.');
      }
      return letzter;
    },
  };
}

/** Lässt anstehende Microtasks und Null-Timer durchlaufen. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Verbindung bis zum abgeschlossenen Handshake bringen. */
async function verbinden(h: Harness): Promise<FakeTransport> {
  const transport = h.aktuellerTransport();
  transport.handlers.onOpen();
  transport.empfangen({
    kind: 'welcome',
    protocolVersion: AGENT_PROTOCOL_VERSION,
    sentAt: new Date().toISOString(),
  });
  await flush();
  return transport;
}

function befehl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'command',
    correlationId: CORRELATION_ID,
    command: 'START',
    serverId: SERVER_ID,
    payload: { foo: 'bar' },
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Handshake (Pflichtenheft §2.2)', () => {
  it('baut die Verbindung aus, sobald start() gerufen wird', () => {
    const h = harness();

    h.connection.start();

    expect(h.transports).toHaveLength(1);
    expect(h.connection.connectionState).toBe('connecting');

    h.connection.stop();
  });

  it('sendet hello mit der Protokollversion, sobald die Verbindung offen ist', () => {
    const h = harness();
    h.connection.start();

    h.aktuellerTransport().handlers.onOpen();

    const hello = h.aktuellerTransport().framesVomTyp('hello');
    expect(hello).toHaveLength(1);
    expect(hello[0]?.protocolVersion).toBe(AGENT_PROTOCOL_VERSION);
    expect(hello[0]?.agentVersion).toBe('0.1.0-test');

    h.connection.stop();
  });

  it('sendet keine Frames mit dem Token – das gehört in den Handshake-Header', () => {
    const h = harness();
    h.connection.start();
    h.aktuellerTransport().handlers.onOpen();

    expect(h.aktuellerTransport().gesendet.join('')).not.toMatch(/token/i);

    h.connection.stop();
  });

  it('gilt erst nach dem welcome als bereit', async () => {
    const h = harness();
    h.connection.start();
    h.aktuellerTransport().handlers.onOpen();

    expect(h.connection.isReady).toBe(false);

    await verbinden(h);

    expect(h.connection.isReady).toBe(true);

    h.connection.stop();
  });

  it('trennt bei abweichender Protokollversion, statt halb verstandene Befehle auszuführen', async () => {
    const h = harness();
    h.connection.start();
    const transport = h.aktuellerTransport();
    transport.handlers.onOpen();

    transport.empfangen({
      kind: 'welcome',
      protocolVersion: AGENT_PROTOCOL_VERSION + 1,
      sentAt: new Date().toISOString(),
    });
    await flush();

    expect(transport.geschlossen).toBe(true);
    expect(h.connection.isReady).toBe(false);
    expect(transport.framesVomTyp('stateReport')).toHaveLength(0);

    h.connection.stop();
  });

  it('verwirft eine Verbindung, die den Handshake nicht bestätigt', async () => {
    const h = harness();
    h.connection.start();
    const transport = h.aktuellerTransport();
    transport.handlers.onOpen();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(transport.geschlossen).toBe(true);

    h.connection.stop();
  });
});

describe('Ist-Zustands-Bericht nach Wiederverbindung (Pflichtenheft §2.2)', () => {
  it('meldet nach dem Handshake unaufgefordert alle bekannten Container', async () => {
    const h = harness();
    h.connection.start();

    const transport = await verbinden(h);

    const berichte = transport.framesVomTyp('stateReport');
    expect(berichte).toHaveLength(1);
    expect(berichte[0]?.reason).toBe('connected');
    expect(berichte[0]?.containers).toEqual([LAUFENDER_CONTAINER]);

    h.connection.stop();
  });

  it('meldet den Ist-Zustand nach jeder Wiederverbindung erneut', async () => {
    const h = harness();
    h.connection.start();

    const ersteVerbindung = await verbinden(h);
    ersteVerbindung.trennenVonAussen();

    await vi.advanceTimersByTimeAsync(1_000);
    const zweiteVerbindung = await verbinden(h);

    expect(h.transports).toHaveLength(2);
    expect(zweiteVerbindung.framesVomTyp('stateReport')[0]?.reason).toBe('connected');

    h.connection.stop();
  });

  it('legt gemessene Node-Ressourcen bei, wenn ein Reader gesetzt ist', async () => {
    const stats: AgentNodeStats = {
      cpuCores: 8,
      cpuLoad1m: 0.5,
      ramTotalMb: 28_672,
      ramAvailableMb: 20_000,
      diskTotalMb: 1_500_000,
      diskAvailableMb: 1_400_000,
      observedAt: new Date().toISOString(),
    };
    const h = harness({}, () => Promise.resolve(stats));
    h.connection.start();

    const transport = await verbinden(h);
    const bericht = transport.framesVomTyp('stateReport')[0];

    expect(bericht?.nodeStats).toEqual(stats);

    h.connection.stop();
  });

  it('sendet den Bericht ohne nodeStats, wenn kein Reader gesetzt ist', async () => {
    const h = harness();
    h.connection.start();

    const transport = await verbinden(h);
    const bericht = transport.framesVomTyp('stateReport')[0];

    expect(bericht?.nodeStats).toBeUndefined();
    expect(bericht?.containers).toEqual([LAUFENDER_CONTAINER]);

    h.connection.stop();
  });

  it('sendet den Bericht trotzdem, wenn die Ressourcenmessung scheitert', async () => {
    const h = harness({}, () => Promise.reject(new Error('statfs kaputt')));
    h.connection.start();

    const transport = await verbinden(h);
    const bericht = transport.framesVomTyp('stateReport')[0];

    // Container-Ist-Zustand bleibt der Zweck; die Messung ist nur Zugabe.
    expect(bericht?.nodeStats).toBeUndefined();
    expect(bericht?.containers).toEqual([LAUFENDER_CONTAINER]);

    h.connection.stop();
  });

  it('beantwortet stateRequest mit dem vollständigen Ist-Zustand', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen({ kind: 'stateRequest', requestedAt: new Date().toISOString() });
    await flush();

    const berichte = transport.framesVomTyp('stateReport');
    expect(berichte).toHaveLength(2);
    expect(berichte[1]?.reason).toBe('requested');

    h.connection.stop();
  });

  it('meldet gar nichts, wenn der Ist-Zustand nicht ermittelbar ist', async () => {
    // Ein leerer Bericht wäre die Aussage "hier läuft nichts" und würde einen
    // Soll/Ist-Abgleich auslösen, der laufende Server anfasst.
    const h = harness({
      listContainerStates: () => Promise.reject(new Error('Runtime nicht erreichbar')),
    });
    h.connection.start();

    const transport = await verbinden(h);

    expect(transport.framesVomTyp('stateReport')).toHaveLength(0);

    h.connection.stop();
  });
});

describe('Reconnect mit exponentiellem Backoff (Pflichtenheft §2.2)', () => {
  it('wartet vor dem ersten Wiederverbindungsversuch', async () => {
    const h = harness();
    h.connection.start();
    (await verbinden(h)).trennenVonAussen();

    await vi.advanceTimersByTimeAsync(999);
    expect(h.transports).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(h.transports).toHaveLength(2);

    h.connection.stop();
  });

  it('verlängert die Wartezeit, solange der Handshake nicht zustande kommt', async () => {
    const h = harness();
    h.connection.start();

    // Erster Versuch scheitert schon vor dem Handshake.
    h.aktuellerTransport().trennenVonAussen();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.transports).toHaveLength(2);

    // Zweiter Versuch ebenso -> die Wartezeit hat sich verdoppelt.
    h.aktuellerTransport().trennenVonAussen();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(h.transports).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transports).toHaveLength(3);

    // Dritter Versuch: 4 s.
    h.aktuellerTransport().trennenVonAussen();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(h.transports).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.transports).toHaveLength(4);

    h.connection.stop();
  });

  it('setzt die Wartezeit erst nach einem abgeschlossenen Handshake zurück', async () => {
    const h = harness();
    h.connection.start();

    h.aktuellerTransport().trennenVonAussen();
    await vi.advanceTimersByTimeAsync(1_000);
    h.aktuellerTransport().trennenVonAussen();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.transports).toHaveLength(3);

    // Jetzt klappt der Handshake – die nächste Trennung wartet wieder nur 1 s.
    (await verbinden(h)).trennenVonAussen();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.transports).toHaveLength(4);

    h.connection.stop();
  });

  it('verbindet auch nach abgelehnter Authentifizierung erneut', async () => {
    // Ein nachträglich korrigiertes AGENT_TOKEN soll ohne Neustart greifen.
    const h = harness();
    h.connection.start();

    h.aktuellerTransport().trennenVonAussen(true);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(h.transports).toHaveLength(2);

    h.connection.stop();
  });

  it('baut nach stop() nicht erneut auf', async () => {
    const h = harness();
    h.connection.start();
    await verbinden(h);

    h.connection.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.transports).toHaveLength(1);
    expect(h.connection.connectionState).toBe('idle');
  });
});

describe('Befehle und Korrelations-IDs (Pflichtenheft §2.2)', () => {
  it('reicht einen Befehl unverändert an die Runtime weiter', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();

    expect(h.ausgefuehrt).toHaveLength(1);
    expect(h.ausgefuehrt[0]).toEqual({
      correlationId: CORRELATION_ID,
      command: 'START',
      serverId: SERVER_ID,
      payload: { foo: 'bar' },
    });

    h.connection.stop();
  });

  it('antwortet mit derselben Korrelations-ID', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();

    const ergebnisse = transport.framesVomTyp('commandResult');
    expect(ergebnisse).toHaveLength(1);
    expect(ergebnisse[0]?.correlationId).toBe(CORRELATION_ID);
    expect(ergebnisse[0]?.command).toBe('START');
    expect(ergebnisse[0]?.duplicate).toBe(false);
    expect(ergebnisse[0]?.result).toEqual(ok({ containerId: 'abc123' }));

    h.connection.stop();
  });

  it('führt eine bereits verarbeitete Korrelations-ID nicht erneut aus', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();
    transport.empfangen(befehl());
    await flush();

    expect(h.ausgefuehrt).toHaveLength(1);

    h.connection.stop();
  });

  it('schickt beim Duplikat das gespeicherte Ergebnis erneut', async () => {
    // Der Retry entsteht meist gerade deshalb, weil die erste Antwort nicht
    // angekommen ist – Schweigen würde das Backend endlos warten lassen.
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();
    transport.empfangen(befehl());
    await flush();

    const ergebnisse = transport.framesVomTyp('commandResult');
    expect(ergebnisse).toHaveLength(2);
    expect(ergebnisse[1]?.duplicate).toBe(true);
    expect(ergebnisse[1]?.result).toEqual(ergebnisse[0]?.result);
    expect(ergebnisse[1]?.completedAt).toBe(ergebnisse[0]?.completedAt);

    h.connection.stop();
  });

  it('führt einen laufenden Befehl bei erneutem Eingang nicht ein zweites Mal aus', async () => {
    let freigeben: (() => void) | undefined;
    const h = harness({
      execute: (execution) => {
        void execution;
        return new Promise<ApiResponse<unknown>>((resolve) => {
          freigeben = () => resolve(ok({ containerId: 'abc123' }));
        });
      },
    });
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();
    transport.empfangen(befehl());
    await flush();

    freigeben?.();
    await flush();

    expect(transport.framesVomTyp('commandResult')).toHaveLength(1);

    h.connection.stop();
  });

  it('behält die Deduplizierung über eine Wiederverbindung hinweg bei', async () => {
    const h = harness();
    h.connection.start();
    const ersteVerbindung = await verbinden(h);

    ersteVerbindung.empfangen(befehl());
    await flush();
    expect(h.ausgefuehrt).toHaveLength(1);

    ersteVerbindung.trennenVonAussen();
    await vi.advanceTimersByTimeAsync(1_000);
    const zweiteVerbindung = await verbinden(h);

    zweiteVerbindung.empfangen(befehl());
    await flush();

    expect(h.ausgefuehrt).toHaveLength(1);
    expect(zweiteVerbindung.framesVomTyp('commandResult')[0]?.duplicate).toBe(true);

    h.connection.stop();
  });

  it('behandelt verschiedene Korrelations-IDs unabhängig voneinander', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();
    transport.empfangen(befehl({ correlationId: ANDERE_ID, command: 'STOP' }));
    await flush();

    expect(h.ausgefuehrt.map((e) => e.command)).toEqual(['START', 'STOP']);
    expect(transport.framesVomTyp('commandResult').map((f) => f.duplicate)).toEqual([false, false]);

    h.connection.stop();
  });

  it('führt Befehle für denselben Server nacheinander aus', async () => {
    // STOP und RESTART für denselben Server dürfen sich nicht überholen.
    const freigaben: (() => void)[] = [];
    const h = harness({
      execute: () =>
        new Promise<ApiResponse<unknown>>((resolve) => {
          freigaben.push(() => resolve(ok(null)));
        }),
    });
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl({ command: 'STOP' }));
    transport.empfangen(befehl({ correlationId: ANDERE_ID, command: 'RESTART' }));
    await flush();

    expect(freigaben).toHaveLength(1);

    freigaben[0]?.();
    await flush();

    expect(freigaben).toHaveLength(2);

    h.connection.stop();
  });

  it('lässt Befehle für verschiedene Server nebeneinander laufen', async () => {
    // Ein minutenlanges CREATE_BACKUP darf nicht die Konsole eines anderen
    // Servers blockieren.
    const freigaben: (() => void)[] = [];
    const h = harness({
      execute: () =>
        new Promise<ApiResponse<unknown>>((resolve) => {
          freigaben.push(() => resolve(ok(null)));
        }),
    });
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl({ command: 'CREATE_BACKUP' }));
    transport.empfangen(
      befehl({
        correlationId: ANDERE_ID,
        command: 'GET_LOGS',
        serverId: '22222222-3333-4444-8555-666666666666',
      }),
    );
    await flush();

    expect(freigaben).toHaveLength(2);

    h.connection.stop();
  });

  it('antwortet auch dann, wenn die Runtime eine Ausnahme wirft', async () => {
    const h = harness({
      execute: () => Promise.reject(new Error('Docker-Socket-Proxy nicht erreichbar')),
    });
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();

    const ergebnis = transport.framesVomTyp('commandResult')[0];
    expect(ergebnis?.result.success).toBe(false);
    expect(ergebnis?.result.error?.code).toBe('AGENT_COMMAND_FAILED');

    h.connection.stop();
  });

  it('reicht eine Fehlerantwort der Runtime unverändert durch', async () => {
    const h = harness({
      execute: () => Promise.resolve(fail('RESOURCE_LIMIT_EXCEEDED')),
    });
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();

    expect(transport.framesVomTyp('commandResult')[0]?.result.error?.code).toBe(
      'RESOURCE_LIMIT_EXCEEDED',
    );

    h.connection.stop();
  });
});

describe('Fehlerhafte Frames', () => {
  it('verwirft Nachrichten, die kein JSON sind', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);
    const vorher = transport.gesendet.length;

    transport.empfangen('kein json');
    await flush();

    expect(transport.gesendet).toHaveLength(vorher);

    h.connection.stop();
  });

  it('führt einen Befehl mit unbekanntem Namen nicht aus', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl({ command: 'SHUTDOWN_HOST' }));
    await flush();

    expect(h.ausgefuehrt).toHaveLength(0);
    expect(transport.framesVomTyp('commandResult')).toHaveLength(0);

    h.connection.stop();
  });

  it('meldet einen formal fehlerhaften Befehl als AGENT_COMMAND_INVALID zurück', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    // Gültiger Befehlsname und gültige Korrelations-ID, aber serverId ist keine UUID.
    transport.empfangen(befehl({ serverId: 'nicht-uuid' }));
    await flush();

    const ergebnis = transport.framesVomTyp('commandResult')[0];
    expect(h.ausgefuehrt).toHaveLength(0);
    expect(ergebnis?.correlationId).toBe(CORRELATION_ID);
    expect(ergebnis?.result.error?.code).toBe('AGENT_COMMAND_INVALID');

    h.connection.stop();
  });

  it('antwortet nicht auf einen Befehl ohne verwertbare Korrelations-ID', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);
    const vorher = transport.gesendet.length;

    transport.empfangen(befehl({ correlationId: 'retry-1' }));
    await flush();

    expect(transport.gesendet).toHaveLength(vorher);

    h.connection.stop();
  });
});

describe('Ereignisse an das Backend', () => {
  it('sendet ein Ereignis über die bestehende Verbindung', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    const gesendet = h.connection.sendEvent({
      event: 'CRASHED',
      serverId: SERVER_ID,
      payload: { exitCode: 137 },
    });

    expect(gesendet).toBe(true);
    const ereignisse = transport.framesVomTyp('event');
    expect(ereignisse[0]?.event).toBe('CRASHED');
    expect(ereignisse[0]?.serverId).toBe(SERVER_ID);

    h.connection.stop();
  });

  it('verwirft ein Ereignis ohne Verbindung, statt es zu puffern', () => {
    const h = harness();
    h.connection.start();

    expect(h.connection.sendEvent({ event: 'LOG_LINE', serverId: SERVER_ID })).toBe(false);

    h.connection.stop();
  });
});

describe('Protokolltreue der ausgehenden Frames', () => {
  it('erfüllt jedes gesendete Frame das Schema aus packages/validation', async () => {
    const h = harness();
    h.connection.start();
    const transport = await verbinden(h);

    transport.empfangen(befehl());
    await flush();
    h.connection.sendEvent({ event: 'STATS_UPDATE', serverId: SERVER_ID, payload: { cpu: 12 } });

    expect(transport.gesendet.length).toBeGreaterThan(0);
    for (const frame of transport.frames()) {
      expect(agentToBackendFrameSchema.safeParse(frame).success).toBe(true);
    }

    h.connection.stop();
  });
});
