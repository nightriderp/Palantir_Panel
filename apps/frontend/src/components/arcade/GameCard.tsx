'use client';

import { type ArcadeGameDefinition, type ArcadeLeaderboardDto } from '@palantir/contracts';
import { cn, formatNumber } from '@/components/shared';
import { PODIUM_COLORS, leaderboardMetric, metricUnit } from './Leaderboard';

/**
 * Kachel eines Spiels auf der Auswahlseite.
 *
 * Bild, Name, Untertitel, Spielweisen und – aus der gebündelt geladenen
 * Bestenliste – die eigene Leistung und die Spitze. Wer auf die Seite kommt,
 * soll sehen, wo er steht, ohne erst ein Spiel öffnen zu müssen.
 *
 * Die ganze Kachel ist **ein** Knopf: Sie enthält nichts anderes Bedienbares,
 * und ein großes Ziel ist auf dem Smartphone angenehmer als ein kleines
 * „Spielen" in der Ecke.
 */

const VISIBLE_RANKS = 3;

export function modeBadges(game: ArcadeGameDefinition): string[] {
  const badges: string[] = [];
  if (game.modes.solo) badges.push('Solo');
  if (game.modes.bots) badges.push('Gegen KI');
  if (game.modes.local) badges.push('Am Gerät');
  if (game.modes.online) badges.push('Online');
  return badges;
}

export function playerLabel(game: ArcadeGameDefinition): string {
  if (game.maxPlayers <= 1) return '1 Spieler';
  if (game.minPlayers === game.maxPlayers) return `${game.minPlayers} Spieler`;
  return `${game.minPlayers}–${game.maxPlayers} Spieler`;
}

export interface GameCardProps {
  game: ArcadeGameDefinition;
  /** Bestenliste des Spiels; `null`, solange sie lädt oder nicht abrufbar war. */
  leaderboard?: ArcadeLeaderboardDto | null;
  onSelect(): void;
}

export function GameCard({ game, leaderboard = null, onSelect }: GameCardProps) {
  const metric = leaderboardMetric(game.id, leaderboard);
  const entries = leaderboard?.entries.slice(0, VISIBLE_RANKS) ?? [];
  const eigen = leaderboard?.personal?.bestScore ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${game.name} öffnen`}
      className={cn(
        'group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-line-strong bg-card-gradient text-left',
        'transition duration-200 hover:-translate-y-1 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100',
      )}
      style={{ outlineColor: game.accent }}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: '16 / 10', background: `${game.accent}22` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- statische SVG-Kachel, kein Bildoptimierer nötig */}
        <img
          src={`/arcade/art/${game.id}.svg`}
          alt={`Kachelbild ${game.name}`}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            boxShadow: `inset 0 0 0 2px ${game.accent}, inset 0 -60px 60px -40px ${game.accent}55`,
          }}
        />
        <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white backdrop-blur-sm">
          {game.duration}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-md font-bold leading-tight text-ink">{game.name}</h3>
          {eigen !== null && eigen > 0 ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 font-mono text-xs font-semibold"
              style={{ background: `${game.accent}22`, color: game.accent }}
              title={metric === 'wins' ? 'Deine Siege' : 'Dein Bestwert'}
            >
              {formatNumber(eigen)} {metric === 'wins' ? metricUnit(metric, eigen) : ''}
            </span>
          ) : null}
        </div>
        <p className="text-sm leading-snug text-ink-muted">{game.tagline}</p>

        <div className="flex flex-wrap gap-1">
          {[...modeBadges(game), playerLabel(game)].map((badge) => (
            <span
              key={badge}
              className="rounded-md border border-line bg-fill px-1.5 py-0.5 text-[0.7rem] text-ink-soft"
            >
              {badge}
            </span>
          ))}
        </div>

        {leaderboard === null ? null : entries.length === 0 ? (
          <p className="mt-auto pt-1 text-xs text-ink-faint">Noch niemand in der Bestenliste.</p>
        ) : (
          <ol className="mt-auto flex flex-col gap-0.5 pt-1">
            {entries.map((entry) => (
              <li
                key={entry.userId}
                className={cn(
                  'flex items-center justify-between gap-2 text-xs',
                  entry.isCurrentUser ? 'text-brand' : 'text-ink-muted',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: PODIUM_COLORS[entry.rank - 1] ?? 'transparent' }}
                  />
                  <span className="truncate">
                    {entry.displayName}
                    {entry.isCurrentUser ? ' (du)' : ''}
                  </span>
                </span>
                <span className="shrink-0 font-mono">
                  {formatNumber(entry.bestScore)}
                  {metric === 'wins' ? ` ${metricUnit(metric, entry.bestScore)}` : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </button>
  );
}
