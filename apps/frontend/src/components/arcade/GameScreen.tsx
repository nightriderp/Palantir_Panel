'use client';

import {
  ARCADE_GAME_CATALOG,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
} from '@palantir/contracts';
import { useCallback, useState } from 'react';
import { Button, Panel, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { fetchArcadeLeaderboard, submitArcadeScore } from '@/lib/arcade/api';
import { useApiResource } from '@/lib/api/useApiResource';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { GameHost } from './engine/GameHost';
import { getArcadeGame } from './games/index';
import { Leaderboard } from './Leaderboard';

/**
 * Bildschirm eines einzelnen Minispiels (Arbeitspaket F8).
 *
 * Vereint das Spielfeld (über {@link GameHost}) mit der nutzerbezogenen
 * Bestenliste. Nach jeder Partie schickt der Bildschirm den Endpunktestand an
 * die API – das Backend ist die Instanz, die den Score speichert (Lastenheft
 * §3.9). Ohne Sitzung (`canSubmit === false`) wird nur gespielt, nicht
 * abgeschickt.
 */

export interface GameScreenProps {
  gameId: ArcadeGameId;
  onBack(): void;
}

export function GameScreen({ gameId, onBack }: GameScreenProps) {
  const definition = ARCADE_GAME_CATALOG[gameId];
  const game = getArcadeGame(gameId);
  const toast = useToast();
  const { user } = useSession();

  const leaderboard = useApiResource<ArcadeLeaderboardDto>(
    (signal) => fetchArcadeLeaderboard(gameId, signal),
    [gameId],
  );

  const [submitting, setSubmitting] = useState(false);

  const canSubmit = leaderboard.data?.permissions.canSubmit ?? user !== null;

  const handleGameOver = useCallback(
    async (score: number) => {
      if (!canSubmit) {
        toast.warning(
          'Nicht angemeldet – dein Ergebnis wird nicht in die Bestenliste eingetragen.',
        );
        return;
      }

      setSubmitting(true);
      const result = await submitArcadeScore(gameId, score);
      setSubmitting(false);

      if (!result.success) {
        toast.error(errorText(result));
        return;
      }

      if (result.data.isNewPersonalBest) {
        toast.success(`Neuer Bestwert: ${result.data.personal.bestScore} Punkte!`);
      } else {
        toast.show(`Ergebnis gespeichert: ${score} Punkte.`);
      }
      leaderboard.reload();
    },
    [canSubmit, gameId, leaderboard, toast],
  );

  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex items-start gap-3">
        <Button variant="secondary" size="sm" iconLeft="arrowLeft" onClick={onBack}>
          Zurück
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-ink">{definition.name}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">{definition.tagline}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-3">
          <GameHost game={game} onGameOver={handleGameOver} />
          <Panel variant="outline" className="text-sm text-ink-muted">
            {game.instructions}
            {submitting ? (
              <span className="mt-1 block text-brand-bright">Ergebnis wird gespeichert …</span>
            ) : null}
            {!canSubmit ? (
              <span className="mt-1 block text-warning">
                Du bist nicht angemeldet – Ergebnisse werden nicht gespeichert.
              </span>
            ) : null}
          </Panel>
        </div>

        <Panel className="lg:sticky lg:top-4 lg:self-start">
          <Leaderboard
            data={leaderboard.data}
            loading={leaderboard.loading}
            error={leaderboard.error}
            onReload={leaderboard.reload}
          />
        </Panel>
      </div>
    </div>
  );
}
