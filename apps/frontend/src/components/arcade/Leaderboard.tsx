'use client';

import { type ArcadeLeaderboardDto } from '@palantir/contracts';
import {
  Button,
  EmptyState,
  Panel,
  UserLabel,
  formatDateTime,
  formatNumber,
} from '@/components/shared';
import { avatarUrl } from '@/lib/auth/api';

/**
 * Bestenliste eines Minispiels (Arbeitspaket F8, Lastenheft §3.9 „nutzerbezogen").
 *
 * Rein darstellend: die Daten kommen aus dem Backend, das die einzige Instanz
 * ist, die Punktestände speichert. Das eigene Konto wird hervorgehoben; die
 * eigene Statistik steht darunter, auch wenn sie außerhalb der Spitzenplätze
 * liegt.
 */

export interface LeaderboardProps {
  data: ArcadeLeaderboardDto | null;
  loading: boolean;
  error: string | null;
  onReload(): void;
}

export function Leaderboard({ data, loading, error, onReload }: LeaderboardProps) {
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

  const entries = data?.entries ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-md font-semibold text-ink">Bestenliste</h2>
        <Button variant="ghost" size="sm" onClick={onReload}>
          Aktualisieren
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon="smile"
          title="Noch keine Ergebnisse"
          description="Spiele eine Runde – dein Ergebnis eröffnet die Bestenliste."
        />
      ) : (
        <ol className="flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li
              key={entry.userId}
              className={`flex items-center gap-3 rounded-tile border px-3 py-2 ${
                entry.isCurrentUser ? 'border-brand-line bg-brand-soft' : 'border-line bg-fill'
              }`}
            >
              <span className="w-6 shrink-0 text-center font-mono text-sm text-ink-soft">
                {entry.rank}
              </span>
              {/*
                Bild, Name und Titel als ein Baustein (Betreiber-Wunsch
                21.09.2026) – dieselbe Darstellung wie im Chat und an den
                Server-Kacheln. Ohne den gemeinsamen Baustein sähe dieselbe
                Person an drei Stellen verschieden aus.
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
                title={`Erreicht am ${formatDateTime(entry.achievedAt)}`}
              >
                {formatNumber(entry.bestScore)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {data?.personal ? (
        <Panel variant="outline" className="flex items-center justify-between">
          <div>
            <div className="text-sm text-ink-soft">Dein Bestwert</div>
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
              {data.personal.gamesPlayed === 1 ? 'Versuch' : 'Versuche'}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
