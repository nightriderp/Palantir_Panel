import { cn } from '../utils/cn';

export interface LogoMarkProps {
  /** Kantenlänge der Kachel in Pixeln (Standard 34, wie in der Navigation). */
  size?: number;
  className?: string;
}

/**
 * Palantir-Signet: Marken-Verlaufskachel mit dem Auge-Symbol aus dem Mockup.
 *
 * Wird in der Seitennavigation und auf den Auth-Seiten (F1) verwendet.
 */
export function LogoMark({ size = 34, className }: LogoMarkProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-tile bg-brand-gradient',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={Math.round(size * 0.53)}
        height={Math.round(size * 0.53)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <path
          d="M8 4v16M16 4v16M6 12c2 2.5 4 3.5 6 3.5s4-1 6-3.5"
          stroke="#0a0b0f"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
