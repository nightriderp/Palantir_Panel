import { type BackupProgress, type LiveServerEventFrame } from '@palantir/contracts';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerLive } from './useServerLive';

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

function Anzeige({ serverId }: { serverId: string }) {
  const live = useServerLive(serverId);

  return (
    <div>
      <span data-testid="backup">{live.backupProgress?.backupId ?? 'keiner'}</span>
      <span data-testid="status">{live.status ?? 'keiner'}</span>
      <span data-testid="revision">{live.statusRevision}</span>
    </div>
  );
}

beforeEach(() => {
  kanal.zuhoerer.clear();
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
