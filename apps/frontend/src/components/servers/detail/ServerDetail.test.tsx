import { type GameServerDto, type LiveServerEventFrame } from '@palantir/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { ownerPermissions, server as serverFixture } from '../testFixtures';
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

/**
 * Aktualisieren (Fundpunkt 190).
 *
 * Eine neue Fassung des Spiel-Images greift erst, wenn der Container neu
 * gebaut wird – das tut jeder Start. Sichtbar war das bisher nur als Abzeichen
 * „Update verfügbar"; wer es übernehmen wollte, musste wissen, dass ein
 * Neustart genau das tut.
 */
describe('ServerDetail – Aktualisieren (Fundpunkt 190)', () => {
  const MIT_UPDATE: GameServerDto = { ...LAEUFT, updateAvailable: true };

  it('bietet den Knopf am laufenden Server an und startet dafür neu', async () => {
    api.fetchServer.mockResolvedValue({ success: true, data: MIT_UPDATE, error: null });
    api.runLifecycleAction.mockResolvedValue({
      success: true,
      data: { ...MIT_UPDATE, status: 'starting' },
      error: null,
    });

    zeichne();
    fireEvent.click(await screen.findByRole('button', { name: 'Aktualisieren' }));

    // Erst die Rückfrage – ein Klick darf keine Spielrunde beenden.
    expect(await screen.findByText('Auf die neue Fassung aktualisieren?')).toBeTruthy();
    expect(api.runLifecycleAction).not.toHaveBeenCalled();

    // Der Kopf traegt denselben Wortlaut; gemeint ist der in der Rueckfrage.
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Aktualisieren' }),
    );

    await waitFor(() => {
      expect(api.runLifecycleAction).toHaveBeenCalledWith('srv-1', 'restart');
    });
  });

  it('zeigt am gestoppten Server nur den Hinweis – der nächste Start übernimmt', async () => {
    api.fetchServer.mockResolvedValue({
      success: true,
      data: { ...MIT_UPDATE, status: 'stopped' },
      error: null,
    });

    zeichne();
    expect(await screen.findByText('Update verfügbar')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Aktualisieren' })).toBeNull();
  });

  it('bietet den Knopf ohne neue Fassung gar nicht an', async () => {
    zeichne();
    await screen.findByText('Online');

    expect(screen.queryByText('Update verfügbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aktualisieren' })).toBeNull();
  });
});

/**
 * Nicht jeder Spielserver nimmt Befehle entgegen: Valheim liest weder seine
 * Standardeingabe noch spricht es RCON. Bis dahin zeigte das Panel trotzdem ein
 * Eingabefeld, dessen Zeilen in einem ungelesenen Rohr verschwanden.
 *
 * Zwei Bedingungen, zwei Bedeutungen: `canUseConsole` sagt, ob der Aufrufer
 * darf, `supportsConsole`, ob es am Spiel etwas zu bedienen gibt.
 */
describe('Live-Konsole nur, wenn das Spiel eine hat', () => {
  const MIT_RECHT = serverFixture({
    id: 'srv-1',
    name: 'Welt',
    status: 'running',
    permissions: ownerPermissions(),
  });

  it('zeigt sie bei einem Spiel mit Konsole', async () => {
    api.fetchServer.mockResolvedValue({ success: true, data: MIT_RECHT, error: null });

    zeichne();

    expect(await screen.findByLabelText('Konsolenbefehl')).toBeTruthy();
  });

  it('blendet sie aus, wenn das Spiel keine hat – und sagt, warum', async () => {
    api.fetchServer.mockResolvedValue({
      success: true,
      data: { ...MIT_RECHT, supportsConsole: false },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    expect(screen.queryByLabelText('Konsolenbefehl')).toBeNull();
    // Sonst suchte jemand die Konsole, die bei jedem anderen Spiel dort steht.
    expect(screen.getByText('vom Spiel nicht unterstützt')).toBeTruthy();
  });
});

/**
 * Letzte festgehaltene Messung statt leerer Kacheln (Fundpunkt 206) und die
 * Netzwerk-Auskunft, die den Zustand mit dem Messwert verwechselte (207).
 *
 * Gemessen am Pruefstand: Ein laufender Server ohne verbundenen Agent zeigte
 * ueberall Striche und darunter "Der Server laeuft nicht.", waehrend das
 * Verlaufsdiagramm derselben Ansicht eine Kurve zeichnete.
 */
describe('ServerDetail - Messwerte ohne Live-Kanal (Fundpunkt 206/207)', () => {
  const MESSUNG = {
    cpuPercent: 250,
    ramUsedMb: 2048,
    diskUsedMb: 10_240,
    pingMs: 24,
    playersOnline: 3,
    playersMax: 20,
    networkRxBytes: 1024,
    networkTxBytes: 2048,
    updatedAt: '2026-09-10T12:00:00.000Z',
  };

  it('nimmt die letzte Messung aus dem Verlauf, wenn der Kanal schweigt', async () => {
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [MESSUNG] },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    // 2048 MiB von 4 GiB Kontingent - vorher stand hier ein Strich.
    expect(await screen.findByText('2 GiB')).toBeTruthy();
    // 250 % eines Kerns bei zwei Kernen: 125 %, begrenzt auf 100 (Fundpunkt 205).
    expect(screen.getByText('2,5 von 2 Kernen')).toBeTruthy();
    expect(screen.getByText(/Keine laufenden Messwerte/)).toBeTruthy();
    expect(screen.queryByText('Der Server läuft nicht.')).toBeNull();
  });

  it('sagt beim laufenden Server ohne jede Messung nicht, er laufe nicht', async () => {
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [] },
      error: null,
    });

    zeichne();
    await screen.findByText('Online');

    expect(await screen.findByText('Noch keine Messwerte für diesen Server.')).toBeTruthy();
    expect(screen.queryByText('Der Server läuft nicht.')).toBeNull();
  });

  it('bleibt beim gestoppten Server bei der alten Auskunft', async () => {
    api.fetchServer.mockResolvedValue({ success: true, data: mitStatus('stopped'), error: null });
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, samples: [MESSUNG] },
      error: null,
    });

    zeichne();
    await screen.findByText('Offline');

    // Die Messung von vorhin gehoert nicht in die Kacheln eines Servers, der
    // gerade nicht laeuft - sie saehe aus wie der aktuelle Zustand.
    expect(await screen.findByText('Der Server läuft nicht.')).toBeTruthy();
    expect(screen.queryByText(/Keine laufenden Messwerte/)).toBeNull();
  });
});
