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

  it('tauscht den Verlauf, statt mehrere offen zu halten', async () => {
    /*
     * Wunsch des Betreibers: Ein Klick auf eine andere Kachel schliesst den
     * bisherigen Verlauf und oeffnet den neuen. Kurz standen mehrere zugleich
     * offen; dabei sammelte sich untereinander, was man laengst angesehen
     * hatte, und die Seite wuchs mit jedem Klick.
     */
    zeichne();

    const cpu = await screen.findByRole('button', { name: /CPU-Last/ });
    const ram = await screen.findByRole('button', { name: /Arbeitsspeicher/ });

    fireEvent.click(cpu);
    await waitFor(() => {
      expect(screen.getByText('CPU-Auslastung')).toBeTruthy();
    });

    fireEvent.click(ram);
    await waitFor(() => {
      expect(screen.getByText('Arbeitsspeicher', { selector: 'figcaption span' })).toBeTruthy();
    });

    expect(screen.queryByText('CPU-Auslastung')).toBeNull();
    expect(cpu.getAttribute('aria-expanded')).toBe('false');
    expect(ram.getAttribute('aria-expanded')).toBe('true');
  });

  it('sagt bei genau einer Messung, dass es fuer eine Linie nicht reicht', async () => {
    // Genau die Lage aus dem Betrieb: Server eine Stunde gestanden, seit
    // zwanzig Sekunden wieder da - ein Messpunkt in der letzten Stunde.
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: {
        serverId: 'srv-1',
        windowMinutes: 60,
        intervalSeconds: 60,
        samples: [MESSUNG('2026-09-15T10:00:00.000Z')],
      },
      error: null,
    });

    zeichne();

    fireEvent.click(await screen.findByRole('button', { name: /CPU-Last/ }));

    expect(await screen.findByText(/nur eine Messung vor/)).toBeTruthy();
  });

  it('zeigt unter der Ping-Kachel die Netzwerkaktivitaet in vier Kurven', async () => {
    zeichne();

    fireEvent.click(await screen.findByRole('button', { name: /Ping/ }));

    await waitFor(() => {
      expect(screen.getByText('Eingehend')).toBeTruthy();
    });
    expect(screen.getByText('Ausgehend')).toBeTruthy();
    expect(screen.getByText('Pakete eingehend')).toBeTruthy();
    expect(screen.getByText('Pakete ausgehend')).toBeTruthy();
  });

  it('zeigt die Spielerzahl wieder als Kachel, mit eigenem Verlauf', async () => {
    zeichne();

    const spieler = await screen.findByRole('button', { name: /Spieler/ });
    fireEvent.click(spieler);

    await waitFor(() => {
      expect(screen.getByText('Spieler online')).toBeTruthy();
    });
  });

  it('klappt auch dann auf, wenn der gewaehlte Zeitraum leer ist', async () => {
    /*
     * Hier ging die Funktion verloren: Die Kacheln liessen sich nur oeffnen,
     * wenn im GERADE gewaehlten Zeitraum schon zwei Messpunkte lagen. Ein
     * Server, der eine Stunde stand und seit zwanzig Sekunden laeuft, hat in
     * der letzten Stunde einen - in vierundzwanzig Stunden aber hundertelf.
     * Die Kacheln boten dann gar nichts an, und die Seite sah aus, als gaebe
     * es die Funktion nicht (gemeldet vom Betreiber, 15.09.2026).
     */
    api.fetchStatsHistory.mockResolvedValue({
      success: true,
      data: { serverId: 'srv-1', windowMinutes: 60, intervalSeconds: 60, samples: [] },
      error: null,
    });

    zeichne();

    const kachel = await screen.findByRole('button', { name: /CPU-Last/ });
    fireEvent.click(kachel);

    // Statt eines leeren Feldes steht dort, was fehlt - samt Zeitraum-Wahl.
    expect(await screen.findByText(/In diesem Zeitraum liegt keine Messung vor/)).toBeTruthy();
    expect(screen.getByLabelText('Zeitraum des Verlaufs')).toBeTruthy();
  });

  it('nennt die Spielerzahl in der Kachel', async () => {
    zeichne();

    expect(await screen.findByText('3 / 10')).toBeTruthy();
  });
});
