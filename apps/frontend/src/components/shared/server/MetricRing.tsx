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
  className?: string;
}

/** Länge des sichtbaren Ringbogens – 3/4 Kreis, der Rest bleibt offen. */
const ARC_LENGTH = 75;

/**
 * Ringförmige Kennzahl der `ServerCard` (CPU, RAM, Speicher, Ping).
 *
 * Der Ring ist rein dekorativ; der Wert steht als Text in der Mitte und ist
 * damit auch für Screenreader lesbar.
 */
export function MetricRing({ label, value, percent, tone = 'brand', className }: MetricRingProps) {
  const filled = percent == null ? 0 : (clampPercent(percent) * ARC_LENGTH) / 100;

  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <div className="relative h-12 w-12">
        <svg width={48} height={48} viewBox="0 0 48 48" className="rotate-[135deg]" aria-hidden>
          <circle
            cx={24}
            cy={24}
            r={19}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={4}
            strokeDasharray={`${ARC_LENGTH} 100`}
            pathLength={100}
            strokeLinecap="round"
          />
          <circle
            cx={24}
            cy={24}
            r={19}
            fill="none"
            stroke="currentColor"
            strokeWidth={4}
            strokeDasharray={`${filled.toFixed(1)} 100`}
            pathLength={100}
            strokeLinecap="round"
            className={TONE_TEXT_CLASSES[tone]}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-mono text-2xs font-semibold">
          {value}
        </div>
      </div>
      <div className="text-3xs uppercase tracking-[0.06em] text-ink-soft">{label}</div>
    </div>
  );
}
