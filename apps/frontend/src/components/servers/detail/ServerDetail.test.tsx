import { type GameServerDto, type LiveServerEventFrame } from '@palantir/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { server as serverFixture } from '../testFixtures';
import { ServerDetail } from './ServerDetail';

/**
 * Fundpunkt event-flow-04 – Live-Kanal und REST-Antwort versöhnen.
 *
 * Der Test fährt genau den Ablauf aus dem Befund: Ein Server läuft laut REST,
 * der Kanal meldet später „gestoppt" (jünger, gewinnt), und der darauf folgende
 * Klick auf „Starten" liefert per REST den jüngsten Stand – der die alte
 * Live-Meldung ablösen muss. Vorher blieb die Kopfzeile auf „Offline" stehen
 * und der zweite Klick endete in `SERVER_STATE_CONFLICT`.
 */

const kanal = vi.hoisted(() => {
  const zuhoerer = new Set<(frame: unknown) => void>();

  return {
    zuhoerer,
    api: {
      connection: 'open' as const,
      subscribe(_topic: unknown, listener: (frame: unknown) => void) {
        zuhoerer.add(listener);

        return () => {
          zuhoerer.delete(listener);
        };
      },
      send: () => true,
    },
  };
});

const api = vi.hoisted(() => ({
  fetchServer: vi.fn(),
  runLifecycleAction: vi.fn(),
  fetchStatsHistory: vi.fn(),
}));

vi.mock('@/lib/live/LiveChannelProvider', () => ({ useLiveChannel: () => kanal.api }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/servers/srv-1',
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchServer: api.fetchServer,
  runLifecycleAction: api.runLifecycleAction,
  fetchStatsHistory: api.fetchStatsHistory,
}));

const LAEUFT = serverFixture({ id: 'srv-1', name: 'Welt', status: 'running' });

function mitStatus(status: GameServerDto['status']): GameServerDto {
  return { ...LAEUFT, status };
}

function statusFrame(status: GameServerDto['status']): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.statusChanged',
    topic: { resource: 'server', id: 'srv-1' },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: { serverId: 'srv-1', status, statusMessage: null },
  };
}

function sende(frame: LiveServerEventFrame): void {
  act(() => {
    for (const zuhoerer of kanal.zuhoerer) zuhoerer(frame);
  });
}

function zeichne() {
  return render(
    <ToastProvider>
      <ServerDetail serverId="srv-1" />
    </ToastProvider>,
  );
}

beforeEach(() => {
  kanal.zuhoerer.clear();
  api.fetchServer.mockReset();
  api.runLifecycleAction.mockReset();
  api.fetchStatsHistory.mockReset();

  api.fetchServer.mockResolvedValue({ success: true, data: LAEUFT, error: null });
  // Der Verlauf interessiert hier nicht; ein abgebrochener Aufruf erzeugt
  // bewusst keinen Fehlerzustand in `useApiResource`.
  api.fetchStatsHistory.mockResolvedValue({
    success: false,
    data: null,
    error: { code: 'REQUEST_ABORTED', message: 'Die Anfrage wurde abgebrochen.' },
  });
});

describe('ServerDetail – Live und REST (event-flow-04)', () => {
  it('lässt den Live-Status gegen die beim Laden geholten REST-Daten gewinnen', async () => {
    zeichne();
    expect(await screen.findByText('Online')).toBeTruthy();

    sende(statusFrame('stopped'));

    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('zeigt nach „Starten" den jüngeren REST-Stand statt der alten Live-Meldung', async () => {
    api.runLifecycleAction.mockResolvedValue({
      success: true,
      data: mitStatus('starting'),
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    // Der Kanal meldet „gestoppt" – jünger als das geladene DTO, gewinnt also.
    sende(statusFrame('stopped'));
    await screen.findByText('Offline');

    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));

    await waitFor(() => {
      expect(api.runLifecycleAction).toHaveBeenCalledWith('srv-1', 'start');
    });

    // Ohne den Abgleich bliebe hier „Offline" stehen: Der Live-Status von
    // vorhin würde die frische Antwort weiter überschreiben.
    expect((await screen.findAllByText('Startet …')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('nimmt danach wieder den Live-Status an, sobald ein neues Ereignis kommt', async () => {
    api.runLifecycleAction.mockResolvedValue({
      success: true,
      data: mitStatus('starting'),
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    sende(statusFrame('stopped'));
    await screen.findByText('Offline');

    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));
    await screen.findAllByText('Startet …');

    sende(statusFrame('running'));

    expect(await screen.findByText('Online')).toBeTruthy();
  });
});
