import { type ReactNode } from 'react';
import { cn } from '../utils/cn';

/**
 * Farbliche Bedeutung eines Hinweises. Die Zuordnung ist im ganzen Panel gleich:
 * `success` = läuft, `warning` = in Arbeit / Hinweis, `caution` = wird beendet,
 * `danger` = Störung, `neutral` = ruhend, `brand` = Zähler/Markierung.
 */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'caution' | 'danger';

export const TONE_TEXT_CLASSES: Record<Tone, string> = {
  neutral: 'text-ink-faint',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  caution: 'text-caution',
  danger: 'text-danger',
};

export const TONE_PILL_CLASSES: Record<Tone, string> = {
  neutral: 'bg-fill-strong text-ink-faint',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  caution: 'bg-warning-soft text-caution',
  danger: 'bg-danger-soft text-danger',
};

export const TONE_DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-ink-faint',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  caution: 'bg-caution',
  danger: 'bg-danger',
};

export interface BadgeProps {
  tone?: Tone;
  /** Punkt vor der Beschriftung – für Zustände, nicht für Zähler. */
  withDot?: boolean;
  /** Lässt den Punkt pulsieren, solange etwas aktiv ist. */
  pulse?: boolean;
  className?: string;
  children: ReactNode;
}

/** Kleiner Zustands- oder Zählerhinweis in Pillenform. */
export function Badge({ tone = 'neutral', withDot, pulse, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        TONE_PILL_CLASSES[tone],
        className,
      )}
    >
      {withDot ? <StatusDot tone={tone} pulse={pulse} /> : null}
      {children}
    </span>
  );
}

export interface StatusDotProps {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}

/** Farbpunkt für Zustände – auch einzeln nutzbar (Serverliste, Node-Übersicht). */
export function StatusDot({ tone = 'neutral', pulse, className }: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-[7px] w-[7px] rounded-full',
        TONE_DOT_CLASSES[tone],
        pulse && 'animate-pulse-dot',
        className,
      )}
    />
  );
}

export interface CountBadgeProps {
  count: number;
  className?: string;
}

/** Zähler in der Navigation (ungelesene Nachrichten). Ab 100 als `99+`. */
export function CountBadge({ count, className }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'rounded-full bg-brand px-1.5 py-0.5 font-mono text-2xs font-bold text-white',
        className,
      )}
    >
      {count >= 100 ? '99+' : count}
    </span>
  );
}
