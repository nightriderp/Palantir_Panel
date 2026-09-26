'use client';

import {
  ARCADE_GAME_CATALOG,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
  type ArcadeMetric,
} from '@palantir/contracts';
import {
  Button,
  EmptyState,
  Panel,
  ThemeEmblem,
  UserLabel,
  cn,
  formatDateTime,
  formatNumber,
} from '@/components/shared';
import { avatarUrl } from '@/lib/auth/api';

/**
 * Bestenliste eines Spiels (Lastenheft §3.9 „nutzerbezogen").
 *
 * Rein darstellend: Die Daten kommen aus dem Backend, das die einzige Instanz
 * ist, die Stände speichert – und seit dem Neubau auch die einzige, die sie
 * errechnet. Echtzeit-Spiele zählen den besten Einzelstand, rundenbasierte die
 * Siege (`metric`); die Beschriftung folgt dem.
 */

/** Was die Liste zählt – vom Backend, sonst aus dem Katalog (ältere Backends ohne Feld). */
export function leaderboardMetric(
  gameId: ArcadeGameId,
  data: ArcadeLeaderboardDto | null,
): ArcadeMetric {
  return data?.metric ?? ARCADE_GAME_CATALOG[gameId].metric;
}

export function metricUnit(metric: ArcadeMetric, value: number): string {
  if (metric === 'wins') return value === 1 ? 'Sieg' : 'Siege';
  return value === 1 ? 'Punkt' : 'Punkte';
}

/** Farben der ersten drei Plätze – Gold, Silber, Bronze. */
export const PODIUM_COLORS = ['#fbbf24', '#cbd5e1', '#d97706'] as const;

export interface LeaderboardProps {
  gameId: ArcadeGameId;
  data: ArcadeLeaderboardDto | null;
  loading: boolean;
  error: string | null;
  onReload(): void;
}

export function Leaderboard({ gameId, data, loading, error, onReload }: LeaderboardProps) {
  if (error) {
    return (
      <EmptyState
        icon="warning"
        title="Bestenliste nicht ladbar"
        description={error}
        action={
          <Button variant="secondary" onClick={onReload}>
            Erneut versuchen
          </Button>
        }
      />
    );
  }

  if (loading && data === null) {
    return <p className="text-base text-ink-muted">Bestenliste wird geladen …</p>;
  }

  const metric = leaderboardMetric(gameId, data);
  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {/*
          Das Zeichen des gewählten Themes – eine Bestenliste ist der eine Platz,
          an dem etwas Wappenhaftes nicht deplatziert wirkt.
        */}
        <h2 className="flex items-center gap-2 text-md font-semibold text-ink">
          <ThemeEmblem className="text-brand" />
          Bestenliste
          <span className="text-sm font-normal text-ink-faint">
            · {metric === 'wins' ? 'Siege' : 'Bestwert'}
          </span>
        </h2>
        <Button variant="ghost" size="sm" onClick={onReload}>
          Aktualisieren
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="smile"
          title="Noch keine Ergebnisse"
          description={
            metric === 'wins'
              ? 'Gewinn eine Partie gegen den Computer oder online – dein Sieg eröffnet die Liste.'
              : 'Spiele eine Runde – dein Ergebnis eröffnet die Bestenliste.'
          }
        />
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry) => {
            const podium = entry.rank <= 3 ? PODIUM_COLORS[entry.rank - 1] : undefined;
            return (
              <li
                key={entry.userId}
                className={cn(
                  'flex items-center gap-3 rounded-tile border px-3 py-2',
                  entry.isCurrentUser ? 'border-brand-line bg-brand-soft' : 'border-line bg-fill',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-sm',
                    podium ? 'font-bold text-black' : 'text-ink-soft',
                  )}
                  style={podium ? { background: podium } : undefined}
                >
                  {entry.rank}
                </span>
                {/*
                  Bild, Name und Titel als ein Baustein – dieselbe Darstellung
                  wie im Chat und an den Server-Kacheln.
                */}
                <UserLabel
                  className="flex-1 text-base"
                  avatarSrc={avatarUrl(entry.userId, entry.avatarUpdatedAt)}
                  displayName={entry.displayName}
                  title={entry.title}
                  suffix={entry.isCurrentUser ? '· du' : null}
                />
                <span
                  className="shrink-0 font-mono text-base text-ink"
                  title={`${metric === 'wins' ? 'Letzter Sieg' : 'Erreicht'} am ${formatDateTime(entry.achievedAt)}`}
                >
                  {formatNumber(entry.bestScore)}
                  {metric === 'wins' ? (
                    <span className="ml-1 text-xs text-ink-faint">
                      {metricUnit(metric, entry.bestScore)}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {data?.personal ? (
        <Panel variant="outline" className="flex items-center justify-between">
          <div>
            <div className="text-sm text-ink-soft">
              {metric === 'wins' ? 'Deine Siege' : 'Dein Bestwert'}
            </div>
            <div className="font-mono text-lg text-brand-bright">
              {formatNumber(data.personal.bestScore)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-ink-soft">
              {data.personal.rank !== null ? `Platz ${data.personal.rank}` : 'Ohne Platzierung'}
            </div>
            <div className="text-sm text-ink-muted">
              {formatNumber(data.personal.gamesPlayed)}{' '}
              {metric === 'wins'
                ? data.personal.gamesPlayed === 1
                  ? 'gewertete Partie'
                  : 'gewertete Partien'
                : data.personal.gamesPlayed === 1
                  ? 'Versuch'
                  : 'Versuche'}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
