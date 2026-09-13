import { type ReactNode } from 'react';
import { TONE_TEXT_CLASSES, type Tone } from './Badge';
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
  /**
   * Farbe des Werts. Ohne Angabe steht er in der Textfarbe.
   *
   * Gedacht für Kacheln, die dieselbe Größe wie ein Ring auf der Kachel zeigen:
   * CPU, Arbeitsspeicher, Platte und Ping tragen dort je eine feste Farbe, und
   * die Detailseite soll dieselbe Zuordnung benutzen – sonst heißt derselbe
   * Wert eine Seite weiter anders.
   */
  tone?: Tone;
  className?: string;
}

/** Kennzahlen-Kachel („Übersicht"-Tab, Node-Ansicht, Admin-Bereiche). */
export function MetricTile({ label, value, note, tone, className }: MetricTileProps) {
  return (
    <Panel variant="raised" padding="sm" className={cn('rounded-xl', className)}>
      {/*
        Beschriftung in normaler Schreibweise. Versalien mit gesperrtem Satz
        lasen sich in einer Reihe von sechs Kacheln als Balken aus Grossbuchstaben
        – die Zahl darunter soll die Kachel tragen, nicht ihr Etikett.
      */}
      <div className="text-xs text-ink-soft">{label}</div>
      <div
        className={cn(
          'mt-1.5 font-mono text-2xl font-semibold',
          tone ? TONE_TEXT_CLASSES[tone] : undefined,
        )}
      >
        {value}
      </div>
      {note ? <div className="mt-1 text-xs text-ink-faint">{note}</div> : null}
    </Panel>
  );
}
