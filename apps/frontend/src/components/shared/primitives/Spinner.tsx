import { cn } from '../utils/cn';

export interface SpinnerProps {
  /** Kantenlänge in Pixeln. Vorgabe passt neben Text in `text-base`. */
  size?: number;
  className?: string;
}

/**
 * Drehender Ring als Zeichen „läuft gerade".
 *
 * Bewusst ein Rand und kein Symbol aus `Icon`: Der Ring erbt über
 * `border-current` die Textfarbe seiner Umgebung und passt damit in jede
 * Schaltflächen-Variante, ohne dass jede Aufrufstelle eine Farbe mitgeben muss.
 *
 * `aria-hidden`, weil er nichts sagt, was die Aufrufstelle nicht schon sagt –
 * eine gesperrte Schaltfläche und ihr Text tragen die Auskunft. Vorgelesen
 * wäre er nur ein Element ohne Namen.
 */
export function Spinner({ size = 14, className }: SpinnerProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
