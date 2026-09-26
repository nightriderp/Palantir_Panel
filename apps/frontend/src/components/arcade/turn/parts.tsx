'use client';

import { Component, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { Avatar, Button, Icon, Spinner, StatusDot, cn, formatNumber } from '@/components/shared';
import { type TurnSeatInfo } from './types';

/**
 * Gemeinsame Bausteine der rundenbasierten Wirte (am Gerät und online).
 *
 * Sitzleiste, Spielverlauf und Ergebnis sehen in beiden Spielweisen gleich
 * aus – wer vom Gerät in einen Online-Raum wechselt, soll sich nicht neu
 * zurechtfinden müssen.
 */

export interface SeatRowExtra {
  /** Profilbild (online). */
  avatarSrc?: string | null;
  /** Online-Punkt (nur in Räumen). */
  online?: boolean;
  /** „denkt …" – ein Bot rechnet gerade. */
  thinking?: boolean;
  /** Knöpfe am Sitz (Gastgeber: Computer einsetzen, entfernen …). */
  actions?: ReactNode;
}

export function SeatList({
  seats,
  activeSeats,
  extras = {},
  winners = [],
  scores,
}: {
  seats: readonly TurnSeatInfo[];
  activeSeats: readonly number[];
  extras?: Record<number, SeatRowExtra>;
  winners?: readonly number[];
  scores?: readonly number[];
}) {
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Sitze">
      {seats.map((seat) => {
        const extra = extras[seat.index] ?? {};
        const aktiv = activeSeats.includes(seat.index);
        const sieger = winners.includes(seat.index);
        return (
          <li
            key={seat.index}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-2.5 py-2 transition-colors',
              aktiv ? 'border-transparent bg-fill-strong' : 'border-line bg-fill',
            )}
            style={aktiv ? { boxShadow: `inset 0 0 0 2px ${seat.color}` } : undefined}
          >
            <span className="relative shrink-0">
              {seat.kind === 'human' && extra.avatarSrc !== undefined ? (
                <Avatar src={extra.avatarSrc} displayName={seat.name} size="sm" />
              ) : (
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: seat.color }}
                >
                  {seat.kind === 'bot'
                    ? 'KI'
                    : seat.kind === 'open'
                      ? '·'
                      : seat.name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-deep"
                style={{ background: seat.color }}
              />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-sm',
                  seat.kind === 'open' ? 'text-ink-faint italic' : 'text-ink',
                )}
              >
                {seat.name}
                {seat.isMe ? <span className="text-ink-faint"> · du</span> : null}
              </span>
              {extra.thinking ? (
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <Spinner /> denkt …
                </span>
              ) : aktiv ? (
                <span className="text-xs font-medium" style={{ color: seat.color }}>
                  ist am Zug
                </span>
              ) : null}
            </span>
            {extra.online !== undefined && seat.kind === 'human' ? (
              <StatusDot tone={extra.online ? 'success' : 'neutral'} className="shrink-0" />
            ) : null}
            {scores?.[seat.index] !== undefined ? (
              <span className="font-mono text-sm text-ink">
                {formatNumber(scores[seat.index] ?? 0)}
              </span>
            ) : null}
            {sieger ? <Icon name="medal" size={16} className="shrink-0 text-warning" /> : null}
            {extra.actions}
          </li>
        );
      })}
    </ul>
  );
}

export function MatchLog({
  entries,
  seats,
}: {
  entries: readonly { seat: number | null; text: string }[];
  seats: readonly TurnSeatInfo[];
}) {
  const ende = useRef<HTMLLIElement>(null);
  useEffect(() => {
    ende.current?.scrollIntoView({ block: 'nearest' });
  }, [entries.length]);

  if (entries.length === 0) return <p className="text-sm text-ink-faint">Noch nichts passiert.</p>;
  return (
    <ol
      className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1 text-sm"
      aria-label="Spielverlauf"
    >
      {entries.map((entry, index) => {
        const seat = entry.seat === null ? null : seats[entry.seat];
        return (
          <li
            key={index}
            ref={index === entries.length - 1 ? ende : undefined}
            className="leading-snug text-ink-muted"
          >
            {seat ? (
              <span className="font-semibold" style={{ color: seat.color }}>
                {seat.name}:{' '}
              </span>
            ) : null}
            {entry.text}
          </li>
        );
      })}
    </ol>
  );
}

/** Ergebnis einer Partie: Gewinner, Satz, Punktetabelle. */
export function OutcomeSummary({
  winners,
  summary,
  scores,
  seats,
}: {
  winners: readonly number[];
  summary: string;
  scores?: readonly number[];
  seats: readonly TurnSeatInfo[];
}) {
  const namen = winners.map((index) => seats[index]?.name ?? `Sitz ${index + 1}`);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-lg font-bold text-ink">
        <Icon name="medal" size={22} className="text-warning" />
        {namen.length === 0
          ? 'Unentschieden'
          : namen.length === 1
            ? `${namen[0]} gewinnt!`
            : `Gewonnen: ${namen.join(', ')}`}
      </div>
      {summary ? <p className="text-base text-ink-muted">{summary}</p> : null}
      {scores && scores.length > 0 ? (
        <table className="w-full text-sm">
          <tbody>
            {[...seats]
              .sort((a, b) => (scores[b.index] ?? 0) - (scores[a.index] ?? 0))
              .map((seat) => (
                <tr key={seat.index} className="border-b border-line last:border-0">
                  <td className="py-1.5">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: seat.color }}
                    />
                    {seat.name}
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {formatNumber(scores[seat.index] ?? 0)}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

class BoardErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) {
      return (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <Icon name="warning" size={24} className="text-warning" />
          <p className="text-base text-ink-muted">Das Spielbrett konnte nicht angezeigt werden.</p>
          <Button
            variant="secondary"
            iconLeft="restart"
            onClick={() => this.setState({ failed: false })}
          >
            Nochmal versuchen
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Rahmen für ein lazy geladenes Brett: Ladeanzeige und Fehlergrenze. */
export function BoardFrame({ children, accent }: { children: ReactNode; accent: string }) {
  return (
    <div
      className="relative min-h-[240px] overflow-hidden rounded-2xl border-2 bg-surface-deep"
      style={{ borderColor: `${accent}44` }}
    >
      <BoardErrorBoundary>
        <Suspense
          fallback={
            <div className="flex min-h-[240px] items-center justify-center gap-2 text-ink-muted">
              <Spinner /> Spielbrett wird geladen …
            </div>
          }
        >
          {children}
        </Suspense>
      </BoardErrorBoundary>
    </div>
  );
}
