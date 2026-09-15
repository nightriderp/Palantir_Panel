'use client';

import { useMemo } from 'react';
import { cn } from '../utils/cn';

/**
 * Verlaufsbild für eine Kennzahl – die eine Zeichenroutine des Panels.
 *
 * Bis hierher zeichnete allein `StatsHistoryChart` auf der Detailseite, und
 * zwar aus `ServerLiveStats`. Die Kopfzeile braucht dieselbe Kurve für Zahlen,
 * die es als Messwert gar nicht gibt (Server online, Spieler, Node-Auslastung)
 * und die nur im Browser gesammelt werden. Deshalb nimmt dieses Bild **Punkte**
 * statt Messwerte; wer Messwerte hat, rechnet sie vorher um.
 *
 * Vorbild ist hafenmeister (`MetricChart.tsx`): selbstgezeichnetes SVG, keine
 * Diagramm-Bibliothek. Die Entscheidung bleibt – eine Bibliothek für zwei
 * Linien wäre ein halbes Megabyte für nichts.
 */

export interface ChartPoint {
  /** Zeitpunkt in Millisekunden seit Epoch. */
  ts: number;
  value: number;
}

export interface MetricChartProps {
  points: readonly ChartPoint[];
  /** Beschriftung für Vorlesewerkzeuge; sichtbar nur, wenn `caption` gesetzt ist. */
  label: string;
  /** Kopfzeile über dem Bild; ohne Angabe bleibt sie weg (Kopfzeilen-Popover). */
  caption?: string | undefined;
  /**
   * Obergrenze der Achse. Ohne Angabe wird auf den nächsten runden Wert über
   * dem Höchstwert aufgerundet.
   */
  max?: number | null;
  /** Beschriftung der Werte; ohne Angabe die nackte Zahl. */
  formatValue?: ((value: number) => string) | undefined;
  /** Kleine Bauform für das Popover der Kopfzeile. */
  compact?: boolean | undefined;
  /** Text, wenn es für eine Linie noch nicht reicht. */
  emptyHint?: string | undefined;
  className?: string | undefined;
}

const VIEW_WIDTH = 300;
const VIEW_HEIGHT = 64;
const VIEW_HEIGHT_COMPACT = 44;

/**
 * Nächster runder Wert über `wert` – 1, 2 oder 5 mal eine Zehnerpotenz.
 *
 * Dieselbe Staffelung, die Diagramme üblicherweise für Achsen nehmen: Sie
 * liefert für 3 die 5, für 42 die 50, für 1300 die 2000. Ohne sie klebte eine
 * konstante Reihe am oberen Rand.
 */
export function rundeAuf(wert: number): number {
  if (wert <= 0) return 1;

  const potenz = 10 ** Math.floor(Math.log10(wert));
  for (const stufe of [1, 2, 5, 10]) {
    const kandidat = stufe * potenz;
    if (kandidat >= wert) return kandidat;
  }

  return 10 * potenz;
}

export function MetricChart({
  points,
  label,
  caption,
  max,
  formatValue,
  compact,
  emptyHint,
  className,
}: MetricChartProps) {
  const hoehe = compact === true ? VIEW_HEIGHT_COMPACT : VIEW_HEIGHT;

  const bild = useMemo(() => {
    const values = points.map((point) => point.value);

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
    const linie = values
      .map((value, index) => {
        const x = Math.round(index * step * 10) / 10;
        const y = Math.round((hoehe - (value / obergrenze) * hoehe) * 10) / 10;
        return `${String(x)},${String(y)}`;
      })
      .join(' ');

    return {
      linie,
      obergrenze,
      letzter: values[values.length - 1] ?? 0,
      // Die Fläche unter der Linie – sie macht den Verlauf auf einen Blick
      // lesbar, ohne eine zweite Farbe einzuführen.
      flaeche: `0,${String(hoehe)} ${linie} ${String(VIEW_WIDTH)},${String(hoehe)}`,
    };
  }, [points, max, hoehe]);

  const beschrifte = formatValue ?? ((wert: number) => String(wert));

  if (!bild) {
    return (
      <p
        className={cn(
          'rounded-md border border-line bg-fill px-3 text-center text-xs text-ink-faint',
          compact === true ? 'py-3' : 'py-6',
          className,
        )}
      >
        {emptyHint ?? 'Noch zu wenige Messwerte für einen Verlauf.'}
      </p>
    );
  }

  return (
    <figure className={cn('rounded-md border border-line bg-fill p-3', className)}>
      {caption === undefined ? null : (
        <figcaption className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-2xs uppercase tracking-[0.08em] text-ink-soft">{caption}</span>
          <span className="font-mono text-2xs text-ink-muted">{beschrifte(bild.letzter)}</span>
        </figcaption>
      )}

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
          viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(hoehe)}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          style={{ height: hoehe }}
        >
          <polygon points={bild.flaeche} className="fill-brand/15" />
          <polyline
            points={bild.linie}
            fill="none"
            className="stroke-brand"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </figure>
  );
}
