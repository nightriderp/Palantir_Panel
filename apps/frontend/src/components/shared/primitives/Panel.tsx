import { type ReactNode } from 'react';
import { TONE_DOT_CLASSES, TONE_TEXT_CLASSES, type Tone } from './Badge';
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
  /**
   * Füllstand des Balkens unter dem Wert, 0 bis 100.
   *
   * Vorbild hafenmeister: Ein dünner Balken beantwortet „viel oder wenig", was
   * eine Zahl allein nicht tut - 1,4 GB sagen nichts, 1,4 von 4 GB schon. Ohne
   * Angabe bleibt die Kachel wie bisher: Beschriftung, Wert, Hinweis.
   *
   * Der Hinweis (`note`) ersetzt den Balken, statt neben ihm zu stehen: Wo kein
   * Wert vorliegt, gibt es auch keinen Füllstand, und ein Balken bei null sähe
   * aus wie eine Messung.
   */
  percent?: number;
  /**
   * Macht die Kachel zur Schaltfläche - für die Kacheln, unter denen sich ein
   * Verlauf aufklappt. Ohne Angabe bleibt sie ein stilles Feld.
   */
  onClick?: () => void;
  /** Ist der zugehörige Bereich offen? Färbt die Kachel und dreht den Pfeil. */
  expanded?: boolean;
  /** Überschreibt den Titel der Schaltfläche (Vorgabe: „Verlauf anzeigen/schließen"). */
  toggleTitle?: string;
  className?: string;
}

/** Kennzahlen-Kachel („Übersicht"-Tab, Node-Ansicht, Admin-Bereiche). */
export function MetricTile({
  label,
  value,
  note,
  tone,
  percent,
  onClick,
  expanded,
  toggleTitle,
  className,
}: MetricTileProps) {
  const inhalt = (
    <>
      <div className="flex items-center justify-between gap-2">
        {/*
          Beschriftung in normaler Schreibweise. Versalien mit gesperrtem Satz
          lasen sich in einer Reihe von sechs Kacheln als Balken aus
          Grossbuchstaben – die Zahl darunter soll die Kachel tragen, nicht ihr
          Etikett.
        */}
        <div className="text-xs text-ink-soft">{label}</div>
        {onClick === undefined ? null : (
          <span
            aria-hidden
            className={cn(
              'text-xs text-ink-soft transition-transform',
              expanded === true ? 'rotate-180' : undefined,
            )}
          >
            ▾
          </span>
        )}
      </div>
      <div
        className={cn(
          'mt-1.5 text-left font-mono text-2xl font-semibold',
          tone ? TONE_TEXT_CLASSES[tone] : undefined,
        )}
      >
        {value}
      </div>
      {note ? (
        <div className="mt-1 text-left text-xs text-ink-faint">{note}</div>
      ) : percent === undefined ? null : (
        /*
          Balken statt Hinweis: Er steht nur dort, wo auch ein Wert steht.
          `aria-hidden`, weil er nichts sagt, was der Wert darüber nicht schon
          nennt - vorgelesen wäre er eine zweite, ungenauere Zahl.
        */
        <div aria-hidden className="mt-2.5 h-[5px] overflow-hidden rounded-full bg-fill">
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-out',
              tone ? TONE_DOT_CLASSES[tone] : 'bg-brand',
            )}
            style={{ width: `${String(Math.min(100, Math.max(0, percent)))}%` }}
          />
        </div>
      )}
    </>
  );

  if (onClick === undefined) {
    return (
      <Panel variant="raised" padding="sm" className={cn('rounded-xl', className)}>
        {inhalt}
      </Panel>
    );
  }

  /*
    Eine Kachel, unter der sich etwas öffnet, ist eine Schaltfläche - kein `div`
    mit `onClick`. Nur so erreicht sie die Tastatur, und nur so weiss ein
    Vorlesewerkzeug, dass hier etwas auf- und zugeht (`aria-expanded`).
  */
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded === true}
      title={toggleTitle ?? (expanded === true ? 'Verlauf schließen' : 'Verlauf anzeigen')}
      className={cn(
        'rounded-xl border p-3.5 text-left transition-colors',
        expanded === true
          ? 'border-brand/40 bg-brand/[0.06]'
          : 'border-line bg-card-gradient hover:border-line-strong',
        className,
      )}
    >
      {inhalt}
    </button>
  );
}
