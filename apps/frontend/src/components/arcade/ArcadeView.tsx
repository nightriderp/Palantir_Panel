'use client';

import { ARCADE_GAMES, type ArcadeGameId, type ArcadeLeaderboardDto } from '@palantir/contracts';
import { useState } from 'react';
import { Icon, PageHeader, Panel } from '@/components/shared';
import { fetchArcadeLeaderboard } from '@/lib/arcade/api';
import { useApiResource } from '@/lib/api/useApiResource';
import { GameCard } from './GameCard';
import { GameScreen } from './GameScreen';

/**
 * Arcade – Auswahl und Spielbildschirm (Arbeitspaket F8, Lastenheft §3.9).
 *
 * Ohne Auswahl zeigt die Ansicht die Kacheln aller Minispiele; ein Antippen
 * öffnet den Spielbildschirm mit Bestenliste. Alle Spiele sind eigenständig
 * entwickelt – keine geschützten Marken oder Assets. Arcade-Musik ist Phase 2
 * und hier bewusst nicht enthalten (Verwaltung als Platzhalter in F11).
 *
 * Die Bestenlisten aller Spiele werden hier **einmal** geladen und an die
 * Kacheln durchgereicht (Mockup: Spitzenplätze schon in der Auswahl). Eine
 * Liste, die nicht lädt, lässt nur ihre Kachel schlichter aussehen – die Seite
 * bleibt bedienbar.
 */

type LeaderboardMap = Partial<Record<ArcadeGameId, ArcadeLeaderboardDto>>;

export function ArcadeView() {
  const [selected, setSelected] = useState<ArcadeGameId | null>(null);

  const boards = useApiResource<LeaderboardMap>(async (signal) => {
    const results = await Promise.all(
      ARCADE_GAMES.map((game) => fetchArcadeLeaderboard(game.id, signal)),
    );

    const map: LeaderboardMap = {};
    for (const [index, result] of results.entries()) {
      const game = ARCADE_GAMES[index];
      if (game && result.success) map[game.id] = result.data;
    }

    return { success: true, data: map, error: null };
  }, []);

  if (selected) {
    return <GameScreen gameId={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <>
      <PageHeader
        title="Arcade"
        subtitle="Kleine Spiele für zwischendurch – mit Bestenliste je Spiel."
      />

      <div className="flex flex-col gap-5 p-5">
        <Panel variant="outline" className="flex items-start gap-3">
          <Icon name="gamepad" size={18} className="mt-0.5 shrink-0 text-brand" />
          <div>
            <div className="text-md font-semibold text-ink">Eigenständige Minispiele</div>
            <p className="mt-1 text-base text-ink-muted">
              Wähle ein Spiel, sammle Punkte und miss dich mit den anderen. Auf dem Smartphone
              steuerst du über die Tasten unter dem Feld, am Rechner über die Pfeiltasten und die
              Leertaste. Dein bestes Ergebnis je Spiel landet in der Bestenliste.
            </p>
          </div>
        </Panel>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ARCADE_GAMES.map((game) => (
            <GameCard
              key={game.id}
              game={game}
              leaderboard={boards.data?.[game.id] ?? null}
              onSelect={() => setSelected(game.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}
