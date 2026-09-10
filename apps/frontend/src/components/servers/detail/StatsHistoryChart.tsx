'use client';

import { type ServerLiveStats } from '@palantir/contracts';
import { useMemo } from 'react';
import { formatTime } from '@/components/shared';

/**
 * Verlaufsdarstellung der Messwerte (Lastenheft §3.3).
 *
 * Bewusst ein schlichter Linienzug ohne Diagramm-Bibliothek: gezeigt wird der
 * Trend, nicht der exakte Wert – eine zusätzliche Abhängigkeit wäre dafür nicht
 * gerechtfertigt (CLAUDE.md §1).
 *
 * **Was der Linienzug bisher verschwieg** (Fundpunkt 222): Es gab weder eine
 * Skala noch einen Zeitbezug – zwei Kurven nebeneinander sahen gleich aus,
 * obwohl die eine bei 12 % und die andere bei 95 % lag. Und ohne feste
 * Obergrenze zog sich die Achse auf den größten gemessenen Wert zusammen: Eine
 * über eine Stunde konstante Reihe (drei Spieler, immer) erschien als
 * Vollausschlag am oberen Rand.
 *
 * Jetzt steht die Obergrenze an der Achse, die Zeitspanne unter dem Bild, und
 * ohne vorgegebenes Maximum wird auf den nächsten runden Wert **über** dem
 * größten Messwert aufgerundet – eine konstante Reihe liegt damit sichtbar
 * unter dem Rand.
 */

export interface StatsHistoryChartProps {
  samples: readonly ServerLiveStats[];
  /** Welcher Wert dargestellt wird. */
  metric: 'cpuPercent' | 'ramUsedMb' | 'playersOnline';
  label: string;
  /**
   * Obergrenze der Achse – das Kontingent des Servers, wo es eines gibt.
   *
   * Ohne Angabe (oder wenn die Messwerte darüber liegen) wird aufgerundet,
   * siehe {@link rundeAuf}.
   */
  max?: number | null;
  /** Beschriftung der Achsenwerte; ohne Angabe die nackte Zahl. */
  formatValue?: (value: number) => string;
}

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 64;

/**
 * Nächster runder Wert über `wert` – 1, 2 oder 5 mal eine Zehnerpotenz.
 *
 * Dieselbe Staffelung, die Diagramme üblicherweise für Achsen nehmen: Sie
 * liefert für 3 die 5, für 42 die 50, für 1300 die 2000. Ohne sie klebte eine
 * konstante Reihe am oberen Rand.
 */
function rundeAuf(wert: number): number {
  if (wert <= 0) return 1;

  const potenz = 10 ** Math.floor(Math.log10(wert));
  for (const stufe of [1, 2, 5, 10]) {
    const kandidat = stufe * potenz;
    if (kandidat >= wert) return kandidat;
  }

  return 10 * potenz;
}

export function StatsHistoryChart({
  samples,
  metric,
  label,
  max,
  formatValue,
}: StatsHistoryChartProps) {
  const bild = useMemo(() => {
    const values = samples
      .map((sample) => sample[metric])
      .filter((value): value is number => value !== null);

    if (values.length < 2) return null;

    const gemessenesMaximum = Math.max(...values);
    /*
     * Die vorgegebene Obergrenze gewinnt, solange die Messwerte darunter
     * bleiben. Liegt etwas darüber – ein Server darf sein RAM-Limit kurz
     * überschreiten –, wird aufgerundet, statt die Linie oben abzuschneiden.
     */
    const obergrenze =
      max != null && max > 0 && max >= gemessenesMaximum ? max : rundeAuf(gemessenesMaximum);

    const step = VIEW_WIDTH / (values.length - 1);
    const punkte = values
      .map((value, index) => {
        const x = Math.round(index * step * 10) / 10;
        const y = Math.round((VIEW_HEIGHT - (value / obergrenze) * VIEW_HEIGHT) * 10) / 10;
        return `${x},${y}`;
      })
      .join(' ');

    return {
      punkte,
      obergrenze,
      letzter: values[values.length - 1] ?? 0,
      // Die Fläche unter der Linie – sie macht den Verlauf auf einen Blick
      // lesbar, ohne eine zweite Farbe einzuführen.
      flaeche: `0,${VIEW_HEIGHT} ${punkte} ${VIEW_WIDTH},${VIEW_HEIGHT}`,
    };
  }, [samples, metric, max]);

  const zeitraum = useMemo(() => {
    const erster = samples[0]?.updatedAt;
    const letzter = samples[samples.length - 1]?.updatedAt;
    if (erster === undefined || letzter === undefined) return null;
    return `${formatTime(erster)} – ${formatTime(letzter)} Uhr`;
  }, [samples]);

  if (!bild) {
    return (
      <p className="rounded-md border border-line bg-fill px-3 py-6 text-center text-xs text-ink-faint">
        Noch zu wenige Messwerte für einen Verlauf.
      </p>
    );
  }

  const beschrifte = formatValue ?? ((wert: number) => String(wert));

  return (
    <figure className="rounded-md border border-line bg-fill p-3">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-2xs uppercase tracking-[0.08em] text-ink-soft">{label}</span>
        <span className="font-mono text-2xs text-ink-muted">{beschrifte(bild.letzter)}</span>
      </figcaption>

      <div className="flex gap-2">
        {/* Skala: Obergrenze oben, Null unten – mehr braucht ein Trendbild nicht. */}
        <div className="flex shrink-0 flex-col justify-between text-2xs text-ink-faint">
          <span>{beschrifte(bild.obergrenze)}</span>
          <span>0</span>
        </div>

        <svg
          role="img"
          aria-label={`Verlauf: ${label}, zuletzt ${beschrifte(bild.letzter)} von ${beschrifte(
            bild.obergrenze,
          )}`}
          width="100%"
          height={VIEW_HEIGHT}
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          className="min-w-0 flex-1"
        >
          {/* Hilfslinie auf halber Höhe – ohne sie fehlt jeder Bezug. */}
          <line
            x1={0}
            y1={VIEW_HEIGHT / 2}
            x2={VIEW_WIDTH}
            y2={VIEW_HEIGHT / 2}
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="4 4"
            className="text-line"
          />
          <polyline points={bild.flaeche} fill="currentColor" className="text-brand opacity-15" />
          <polyline
            points={bild.punkte}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="text-brand"
          />
        </svg>
      </div>

      {zeitraum === null ? null : (
        <p className="mt-1.5 text-right text-2xs text-ink-faint">{zeitraum}</p>
      )}
    </figure>
  );
}
