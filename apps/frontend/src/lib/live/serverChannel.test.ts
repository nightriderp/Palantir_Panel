import {
  SERVER_LIVE_CLOSE_CODE_FORBIDDEN,
  SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED,
} from '@palantir/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  CLOSE_CODE_FORBIDDEN,
  CLOSE_CODE_UNAUTHORIZED,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  errorToConsoleFrame,
  parseServerLiveFrame,
  resyncToEventFrame,
  startHeartbeat,
  type ServerLiveErrorFrame,
  type ServerLiveResyncFrame,
} from './serverChannel';

/**
 * Bausteine des Server-Live-Kanals (Audit W2-5).
 *
 * `event-flow-03` in zwei Teilen: der Ist-Stand nach dem Wiederanlauf
 * (`resync`) und das Lebenszeichen samt Wächter. Dazu die Ablehnung eines
 * Konsolenbefehls (`contracts-validation-04`), die im Frontend als Zeile in der
 * Konsole landet statt spurlos zu verschwinden.
 */

const TOPIC = { resource: 'server' as const, id: 'server-1' };

describe('parseServerLiveFrame', () => {
  it('liest ein Ereignis-Frame', () => {
    const roh = JSON.stringify({
      kind: 'event',
      event: 'server.statusChanged',
      topic: TOPIC,
      data: { serverId: 'server-1', status: 'running', statusMessage: null },
      sentAt: '2026-09-06T10:00:00.000Z',
    });

    expect(parseServerLiveFrame(roh)).toMatchObject({
      kind: 'event',
      event: 'server.statusChanged',
    });
  });

  it('liest den Ist-Stand', () => {
    const roh = JSON.stringify({
      kind: 'resync',
      topic: TOPIC,
      data: { status: 'starting', statusMessage: 'Bitte warten' },
      sentAt: '2026-09-06T10:00:00.000Z',
    });

    expect(parseServerLiveFrame(roh)).toEqual({
      kind: 'resync',
      topic: TOPIC,
      data: { status: 'starting', statusMessage: 'Bitte warten' },
      sentAt: '2026-09-06T10:00:00.000Z',
    });
  });

  it('liest ein pong und eine Ablehnung', () => {
    expect(parseServerLiveFrame(JSON.stringify({ kind: 'pong', sentAt: 'x' }))).toEqual({
      kind: 'pong',
      sentAt: 'x',
    });

    expect(
      parseServerLiveFrame(
        JSON.stringify({
          kind: 'error',
          topic: TOPIC,
          code: 'VALIDATION_FAILED',
          message: 'command: Zu lang',
          sentAt: 'x',
        }),
      ),
    ).toMatchObject({ kind: 'error', code: 'VALIDATION_FAILED' });
  });

  it('verwirft alles, was nicht zu diesem Kanal gehört', () => {
    expect(parseServerLiveFrame('kein JSON')).toBeNull();
    expect(parseServerLiveFrame('null')).toBeNull();
    expect(parseServerLiveFrame(JSON.stringify({ kind: 'fremd' }))).toBeNull();
    expect(
      parseServerLiveFrame(JSON.stringify({ kind: 'event', event: 'gibt.es.nicht', topic: TOPIC })),
    ).toBeNull();
    expect(parseServerLiveFrame(JSON.stringify({ kind: 'resync', topic: TOPIC }))).toBeNull();
  });
});

describe('resyncToEventFrame', () => {
  it('macht aus dem Ist-Stand einen Statuswechsel', () => {
    const frame: ServerLiveResyncFrame = {
      kind: 'resync',
      topic: TOPIC,
      data: { status: 'running', statusMessage: null },
      sentAt: '2026-09-06T10:00:00.000Z',
    };

    expect(resyncToEventFrame(frame)).toEqual({
      kind: 'event',
      event: 'server.statusChanged',
      topic: TOPIC,
      data: { serverId: 'server-1', status: 'running', statusMessage: null },
      sentAt: '2026-09-06T10:00:00.000Z',
    });
  });
});

describe('errorToConsoleFrame', () => {
  const frame: ServerLiveErrorFrame = {
    kind: 'error',
    topic: TOPIC,
    code: 'VALIDATION_FAILED',
    message: 'command: Höchstens 512 Zeichen.',
    sentAt: '2026-09-06T10:00:00.000Z',
  };

  it('macht aus der Ablehnung eine Systemzeile der Konsole', () => {
    expect(errorToConsoleFrame(frame, 'local-1')).toMatchObject({
      event: 'server.consoleLineAppended',
      data: {
        serverId: 'server-1',
        line: { id: 'local-1', source: 'system', text: 'command: Höchstens 512 Zeichen.' },
      },
    });
  });

  it('lässt eine Ablehnung ohne Thema fallen – es gibt keine Konsole dafür', () => {
    expect(errorToConsoleFrame({ ...frame, topic: null }, 'local-1')).toBeNull();
  });
});

describe('startHeartbeat', () => {
  it('schickt im vereinbarten Takt ein Lebenszeichen', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const onTimeout = vi.fn();

    const puls = startHeartbeat({ send, onTimeout });

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);

    // Antwort da: keine Frist mehr offen, der nächste Takt schickt wieder.
    puls.pong();
    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onTimeout).not.toHaveBeenCalled();

    puls.stop();
    vi.useRealTimers();
  });

  it('schlägt an, wenn kein pong kommt', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();

    const puls = startHeartbeat({ send: () => undefined, onTimeout });

    vi.advanceTimersByTime(PING_INTERVAL_MS);
    expect(onTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    puls.stop();
    vi.useRealTimers();
  });

  it('stapelt keine zweite Frist, solange eine offen ist', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const onTimeout = vi.fn();

    const puls = startHeartbeat({ send, onTimeout, intervalMs: 100, timeoutMs: 1000 });

    vi.advanceTimersByTime(500);

    expect(send).toHaveBeenCalledTimes(1);

    puls.stop();
    vi.useRealTimers();
  });

  it('schweigt nach stop()', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const onTimeout = vi.fn();

    const puls = startHeartbeat({ send, onTimeout });
    puls.stop();

    vi.advanceTimersByTime(PING_INTERVAL_MS * 5);

    expect(send).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

/**
 * Contracts-Nachzug W2-C2: Close-Codes und Frames des Kanals stehen im Vertrag.
 * Vorher hielten Backend (`live-frames.ts`) und Browser je eine eigene Zahl,
 * die von Hand gleich gehalten werden musste.
 */
describe('Close-Codes des Server-Kanals', () => {
  it('nimmt beide Zahlen unverändert aus dem Vertrag', () => {
    expect(CLOSE_CODE_UNAUTHORIZED).toBe(SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED);
    expect(CLOSE_CODE_FORBIDDEN).toBe(SERVER_LIVE_CLOSE_CODE_FORBIDDEN);
  });
});

describe('parseServerLiveFrame: error-Frame', () => {
  it('verwirft einen Code, den der Vertrag für dieses Frame nicht vorsieht', () => {
    // Der Vertrag lässt genau zwei Codes zu. Ein dritter wäre ein
    // Protokollfehler und darf nicht als Freitext in die Konsole wandern.
    const roh = JSON.stringify({
      kind: 'error',
      topic: TOPIC,
      code: 'INTERNAL_ERROR',
      message: 'kaputt',
      sentAt: '2026-09-06T10:00:00.000Z',
    });

    expect(parseServerLiveFrame(roh)).toBeNull();
  });
});
