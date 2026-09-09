import { type BackupProgress, type LiveServerEventFrame } from '@palantir/contracts';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerLive, useServerListLive } from './useServerLive';

/**
 * Fundpunkte event-flow-14 (`backupProgress` überlebt den Serverwechsel) und
 * event-flow-04 (Live-Stände tragen eine Reihenfolgenummer).
 *
 * Der Live-Kanal ist durch ein Testdouble ersetzt: `useServerLive` bekommt
 * dieselbe Schnittstelle wie im Betrieb, die Frames speist der Test ein.
 */

const kanal = vi.hoisted(() => {
  const zuhoerer = new Map<string, Set<(frame: unknown) => void>>();

  return {
    zuhoerer,
    api: {
      connection: 'open' as const,
      subscribe(topic: { resource: string; id: string }, listener: (frame: unknown) => void) {
        const schluessel = `${topic.resource}:${topic.id}`;
        const menge = zuhoerer.get(schluessel) ?? new Set<(frame: unknown) => void>();
        menge.add(listener);
        zuhoerer.set(schluessel, menge);

        return () => {
          menge.delete(listener);
        };
      },
      send: () => true,
    },
  };
});

vi.mock('./LiveChannelProvider', () => ({ useLiveChannel: () => kanal.api }));

/**
 * Rückblick der Konsole (Fundpunkt 184): `useServerLive` holt beim Öffnen den
 * Schwanz des Container-Logs. Das Testdouble liefert je Server die Zeilen, die
 * hier hinterlegt sind – ohne Eintrag eine Fehlantwort, wie bei einem Server
 * ohne Container.
 */
const logs = vi.hoisted(() => ({
  zeilen: new Map<
    string,
    { stream: 'stdout' | 'stderr'; message: string; timestamp: string | null }[]
  >(),
}));

vi.mock('../api/servers', () => ({
  fetchServerLogs: (serverId: string) => {
    const zeilen = logs.zeilen.get(serverId);
    return Promise.resolve(
      zeilen === undefined
        ? { success: false, data: null, error: { code: 'SERVER_NOT_RUNNING', message: 'x' } }
        : { success: true, data: { containerId: 'c', lines: zeilen }, error: null },
    );
  },
}));

function sende(frame: LiveServerEventFrame): void {
  const schluessel = `${frame.topic.resource}:${frame.topic.id}`;

  act(() => {
    for (const zuhoerer of kanal.zuhoerer.get(schluessel) ?? []) zuhoerer(frame);
  });
}

function backupFrame(serverId: string, backup: Partial<BackupProgress>): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'backup.progressed',
    topic: { resource: 'server', id: serverId },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: {
      serverId,
      backup: {
        backupId: 'backup-1',
        status: 'running',
        isExport: false,
        sizeBytes: 0,
        completedAt: null,
        failureMessage: null,
        ...backup,
      },
    },
  };
}

function statusFrame(serverId: string, status: 'running' | 'stopped'): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.statusChanged',
    topic: { resource: 'server', id: serverId },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: { serverId, status, statusMessage: null },
  };
}

function statsFrame(serverId: string, cpuPercent: number | null): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.statsUpdated',
    topic: { resource: 'server', id: serverId },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: {
      serverId,
      stats: {
        cpuPercent,
        ramUsedMb: cpuPercent === null ? null : 256,
        diskUsedMb: null,
        pingMs: 11,
        playersOnline: 7,
        playersMax: 20,
        networkRxBytes: null,
        networkTxBytes: null,
        updatedAt: '2026-09-06T10:00:00.000Z',
      },
    },
  };
}

function Anzeige({ serverId }: { serverId: string }) {
  const live = useServerLive(serverId);

  return (
    <div>
      <span data-testid="backup">{live.backupProgress?.backupId ?? 'keiner'}</span>
      <span data-testid="status">{live.status ?? 'keiner'}</span>
      <span data-testid="revision">{live.statusRevision}</span>
      <span data-testid="cpu">{live.stats?.cpuPercent ?? 'leer'}</span>
      <span data-testid="konsole">{live.consoleLines.map((line) => line.text).join('|')}</span>
    </div>
  );
}

function konsolenFrame(serverId: string, id: string, text: string): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.consoleLineAppended',
    topic: { resource: 'server', id: serverId },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: {
      serverId,
      line: { id, serverId, source: 'stdout', text, timestamp: '2026-09-06T10:00:00.000Z' },
    },
  };
}

beforeEach(() => {
  kanal.zuhoerer.clear();
  logs.zeilen.clear();
});

describe('useServerLive', () => {
  it('vergisst den Sicherungs-Fortschritt beim Wechsel auf einen anderen Server (event-flow-14)', () => {
    const { rerender } = render(<Anzeige serverId="srv-a" />);

    sende(backupFrame('srv-a', { backupId: 'backup-a' }));
    expect(screen.getByTestId('backup').textContent).toBe('backup-a');

    act(() => {
      rerender(<Anzeige serverId="srv-b" />);
    });

    expect(screen.getByTestId('backup').textContent).toBe('keiner');
  });

  it('vergisst auch den Status beim Serverwechsel und setzt die Reihenfolgenummer zurück', () => {
    const { rerender } = render(<Anzeige serverId="srv-a" />);

    sende(statusFrame('srv-a', 'running'));
    expect(screen.getByTestId('status').textContent).toBe('running');
    expect(Number(screen.getByTestId('revision').textContent)).toBeGreaterThan(0);

    act(() => {
      rerender(<Anzeige serverId="srv-b" />);
    });

    expect(screen.getByTestId('status').textContent).toBe('keiner');
    expect(screen.getByTestId('revision').textContent).toBe('0');
  });

  /*
   * Fundpunkt 179. Unter `server.statsUpdated` fließen zwei Nutzlasten – die
   * Messwerte der Container-Engine und das Ergebnis der Server-Abfrage – und
   * die Abfrage misst weder CPU noch Arbeitsspeicher noch Netzverkehr. Ihr
   * Rahmen löschte deshalb die drei Kacheln, bis der nächste Engine-Rahmen kam.
   *
   * **Behoben wird das im Backend**, nicht hier: Nur dort ist bekannt, ob ein
   * `null` „diese Quelle misst es nicht" oder „es ist unbekannt" heißt. Im
   * Browser kommen beide Fälle als dasselbe `null` an, und ein Zusammenführen
   * an dieser Stelle müsste pauschal „`null` überschreibt nie" gelten lassen –
   * ein einmal gezeigter Wert ließe sich dann nie wieder loswerden.
   *
   * Dieser Test hält die Ersetzung fest. Er fällt um, sobald jemand hier doch
   * zusammenführt – dann bliebe die Kachel stehen, obwohl das Backend gerade
   * sagt, dass es nichts mehr weiß.
   */
  it('ersetzt die Messwerte je Rahmen vollständig – zusammengeführt wird im Backend (Fundpunkt 179)', () => {
    render(<Anzeige serverId="srv-a" />);

    sende(statsFrame('srv-a', 12));
    expect(screen.getByTestId('cpu').textContent).toBe('12');

    // Das Backend liefert „unbekannt" – dann steht in der Kachel „—", nicht die
    // Zahl von vorhin.
    sende(statsFrame('srv-a', null));
    expect(screen.getByTestId('cpu').textContent).toBe('leer');
  });

  /*
   * Fundpunkt 184: Der Puffer der Konsole stirbt mit der Seite. Beim Öffnen
   * holt der Hook deshalb den Schwanz des Container-Logs und legt ihn vor die
   * Live-Zeilen – sonst ist nach jedem Seitenwechsel die Startausgabe weg.
   */
  it('lädt beim Öffnen den Rückblick der Konsole und legt ihn vor die Live-Zeilen (Fundpunkt 184)', async () => {
    logs.zeilen.set('srv-a', [
      {
        stream: 'stdout',
        message: 'Starting minecraft server',
        timestamp: '2026-09-06T09:59:00.000Z',
      },
      { stream: 'stderr', message: 'Warnung', timestamp: null },
    ]);

    render(<Anzeige serverId="srv-a" />);
    sende(konsolenFrame('srv-a', 'live-1', 'Done (3.2s)!'));

    expect((await screen.findByText(/Starting minecraft server/u)).textContent).toBe(
      'Starting minecraft server|Warnung|Done (3.2s)!',
    );
  });

  it('lässt die Konsole ohne Rückblick, wenn der Server keinen Container hat', async () => {
    render(<Anzeige serverId="srv-b" />);
    sende(konsolenFrame('srv-b', 'live-1', 'nur live'));

    // Der Aufruf scheitert leise – die Live-Zeile bleibt, sonst nichts.
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('konsole').textContent).toBe('nur live');
  });

  it('vergibt für jeden Statuswechsel eine höhere Reihenfolgenummer (event-flow-04)', () => {
    render(<Anzeige serverId="srv-a" />);

    sende(statusFrame('srv-a', 'running'));
    const erste = Number(screen.getByTestId('revision').textContent);

    sende(statusFrame('srv-a', 'stopped'));
    const zweite = Number(screen.getByTestId('revision').textContent);

    expect(erste).toBeGreaterThan(0);
    expect(zweite).toBeGreaterThan(erste);
  });
});

function Liste() {
  const live = useServerListLive([]);

  return <span data-testid="revision">{live.listRevision}</span>;
}

function listenFrame(event: 'server.created' | 'server.deleted'): LiveServerEventFrame {
  return {
    kind: 'event',
    event,
    topic: { resource: 'serverList', id: 'all' },
    data: { serverId: 'server-neu' },
    sentAt: '2026-09-09T10:00:00.000Z',
  };
}

describe('useServerListLive – Listen-Thema (Fundpunkt 173)', () => {
  it('zählt die Listen-Revision bei angelegt und gelöscht hoch, sonst nicht', () => {
    render(<Liste />);
    expect(screen.getByTestId('revision').textContent).toBe('0');

    sende(listenFrame('server.created'));
    expect(screen.getByTestId('revision').textContent).toBe('1');

    sende(listenFrame('server.deleted'));
    expect(screen.getByTestId('revision').textContent).toBe('2');

    // Ein Statuswechsel gehört auf das Server-Thema, nicht auf die Liste.
    sende({
      kind: 'event',
      event: 'server.statusChanged',
      topic: { resource: 'serverList', id: 'all' },
      data: { serverId: 'server-neu', status: 'running', statusMessage: null },
      sentAt: '2026-09-09T10:00:01.000Z',
    });
    expect(screen.getByTestId('revision').textContent).toBe('2');
  });
});
