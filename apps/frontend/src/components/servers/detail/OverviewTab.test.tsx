import { type ServerLiveStats } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server as serverFixture } from '../testFixtures';
import { OverviewTab } from './OverviewTab';

/**
 * Der Übersichts-Reiter in der Anordnung von hafenmeister.
 *
 * Geprüft wird, was den Unterschied ausmacht: Der Verlauf hängt an der Kachel,
 * die ihn öffnet – und es ist immer nur einer offen. Vorher stand er als
 * eigener Block unter den Kacheln, gleichzeitig für alle Kennzahlen.
 */

const api = vi.hoisted(() => ({ fetchStatsHistory: vi.fn() }));

vi.mock('@/lib/api/servers', () => api);

const MESSUNG = (updatedAt: string): ServerLiveStats => ({
  cpuPercent: 250,
  ramUsedMb: 2048,
  diskUsedMb: 512,
  pingMs: 12,
  playersOnline: 3,
  playersMax: 10,
  networkRxBytes: 1024,
  networkTxBytes: 2048,
  updatedAt,
});

const LIVE = MESSUNG('2026-09-15T10:00:00.000Z');

function zeichne(overrides: Partial<Parameters<typeof OverviewTab>[0]> = {}) {
  const server = {
    ...serverFixture({ id: 'srv-1', status: 'running' }),
    hostCpuCores: 8,
  };

  return render(<OverviewTab server={server} stats={LIVE} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchStatsHistory.mockResolvedValue({
    success: true,
    data: {
      serverId: 'srv-1',
      windowMinutes: 60,
      intervalSeconds: 60,
      samples: [MESSUNG('2026-09-15T09:58:00.000Z'), MESSUNG('2026-09-15T09:59:00.000Z')],
    },
    error: null,
  });
});

describe('OverviewTab – Kacheln im hafenmeister-Stil', () => {
  it('zeigt die CPU als Anteil der Node-Kerne', async () => {
    zeichne();

    // 250 % eines Kerns von 8 Kernen sind rund 31 %. „2,5 Kerne" beantwortete
    // nicht, ob die Maschine am Anschlag läuft.
    expect(await screen.findByText(/von 8 Kernen/)).toBeTruthy();
  });

  it('bleibt bei der Kernzahl, wenn die Kerne der Node fehlen', async () => {
    zeichne({
      server: { ...serverFixture({ id: 'srv-1', status: 'running' }), hostCpuCores: null },
    });

    // Lieber eine unschärfere Auskunft als ein erfundener Nenner.
    expect(await screen.findByText('2,5 Kerne')).toBeTruthy();
  });

  it('klappt den CPU-Verlauf unter den Kacheln auf und wieder zu', async () => {
    zeichne();

    const kachel = await screen.findByRole('button', { name: /CPU-Last/ });
    expect(kachel.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(kachel);

    await waitFor(() => {
      expect(screen.getByText('CPU-Auslastung')).toBeTruthy();
    });
    expect(kachel.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(kachel);
    expect(screen.queryByText('CPU-Auslastung')).toBeNull();
  });

  it('haelt immer nur einen Bereich offen', async () => {
    zeichne();

    const cpu = await screen.findByRole('button', { name: /CPU-Last/ });
    const ping = await screen.findByRole('button', { name: /Ping/ });

    fireEvent.click(cpu);
    fireEvent.click(ping);

    // Der Ping öffnet die Netzwerkzahlen, nicht eine Ping-Kurve: Ein
    // gespeicherter Ping existiert nicht, er gehört der Verbindung.
    await waitFor(() => {
      expect(screen.getByText('Netzwerkaktivität')).toBeTruthy();
    });
    expect(cpu.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('CPU-Auslastung')).toBeNull();
  });

  it('bietet keinen Aufklapper an, solange es keinen Verlauf gibt', async () => {
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, intervalSeconds: 60, samples: [] },
      error: null,
    });

    zeichne();
    await screen.findByText('CPU-Last');

    /*
     * Eine Kachel, die sich als Schaltfläche anbietet und dann ein leeres Feld
     * öffnet, ist schlimmer als eine stille Kachel.
     */
    expect(screen.queryByRole('button', { name: /CPU-Last/ })).toBeNull();
  });

  it('zeigt die Spielerzahl in einer eigenen Karte statt als sechste Kachel', async () => {
    zeichne();

    expect(await screen.findByText('Spieler online')).toBeTruthy();
    expect(screen.getByText('3 / 10')).toBeTruthy();
  });
});
