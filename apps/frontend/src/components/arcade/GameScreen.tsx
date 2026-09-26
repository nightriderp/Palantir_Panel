'use client';

import {
  ARCADE_GAME_CATALOG,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
} from '@palantir/contracts';
import { useEffect, useState } from 'react';
import { Button, EmptyState, Panel, cn } from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { useApiResource } from '@/lib/api/useApiResource';
import { fetchArcadeLeaderboard } from '@/lib/arcade/api';
import { useArcadeAudio } from '@/lib/arcade/audio/ArcadeAudioProvider';
import { AudioControls } from './AudioControls';
import { modeBadges, playerLabel } from './GameCard';
import { Leaderboard } from './Leaderboard';
import { RealtimeHost } from './realtime/RealtimeHost';
import { getRealtimeRenderer } from './realtime/renderers';
import { getTurnBoard } from './turn/boards';
import { LocalTurnHost } from './turn/LocalTurnHost';
import { RoomBrowser } from './turn/RoomBrowser';
import { TurnSetup, type LocalMatchConfig } from './turn/TurnSetup';

/**
 * Bildschirm eines Spiels: Kopf, Spielfläche, Anleitung, Bestenliste.
 *
 * Echtzeit-Spiele starten direkt (`RealtimeHost`); rundenbasierte zeigen erst
 * die Einstellungen, dann die Partie am Gerät oder die Online-Räume. Die Musik
 * des Spiels läuft, solange der Bildschirm offen ist – auf der Auswahlseite
 * bleibt es still.
 */

export interface GameScreenProps {
  gameId: ArcadeGameId;
  onBack(): void;
  /** Online-Raum öffnen (über seinen Code, landet in der Adresse). */
  onOpenRoom(code: string): void;
}

type TurnStage =
  | { kind: 'setup' }
  | { kind: 'local'; config: LocalMatchConfig; round: number }
  | { kind: 'online' };

/**
 * Anleitung wie geschrieben: Die Bretter liefern Absätze und „•"-Listen mit
 * Zeilenumbrüchen – `whitespace-pre-line` erhält beides, ohne dass hier
 * jemand den Text zerlegen und dabei den Einleitungssatz verlieren muss.
 */
function Anleitung({ text }: { text: string }) {
  return <p className="whitespace-pre-line text-sm leading-relaxed text-ink-muted">{text}</p>;
}

export function GameScreen({ gameId, onBack, onOpenRoom }: GameScreenProps) {
  const game = ARCADE_GAME_CATALOG[gameId];
  const { user } = useSession();
  const { playMusic } = useArcadeAudio();
  const renderer = game.engine === 'realtime' ? getRealtimeRenderer(gameId) : null;
  const board = game.engine === 'turn' ? getTurnBoard(gameId) : null;
  const [stage, setStage] = useState<TurnStage>({ kind: 'setup' });
  const [lastConfig, setLastConfig] = useState<LocalMatchConfig | null>(null);

  const leaderboard = useApiResource<ArcadeLeaderboardDto>(
    (signal) => fetchArcadeLeaderboard(gameId, signal),
    [gameId],
  );
  /*
   * Nur `reload` weiterreichen, nicht die ganze Ressource (Audit-Fundstelle
   * frontend-lib-03): Die Ressource wechselt mit jedem geladenen Stand die
   * Identität, und eine nachladende Bestenliste darf keine laufende Partie
   * neu anlegen.
   */
  const { reload: reloadLeaderboard } = leaderboard;

  useEffect(() => {
    playMusic(gameId);
    return () => playMusic(null);
  }, [gameId, playMusic]);

  const anleitung = renderer?.instructions || board?.rulesText || game.description;
  const myName = user?.displayName ?? 'Du';

  let inhalt;
  if (game.engine === 'realtime') {
    inhalt = renderer ? (
      <RealtimeHost renderer={renderer} onSubmitted={reloadLeaderboard} />
    ) : (
      <EmptyState icon="warning" title="Dieses Spiel ist noch nicht spielbar" />
    );
  } else if (!board) {
    inhalt = <EmptyState icon="warning" title="Dieses Spiel ist noch nicht spielbar" />;
  } else if (stage.kind === 'local') {
    inhalt = (
      <LocalTurnHost
        key={stage.round}
        game={game}
        board={board}
        config={stage.config}
        onSubmitted={reloadLeaderboard}
        onAgain={() => setStage({ kind: 'local', config: stage.config, round: stage.round + 1 })}
        onExit={() => setStage({ kind: 'setup' })}
      />
    );
  } else if (stage.kind === 'online') {
    inhalt = (
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            iconLeft="arrowLeft"
            onClick={() => setStage({ kind: 'setup' })}
          >
            Andere Spielweise
          </Button>
        </div>
        <RoomBrowser gameId={gameId} onOpen={onOpenRoom} />
      </div>
    );
  } else {
    inhalt = (
      <TurnSetup
        game={game}
        board={board}
        myName={myName}
        initial={lastConfig}
        onOnline={() => setStage({ kind: 'online' })}
        onStartLocal={(config) => {
          setLastConfig(config);
          setStage({ kind: 'local', config, round: 0 });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-5">
      <header
        className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl border border-line-strong p-3"
        style={{ background: `linear-gradient(120deg, ${game.accent}26, transparent 60%)` }}
      >
        <Button variant="secondary" size="sm" iconLeft="arrowLeft" onClick={onBack}>
          Spielhalle
        </Button>
        {/* eslint-disable-next-line @next/next/no-img-element -- statische SVG-Kachel */}
        <img
          src={`/arcade/art/${gameId}.svg`}
          alt=""
          className="hidden h-12 rounded-lg border border-line object-cover sm:block"
          style={{ aspectRatio: '16 / 10' }}
        />
        {/* Auf dem Handy eine eigene Zeile, sonst bleibt vom Namen nur „T…". */}
        <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
          <h1 className="truncate text-xl font-bold text-ink sm:text-2xl">{game.name}</h1>
          <p className="truncate text-sm text-ink-muted">{game.tagline}</p>
        </div>
        <div className="ml-auto sm:ml-0">
          <AudioControls />
        </div>
      </header>

      {/*
       * Rundenbasierte Spiele bringen schon eine eigene Seitenleiste mit (Tisch,
       * Verlauf). Stünde die Bestenliste bereits ab `xl` als dritte Spalte daneben,
       * bliebe fürs Brett auf einem Laptop kaum ein Drittel der Breite – bei
       * Catan oder Monopoly zu wenig. Sie rückt deshalb erst ab `2xl` nach rechts.
       */}
      <div
        className={cn(
          'grid gap-4',
          game.engine === 'turn'
            ? '2xl:grid-cols-[minmax(0,1fr)_320px]'
            : 'xl:grid-cols-[minmax(0,1fr)_320px]',
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">{inhalt}</div>

        <aside
          className={cn(
            'flex flex-col gap-4',
            game.engine === 'turn'
              ? '2xl:sticky 2xl:top-4 2xl:self-start'
              : 'xl:sticky xl:top-4 xl:self-start',
          )}
        >
          <Panel variant="outline" padding="none">
            <details className="group" open={game.engine === 'turn' && stage.kind === 'setup'}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3.5 text-base font-semibold text-ink">
                So wird gespielt
                <span
                  aria-hidden
                  className="text-ink-faint transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="flex flex-col gap-2 px-3.5 pb-3.5">
                <Anleitung text={anleitung} />
                <div className="flex flex-wrap gap-1 pt-1">
                  {[...modeBadges(game), playerLabel(game), game.duration].map((badge) => (
                    <span
                      key={badge}
                      className="rounded-md border border-line bg-fill px-1.5 py-0.5 text-xs text-ink-soft"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              </div>
            </details>
          </Panel>
          <Panel>
            <Leaderboard
              gameId={gameId}
              data={leaderboard.data}
              loading={leaderboard.loading}
              error={leaderboard.error}
              onReload={reloadLeaderboard}
            />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
