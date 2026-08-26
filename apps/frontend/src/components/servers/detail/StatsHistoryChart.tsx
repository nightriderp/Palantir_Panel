'use client';

import { type ServerLiveStats } from '@palantir/contracts';
import { useMemo } from 'react';

/**
 * Verlaufsdarstellung der Messwerte (Lastenheft §3.3).
 *
 * Bewusst ein schlichter Linienzug ohne Diagramm-Bibliothek: gezeigt wird der
 * Trend, nicht der exakte Wert – der steht als Zahl darüber. Eine zusätzliche
 * Abhängigkeit wäre dafür nicht gerechtfertigt (CLAUDE.md §1).
 */

export interface StatsHistoryChartProps {
  samples: readonly ServerLiveStats[];
  /** Welcher Wert dargestellt wird. */
  metric: 'cpuPercent' | 'ramUsedMb' | 'playersOnline';
  label: string;
  /** Obergrenze der Achse; ohne Angabe der größte gemessene Wert. */
  max?: number | null;
}

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 64;

export function StatsHistoryChart({ samples, metric, label, max }: StatsHistoryChartProps) {
  const points = useMemo(() => {
    const values = samples
      .map((sample) => sample[metric])
      .filter((value): value is number => value !== null);

    if (values.length < 2) return null;

    const upper = Math.max(max ?? 0, ...values, 1);
    const step = VIEW_WIDTH / (values.length - 1);

    return values
      .map((value, index) => {
        const x = Math.round(index * step * 10) / 10;
        const y = Math.round((VIEW_HEIGHT - (value / upper) * VIEW_HEIGHT) * 10) / 10;
        return `${x},${y}`;
      })
      .join(' ');
  }, [samples, metric, max]);

  if (!points) {
    return (
      <p className="rounded-md border border-line bg-fill px-3 py-6 text-center text-xs text-ink-faint">
        Noch zu wenige Messwerte für einen Verlauf.
      </p>
    );
  }

  return (
    <figure className="rounded-md border border-line bg-fill p-3">
      <figcaption className="mb-2 text-2xs uppercase tracking-[0.08em] text-ink-soft">
        {label}
      </figcaption>
      <svg
        role="img"
        aria-label={`Verlauf: ${label}`}
        width="100%"
        height={VIEW_HEIGHT}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-brand"
        />
      </svg>
    </figure>
  );
}
