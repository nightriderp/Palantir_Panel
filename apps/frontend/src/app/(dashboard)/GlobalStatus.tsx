'use client';

import { useState } from 'react';
import { MetricChart, cn } from '@/components/shared';
import { type StatusMetric, type StatusMetricTone } from './shellSummary';
import {
  type StatusSample,
  appendStatusSample,
  statusSeries,
  statusSpanLabel,
} from './statusHistory';

/**
 * Gesamtstatus-Leiste in der Kopfzeile (Mockup „Gesamtstatus").
 *
 * Zeigt links in der Kopfleiste, wie es um die Instanz insgesamt steht – auf
 * jeder Seite gleich, damit ein Blick genügt. Was gerechnet wird, steht in
 * `shellSummary.ts`; hier wird nur dargestellt.
 *
 * **Unterhalb von 768px** entfällt die Beschriftung „Gesamtstatus", wie im
 * Mockup: dort ist die Zeile für die Menü-Schaltfläche und die Zahlen zu eng.
 * Die Kennzahlen selbst bleiben alle da – sie rücken dort unter die Symbole in
 * eine eigene, volle Zeile, die sich seitlich schieben lässt (Fundpunkt 219).
 * Vorher brachen sie um und belegten mit sieben Zeilen die halbe
 * Bildschirmhöhe; der eigentliche Inhalt begann unter dem Falz. Neben den
 * Symbolen bliebe für sie nur ein 150 Pixel breiter Streifen – deshalb
 * `order-last` und die volle Breite statt eines Restplatzes.
 *
 * **Der Verlauf beim Überfahren** ist aus hafenmeister übernommen: Unter der
 * Kennzahl klappt eine kleine Kurve auf, die zeigt, wohin die Zahl gerade
 * läuft. Sie wird im Browser gesammelt (`statusHistory.ts`) und reicht nur so
 * weit zurück, wie die Seite offen ist – das Fenster sagt es dazu, damit
 * niemand mehr erwartet, als da ist.
 */

const DOT_CLASSES: Record<StatusMetricTone, string> = {
  success: 'bg-success',
  brand: 'bg-brand',
  warning: 'bg-warning',
  accent: 'bg-accent',
  danger: 'bg-danger',
};

const VALUE_CLASSES: Record<StatusMetricTone, string> = {
  success: 'text-success',
  brand: 'text-brand',
  warning: 'text-warning',
  accent: 'text-accent',
  danger: 'text-danger',
};

export interface GlobalStatusProps {
  metrics: readonly StatusMetric[];
}

export function GlobalStatus({ metrics }: GlobalStatusProps) {
  const [history, setHistory] = useState<StatusSample[]>([]);
  const [offen, setOffen] = useState<string | null>(null);

  /**
   * Aufzeichnen, sobald neue Werte da sind.
   *
   * Die Liste entsteht bei jedem Abruf der Shell neu; aufgezeichnet wird also
   * in deren Takt und nicht bei jedem Rendern – erkannt am Vergleich mit der
   * zuletzt gesehenen Liste, noch im Rendern statt in einem Effekt.
   */
  const [zuletzt, setZuletzt] = useState<readonly StatusMetric[] | null>(null);
  if (zuletzt !== metrics) {
    setZuletzt(metrics);

    if (metrics.length > 0) {
      setHistory((bisher) => {
        const values: Record<string, number> = {};

        for (const metric of metrics) {
          /*
            Nur echte Zahlen. „Unbekannt" wird ausgelassen, nicht als 0
            eingetragen – sonst zeigte die Kurve einen Einbruch, wo in Wahrheit
            nur niemand geantwortet hat.
          */
          if (typeof metric.numeric === 'number') values[metric.key] = metric.numeric;
        }

        return appendStatusSample(bisher, { ts: Date.now(), values });
      });
    }
  }

  // Solange nichts geladen ist, bleibt die Leiste leer statt „0/0" zu behaupten.
  if (metrics.length === 0) return <div className="flex-1" />;

  return (
    /*
      Fundpunkt 219: Auf dem Telefon brach die Leiste in sieben Zeilen um und
      belegte die halbe Bildschirmhoehe - der eigentliche Inhalt begann unter
      dem Falz. Unterhalb von `md` steht sie deshalb in einer Zeile und laesst
      sich seitlich schieben; ab `md` bricht sie wie bisher um.
    */
    <div className="order-last flex w-full min-w-0 items-center gap-x-4.5 gap-y-1.5 overflow-x-auto md:order-none md:w-auto md:flex-1 md:flex-wrap md:overflow-x-visible">
      <span className="hidden shrink-0 text-xs uppercase tracking-[0.1em] text-ink-soft md:inline">
        Gesamtstatus
      </span>

      {metrics.map((metric) => {
        const punkte = metric.format === undefined ? [] : statusSeries(history, metric.key);
        const zeigtVerlauf = offen === metric.key && punkte.length > 0;

        return (
          <span
            key={metric.key}
            title={metric.note}
            className="relative flex shrink-0 items-center gap-1.5"
            /*
              Auch über die Tastatur erreichbar – wer nicht mit der Maus
              arbeitet, käme sonst nie an den Verlauf. Ohne Punkte bleibt die
              Kennzahl aus der Tabulator-Reihenfolge: ein Halt, der nichts
              öffnet, ist nur im Weg.
            */
            tabIndex={punkte.length > 0 ? 0 : -1}
            onMouseEnter={() => setOffen(metric.key)}
            onMouseLeave={() => setOffen((aktuell) => (aktuell === metric.key ? null : aktuell))}
            onFocus={() => setOffen(metric.key)}
            onBlur={() => setOffen((aktuell) => (aktuell === metric.key ? null : aktuell))}
          >
            <span
              aria-hidden
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASSES[metric.tone])}
            />
            <span className={cn('font-mono text-base font-semibold', VALUE_CLASSES[metric.tone])}>
              {metric.value}
            </span>
            <span className="text-xs text-ink-soft">{metric.label}</span>

            {zeigtVerlauf ? (
              /*
                ⚠️ `pointer-events-none`: Das Fenster schwebt unter der Zeile und
                darf nichts abfangen. Ohne das läge es beim Wandern der Maus
                zwischen zwei Kennzahlen im Weg und flackerte.
              */
              <div className="pointer-events-none absolute left-0 top-[calc(100%+8px)] z-50 w-60 rounded-xl border border-line bg-surface p-2.5 shadow-lg">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-ink">{metric.label}</span>
                  <span className="text-2xs text-ink-faint">{statusSpanLabel(punkte)}</span>
                </div>

                <MetricChart
                  compact
                  points={punkte}
                  label={`Verlauf ${metric.label}`}
                  formatValue={metric.format}
                  emptyHint="Noch keine zwei Messungen."
                />

                {/* Damit niemand mehr erwartet, als da ist. */}
                <div className="mt-1 text-2xs leading-snug text-ink-faint">
                  Seit dem Öffnen der Seite – diese Werte werden nicht gespeichert.
                </div>
              </div>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
