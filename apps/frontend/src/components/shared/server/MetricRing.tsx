import { TONE_TEXT_CLASSES, type Tone } from '../primitives/Badge';
import { clampPercent } from '../utils/format';
import { cn } from '../utils/cn';

export interface MetricRingProps {
  /** Kurzbeschriftung unter dem Ring, z. B. „CPU". */
  label: string;
  /** Anzeigewert in der Mitte, z. B. `42 %` oder `—`. */
  value: string;
  /** Füllgrad 0–100. Wird begrenzt; `null` zeichnet nur die Spur. */
  percent: number | null;
  tone?: Tone;
  /** Erklärung beim Darüberfahren – etwa „gilt für alle Server des Nodes". */
  title?: string;
  className?: string;
}

/** Länge des sichtbaren Ringbogens – 3/4 Kreis, der Rest bleibt offen. */
const ARC_LENGTH = 75;

/**
 * Ringförmige Kennzahl der `ServerCard` (CPU, RAM, Speicher, Ping).
 *
 * Der Ring ist rein dekorativ; der Wert steht als Text in der Mitte und ist
 * damit auch für Screenreader lesbar.
 *
 * Geometrie und Gewichtung folgen dem Vorbild aus `hafenmeister`
 * (`components/ui.tsx`, `Gauge`): ein kräftigerer Bogen (Stärke 7 auf einem
 * 80er-Feld statt 4 auf 48) und die Zahl fett in der Mitte. Der dünne Ring mit
 * 10-px-Zahl davor löste sich auf einer Kachel mit vier Ringen optisch auf –
 * man sah vier graue Kringel, aber keine Werte.
 *
 * Die Füllung wandert weich auf ihren Stand (`transition`), damit ein neuer
 * Messwert nicht springt; wer Bewegung abgeschaltet hat, bekommt über die
 * Regel in `globals.css` sofort den Endwert.
 */
export function MetricRing({
  label,
  value,
  percent,
  tone = 'brand',
  title,
  className,
}: MetricRingProps) {
  const filled = percent == null ? 0 : (clampPercent(percent) * ARC_LENGTH) / 100;
  // Ohne Messwert bleibt der Bogen leer und die Zahl grau – „unbekannt" ist
  // nicht dasselbe wie „null".
  const valueTone = percent == null && value === '—' ? 'neutral' : tone;

  return (
    <div className={cn('flex flex-col items-center gap-1.5', className)} title={title}>
      <div className="relative h-ring w-ring">
        <svg viewBox="0 0 80 80" className="block h-full w-full" aria-hidden>
          {/*
            Spur des Rings: derselbe Wert wie jede Trennlinie, deshalb über das
            Token `line` statt als literales `rgba(...)` (Audit W3-2,
            frontend-lib-17; Regel aus `tailwind.config.ts`).
          */}
          <circle
            cx={40}
            cy={40}
            r={33}
            fill="none"
            strokeWidth={7}
            strokeDasharray={`${ARC_LENGTH} 100`}
            pathLength={100}
            strokeLinecap="round"
            transform="rotate(135 40 40)"
            className="stroke-line"
          />
          <circle
            cx={40}
            cy={40}
            r={33}
            fill="none"
            stroke="currentColor"
            strokeWidth={7}
            strokeDasharray={`${filled.toFixed(1)} 100`}
            pathLength={100}
            strokeLinecap="round"
            transform="rotate(135 40 40)"
            className={cn(
              'transition-[stroke-dasharray] duration-500 ease-out',
              TONE_TEXT_CLASSES[tone],
            )}
          />
        </svg>
        <div
          className={cn(
            'absolute inset-0 flex items-center justify-center font-mono text-base font-bold',
            TONE_TEXT_CLASSES[valueTone],
          )}
        >
          {value}
        </div>
      </div>
      <div className="text-3xs font-medium uppercase tracking-[0.08em] text-ink-faint">{label}</div>
    </div>
  );
}
