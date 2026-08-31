'use client';

import { cn } from '@/components/shared';
import { type StatusMetric, type StatusMetricTone } from './shellSummary';

/**
 * Gesamtstatus-Leiste in der Kopfzeile (Mockup „Gesamtstatus").
 *
 * Zeigt links in der Kopfleiste, wie es um die Instanz insgesamt steht – auf
 * jeder Seite gleich, damit ein Blick genügt. Was gerechnet wird, steht in
 * `shellSummary.ts`; hier wird nur dargestellt.
 *
 * **Unterhalb von 768px** entfällt die Beschriftung „Gesamtstatus", wie im
 * Mockup: dort ist die Zeile für die Menü-Schaltfläche und die Zahlen zu eng.
 * Die Kennzahlen selbst brechen um, statt zu verschwinden.
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
  // Solange nichts geladen ist, bleibt die Leiste leer statt „0/0" zu behaupten.
  if (metrics.length === 0) return <div className="flex-1" />;

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4.5 gap-y-1.5">
      <span className="hidden shrink-0 text-xs uppercase tracking-[0.1em] text-ink-soft md:inline">
        Gesamtstatus
      </span>

      {metrics.map((metric) => (
        <span key={metric.key} title={metric.note} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLASSES[metric.tone])}
          />
          <span className={cn('font-mono text-base font-semibold', VALUE_CLASSES[metric.tone])}>
            {metric.value}
          </span>
          <span className="text-xs text-ink-soft">{metric.label}</span>
        </span>
      ))}
    </div>
  );
}
