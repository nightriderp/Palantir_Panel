import { type ReactNode } from 'react';
import { cn } from '../utils/cn';

export interface PanelProps {
  /**
   * `raised` – gefüllte Karte mit Verlauf (eigene Inhalte).
   * `outline` – nur Kontur, keine Fläche (fremde/nicht eigene Inhalte).
   * `plain` – ruhige Fläche ohne Verlauf (Popover, Listenrahmen).
   */
  variant?: 'raised' | 'outline' | 'plain';
  /** Innenabstand; `none`, wenn der Inhalt eigene Abstände mitbringt. */
  padding?: 'none' | 'sm' | 'md';
  className?: string;
  children: ReactNode;
}

const VARIANT_CLASSES = {
  raised: 'bg-card-gradient border border-line',
  outline: 'bg-transparent border border-line',
  plain: 'bg-surface border border-line',
} as const;

const PADDING_CLASSES = {
  none: '',
  sm: 'p-3.5',
  md: 'p-4',
} as const;

/** Flächenbaustein für Karten, Kennzahlen-Kacheln und Listenrahmen. */
export function Panel({ variant = 'raised', padding = 'md', className, children }: PanelProps) {
  return (
    <div
      className={cn('rounded-2xl', VARIANT_CLASSES[variant], PADDING_CLASSES[padding], className)}
    >
      {children}
    </div>
  );
}

export interface MetricTileProps {
  label: string;
  value: ReactNode;
  /** Erläuterung unter dem Wert. */
  note?: string;
  className?: string;
}

/** Kennzahlen-Kachel („Übersicht"-Tab, Node-Ansicht, Admin-Bereiche). */
export function MetricTile({ label, value, note, className }: MetricTileProps) {
  return (
    <Panel variant="raised" padding="sm" className={cn('rounded-xl', className)}>
      <div className="text-xs uppercase tracking-[0.08em] text-ink-soft">{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-semibold">{value}</div>
      {note ? <div className="mt-1 text-xs text-ink-faint">{note}</div> : null}
    </Panel>
  );
}
