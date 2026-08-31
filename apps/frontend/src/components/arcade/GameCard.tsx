'use client';

import { type ArcadeGameDefinition, type ArcadeLeaderboardDto } from '@palantir/contracts';
import { Button, Icon, cn, formatNumber } from '@/components/shared';

/**
 * Kachel eines Minispiels auf der Arcade-Auswahlseite (Arbeitspaket F8).
 *
 * Zeigt den eigenständigen Namen, den Untertitel und eine kurze Beschreibung
 * (alles aus dem Contract-Katalog). Kein Original-Titel und keine
 * Original-Grafik – die Kachel trägt nur ein schlichtes Symbol (Lastenheft §3.9).
 *
 * Dazu wie im Mockup die eigene Bestleistung und die Spitze der Bestenliste:
 * Wer auf die Seite kommt, soll sehen, wo er steht, ohne erst ein Spiel öffnen
 * zu müssen. Die Karte lädt dafür nichts nach – die Liste kommt von oben.
 *
 * Die Kachel ist bewusst **kein** Knopf mehr: „Spielen" ist einer, und ein Knopf
 * im Knopf ist kein gültiges Markup.
 */

/** So viele Plätze zeigt die Kachel; der Rest steht im Spielbildschirm. */
const VISIBLE_RANKS = 3;

export interface GameCardProps {
  game: ArcadeGameDefinition;
  /** Bestenliste des Spiels; `null`, solange sie lädt oder nicht abrufbar war. */
  leaderboard?: ArcadeLeaderboardDto | null;
  onSelect(): void;
}

export function GameCard({ game, leaderboard = null, onSelect }: GameCardProps) {
  const entries = leaderboard?.entries.slice(0, VISIBLE_RANKS) ?? [];

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line-strong bg-card-gradient p-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-tile bg-brand-soft text-brand-bright"
        >
          <Icon name="gamepad" size={22} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold text-ink">{game.name}</h3>
          <p className="font-mono text-xs text-ink-faint">
            Bestleistung: {formatNumber(leaderboard?.personal?.bestScore ?? 0)}
          </p>
        </div>
      </div>

      <p className="text-sm text-ink-soft">{game.tagline}</p>
      <p className="text-sm leading-relaxed text-ink-muted">{game.description}</p>

      {leaderboard === null ? null : entries.length === 0 ? (
        <p className="text-sm text-ink-faint">Noch niemand hat gespielt.</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {entries.map((entry) => (
            <li
              key={entry.userId}
              className={cn(
                'flex justify-between gap-3 text-sm',
                entry.isCurrentUser ? 'text-brand' : 'text-ink-muted',
              )}
            >
              <span className="truncate">
                {entry.rank}. {entry.displayName}
                {entry.isCurrentUser ? ' (du)' : ''}
              </span>
              <span className="shrink-0 font-mono">{formatNumber(entry.bestScore)}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-auto pt-1">
        <Button variant="primary" onClick={onSelect}>
          Spielen
        </Button>
      </div>
    </article>
  );
}
