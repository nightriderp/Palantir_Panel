import { type ServerLiveStats } from '@palantir/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatsHistoryChart } from './StatsHistoryChart';

/**
 * Verlauf mit Skala und Zeitbezug (Fundpunkt 222).
 *
 * Gemessen am laufenden System: Der Linienzug hatte weder Achse noch Skala noch
 * Zeitangabe – zwei Kurven nebeneinander sahen gleich aus, obwohl die eine bei
 * 12 % und die andere bei 95 % lag. Und ohne feste Obergrenze zog sich die
 * Achse auf den größten gemessenen Wert zusammen: Eine konstante Reihe (drei
 * Spieler, eine Stunde lang) erschien als Vollausschlag am oberen Rand.
 */

function messwert(overrides: Partial<ServerLiveStats>): ServerLiveStats {
  return {
    cpuPercent: null,
    ramUsedMb: null,
    diskUsedMb: null,
    pingMs: null,
    playersOnline: null,
    playersMax: null,
    networkRxBytes: null,
    networkTxBytes: null,
    updatedAt: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

/** Die Punkte des Linienzugs als Zahlenpaare. */
function punkte(): Array<[number, number]> {
  const linien = document.querySelectorAll('polyline');
  // Die zweite Linie ist der Zug selbst; die erste ist die Fläche darunter.
  const zug = linien[1];
  if (!zug) throw new Error('Kein Linienzug gezeichnet.');

  return (zug.getAttribute('points') ?? '')
    .split(' ')
    .filter((paar) => paar.length > 0)
    .map((paar) => {
      const [x, y] = paar.split(',').map(Number);
      return [x ?? 0, y ?? 0];
    });
}

describe('StatsHistoryChart (Fundpunkt 222)', () => {
  it('lässt eine konstante Reihe nicht am oberen Rand kleben', () => {
    render(
      <StatsHistoryChart
        samples={[3, 3, 3, 3].map((wert) => messwert({ playersOnline: wert }))}
        metric="playersOnline"
        label="Spieler online"
      />,
    );

    // Aufgerundet wird auf 5; drei Spieler liegen damit bei 60 % der Höhe,
    // nicht bei 100 %. Vorher lag jeder Punkt auf y = 0.
    expect(punkte().every(([, y]) => y > 0)).toBe(true);
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('nennt die Obergrenze und den letzten Wert', () => {
    render(
      <StatsHistoryChart
        samples={[1024, 2048].map((wert) => messwert({ ramUsedMb: wert }))}
        metric="ramUsedMb"
        label="Arbeitsspeicher"
        max={4096}
        formatValue={(wert) => `${wert} MiB`}
      />,
    );

    expect(screen.getByText('4096 MiB')).toBeTruthy();
    expect(screen.getByText('2048 MiB')).toBeTruthy();
  });

  it('rundet auf, wenn die Messwerte über der vorgegebenen Grenze liegen', () => {
    render(
      <StatsHistoryChart
        samples={[100, 260].map((wert) => messwert({ ramUsedMb: wert }))}
        metric="ramUsedMb"
        label="Arbeitsspeicher"
        max={200}
      />,
    );

    // 260 über einer Achse von 200 hiesse: Linie abgeschnitten. Aufgerundet
    // wird auf 500.
    expect(screen.getByText('500')).toBeTruthy();
  });

  it('nennt den Zeitraum der Messreihe', () => {
    render(
      <StatsHistoryChart
        samples={[
          messwert({ playersOnline: 1, updatedAt: '2026-09-10T10:00:00.000Z' }),
          messwert({ playersOnline: 2, updatedAt: '2026-09-10T11:00:00.000Z' }),
        ]}
        metric="playersOnline"
        label="Spieler online"
      />,
    );

    expect(screen.getByText(/–.*Uhr$/)).toBeTruthy();
  });

  it('sagt es, solange zu wenige Messwerte vorliegen', () => {
    render(
      <StatsHistoryChart
        samples={[messwert({ playersOnline: 1 })]}
        metric="playersOnline"
        label="Spieler online"
      />,
    );

    expect(screen.getByText('Noch zu wenige Messwerte für einen Verlauf.')).toBeTruthy();
  });
});
