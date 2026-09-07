import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveChannelProvider } from './LiveChannelProvider';
import { PING_INTERVAL_MS, PONG_TIMEOUT_MS } from './serverChannel';
import { useServerLive } from './useServerLive';

/**
 * Der Live-Kanal am Stück (Audit W2-5, `event-flow-03`).
 *
 * Zwei Dinge, die sich nur im Zusammenspiel prüfen lassen:
 * - Nach einem Wiederanlauf meldet der Provider seine Abos erneut an; die
 *   `resync`-Antwort des Backends bringt die Anzeige auf den Ist-Stand, statt
 *   sie bis zum nächsten Ereignis auf dem alten stehen zu lassen.
 * - Bleibt das `pong` aus, schließt der Provider die Verbindung selbst – eine
 *   „halb offene" Verbindung (Netz weg, `close` kommt nie) bliebe sonst für
 *   immer stumm stehen.
 *
 * Das `WebSocket` der Umgebung ist durch eine Attrappe ersetzt; sie führt Buch
 * über Gesendetes und lässt den Test die Gegenseite spielen.
 */

const SERVER_ID = 'server-1';

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instanzen: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  readonly gesendet: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instanzen.push(this);
  }

  send(data: string): void {
    this.gesendet.push(data);
  }

  close(code = 1000): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  /** Verbindung aus Sicht des Browsers als offen melden. */
  oeffne(): void {
    this.onopen?.();
  }

  /** Ein Frame vom Backend einspeisen. */
  empfange(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  get frames(): Record<string, unknown>[] {
    return this.gesendet.map((roh) => JSON.parse(roh) as Record<string, unknown>);
  }
}

function Anzeige() {
  const live = useServerLive(SERVER_ID);

  return (
    <>
      <span data-testid="status">{live.status ?? 'unbekannt'}</span>
      <span data-testid="verbindung">{live.connection}</span>
    </>
  );
}

function aktuelleVerbindung(): FakeWebSocket {
  const letzte = FakeWebSocket.instanzen.at(-1);
  if (!letzte) throw new Error('Es wurde keine Verbindung aufgebaut.');

  return letzte;
}

beforeEach(() => {
  FakeWebSocket.instanzen = [];
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Wiederanlauf und Ist-Stand (event-flow-03)', () => {
  it('übernimmt nach dem Wiederanlauf den resync-Stand', () => {
    render(
      <LiveChannelProvider>
        <Anzeige />
      </LiveChannelProvider>,
    );

    act(() => aktuelleVerbindung().oeffne());

    const erste = aktuelleVerbindung();
    expect(erste.frames).toContainEqual({
      kind: 'subscribe',
      topic: { resource: 'server', id: SERVER_ID },
    });

    act(() =>
      erste.empfange({
        kind: 'event',
        event: 'server.statusChanged',
        topic: { resource: 'server', id: SERVER_ID },
        data: { serverId: SERVER_ID, status: 'starting', statusMessage: null },
        sentAt: '2026-09-06T10:00:00.000Z',
      }),
    );
    expect(screen.getByTestId('status').textContent).toBe('starting');

    // Der Reverse Proxy schließt die Verbindung; währenddessen wird der Server
    // `running`. Das Frame dazu sieht dieser Browser nie.
    act(() => erste.close(1006));
    expect(screen.getByTestId('verbindung').textContent).toBe('closed');

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    const zweite = aktuelleVerbindung();
    expect(zweite).not.toBe(erste);

    act(() => zweite.oeffne());
    expect(zweite.frames).toContainEqual({
      kind: 'subscribe',
      topic: { resource: 'server', id: SERVER_ID },
    });

    act(() =>
      zweite.empfange({
        kind: 'resync',
        topic: { resource: 'server', id: SERVER_ID },
        data: { status: 'running', statusMessage: null },
        sentAt: '2026-09-06T10:00:30.000Z',
      }),
    );

    expect(screen.getByTestId('status').textContent).toBe('running');
    expect(screen.getByTestId('verbindung').textContent).toBe('open');
  });
});

describe('Lebenszeichen (event-flow-03)', () => {
  it('schickt im Takt ein ping und schließt ohne pong', () => {
    render(
      <LiveChannelProvider>
        <Anzeige />
      </LiveChannelProvider>,
    );

    act(() => aktuelleVerbindung().oeffne());
    const socket = aktuelleVerbindung();

    act(() => {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
    });
    expect(socket.frames).toContainEqual({ kind: 'ping' });
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    act(() => {
      vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    });

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    expect(screen.getByTestId('verbindung').textContent).toBe('closed');
  });

  it('hält die Verbindung, solange das pong kommt', () => {
    render(
      <LiveChannelProvider>
        <Anzeige />
      </LiveChannelProvider>,
    );

    act(() => aktuelleVerbindung().oeffne());
    const socket = aktuelleVerbindung();

    act(() => {
      vi.advanceTimersByTime(PING_INTERVAL_MS);
    });
    act(() => socket.empfange({ kind: 'pong', sentAt: '2026-09-06T10:00:30.000Z' }));

    act(() => {
      vi.advanceTimersByTime(PONG_TIMEOUT_MS);
    });

    expect(socket.readyState).toBe(FakeWebSocket.OPEN);
    expect(screen.getByTestId('verbindung').textContent).toBe('open');
  });
});

describe('Abgelehnter Konsolenbefehl (contracts-validation-04)', () => {
  it('macht aus der Ablehnung eine sichtbare Konsolenzeile', () => {
    function MitKonsole() {
      const live = useServerLive(SERVER_ID);

      return <span data-testid="konsole">{live.consoleLines.map((zeile) => zeile.text)}</span>;
    }

    render(
      <LiveChannelProvider>
        <MitKonsole />
      </LiveChannelProvider>,
    );

    act(() => aktuelleVerbindung().oeffne());

    act(() =>
      aktuelleVerbindung().empfange({
        kind: 'error',
        topic: { resource: 'server', id: SERVER_ID },
        code: 'VALIDATION_FAILED',
        message: 'command: Höchstens 512 Zeichen.',
        sentAt: '2026-09-06T10:00:00.000Z',
      }),
    );

    expect(screen.getByTestId('konsole').textContent).toBe('command: Höchstens 512 Zeichen.');
  });
});

describe('Endgültige Close-Codes', () => {
  it('versucht es nach 4401 nicht erneut', () => {
    render(
      <LiveChannelProvider>
        <Anzeige />
      </LiveChannelProvider>,
    );

    act(() => aktuelleVerbindung().oeffne());
    act(() => aktuelleVerbindung().close(4401));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    // Ohne gültige Sitzung endete jeder weitere Versuch genauso.
    expect(FakeWebSocket.instanzen).toHaveLength(1);
    expect(screen.getByTestId('verbindung').textContent).toBe('closed');
  });
});
