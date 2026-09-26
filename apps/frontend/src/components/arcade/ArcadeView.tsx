'use client';

import {
  ARCADE_CATEGORIES,
  ARCADE_CATEGORY_LABELS,
  ARCADE_GAMES,
  isArcadeGameId,
  type ArcadeCategory,
  type ArcadeGameId,
  type ArcadeLeaderboardDto,
} from '@palantir/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, Icon, cn } from '@/components/shared';
import { useApiResource } from '@/lib/api/useApiResource';
import { fetchArcadeLeaderboard } from '@/lib/arcade/api';
import { ArcadeAudioProvider } from '@/lib/arcade/audio/ArcadeAudioProvider';
import { GameCard } from './GameCard';
import { GameScreen } from './GameScreen';
import { OnlineRoom } from './turn/OnlineRoom';
import { RoomBrowser } from './turn/RoomBrowser';

/**
 * Die Spielhalle: Auswahl, Spielbildschirm, Online-Raum.
 *
 * Welcher der drei gerade zu sehen ist, steht in der Adresse –
 * `/arcade?spiel=<kennung>` bzw. `/arcade?raum=<CODE>`. So funktioniert der
 * Zurück-Knopf des Browsers wie erwartet, und ein Raum-Link lässt sich einfach
 * weitergeben. `useSearchParams` verlangt dafür eine Suspense-Grenze um die
 * Ansicht (siehe `app/(dashboard)/arcade/page.tsx`).
 *
 * Die Bestenlisten aller Spiele werden auf der Auswahlseite **einmal**
 * gebündelt geladen und an die Kacheln gereicht. Eine Liste, die nicht lädt,
 * lässt nur ihre Kachel schlichter aussehen – die Seite bleibt bedienbar.
 */

type LeaderboardMap = Partial<Record<ArcadeGameId, ArcadeLeaderboardDto>>;
type CategoryFilter = ArcadeCategory | 'alle';

const ROOM_CODE = /^[A-Z0-9]{4,8}$/;

export function ArcadeView() {
  return (
    <ArcadeAudioProvider>
      <ArcadeRouter />
    </ArcadeAudioProvider>
  );
}

function ArcadeRouter() {
  const params = useSearchParams();
  const router = useRouter();
  const spiel = params.get('spiel');
  const raum = params.get('raum')?.toUpperCase() ?? null;

  const zurAuswahl = () => router.push('/arcade');
  const spielOeffnen = (id: ArcadeGameId) => router.push(`/arcade?spiel=${encodeURIComponent(id)}`);
  const raumOeffnen = (code: string) =>
    router.push(`/arcade?raum=${encodeURIComponent(code.toUpperCase())}`);

  if (raum && ROOM_CODE.test(raum)) {
    return (
      <div className="p-3 sm:p-5">
        <OnlineRoom key={raum} code={raum} onExit={zurAuswahl} />
      </div>
    );
  }

  if (spiel && isArcadeGameId(spiel)) {
    return <GameScreen key={spiel} gameId={spiel} onBack={zurAuswahl} onOpenRoom={raumOeffnen} />;
  }

  return <Auswahl onSelect={spielOeffnen} onOpenRoom={raumOeffnen} />;
}

function Auswahl({
  onSelect,
  onOpenRoom,
}: {
  onSelect(id: ArcadeGameId): void;
  onOpenRoom(code: string): void;
}) {
  const [kategorie, setKategorie] = useState<CategoryFilter>('alle');
  const [suche, setSuche] = useState('');

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

  const gefiltert = useMemo(() => {
    const begriff = suche.trim().toLocaleLowerCase('de');
    return ARCADE_GAMES.filter(
      (game) =>
        (kategorie === 'alle' || game.category === kategorie) &&
        (begriff === '' ||
          game.name.toLocaleLowerCase('de').includes(begriff) ||
          game.tagline.toLocaleLowerCase('de').includes(begriff)),
    );
  }, [kategorie, suche]);

  const gruppen = ARCADE_CATEGORIES.map((category) => ({
    category,
    games: gefiltert.filter((game) => game.category === category),
  })).filter((gruppe) => gruppe.games.length > 0);

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-5">
      <header className="relative overflow-hidden rounded-3xl border border-line-strong bg-surface-deep px-5 py-7 sm:px-8 sm:py-10">
        <Glitzer />
        <div className="relative flex flex-col gap-2">
          <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.25em] text-brand">
            <Icon name="gamepad" size={16} /> {ARCADE_GAMES.length} Spiele
          </span>
          <h1 className="bg-brand-gradient bg-clip-text text-4xl font-black tracking-tight text-transparent sm:text-5xl">
            Spielhalle
          </h1>
          <p className="max-w-xl text-base text-ink-muted">
            Arcade-Klassiker auf Punktejagd, Brettspiele gegen den Computer oder mit Freunden – am
            selben Gerät oder online im eigenen Raum.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <Icon
            name="search"
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            value={suche}
            onChange={(event) => setSuche(event.target.value)}
            placeholder="Spiel suchen …"
            aria-label="Spiel suchen"
            className="h-11 w-full rounded-xl border border-line-strong bg-fill pl-9 pr-3 text-base text-ink placeholder:text-ink-faint"
          />
        </div>
        <div
          className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          role="group"
          aria-label="Kategorie"
        >
          {(['alle', ...ARCADE_CATEGORIES] as CategoryFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={kategorie === key}
              onClick={() => setKategorie(key)}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                kategorie === key
                  ? 'border-transparent bg-brand-gradient text-white shadow-glow'
                  : 'border-line-strong bg-fill text-ink-muted hover:text-ink',
              )}
            >
              {key === 'alle' ? 'Alle' : ARCADE_CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {gruppen.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-ink-muted">
          <p>Kein Spiel passt zu „{suche}“.</p>
          <Button variant="ghost" onClick={() => setSuche('')}>
            Suche leeren
          </Button>
        </div>
      ) : (
        gruppen.map((gruppe) => (
          <section
            key={gruppe.category}
            className="flex flex-col gap-3"
            aria-labelledby={`kat-${gruppe.category}`}
          >
            <h2 id={`kat-${gruppe.category}`} className="text-lg font-bold text-ink">
              {ARCADE_CATEGORY_LABELS[gruppe.category]}
            </h2>
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {gruppe.games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  leaderboard={boards.data?.[game.id] ?? null}
                  onSelect={() => onSelect(game.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <section
        className="flex flex-col gap-3 rounded-2xl border border-line-strong bg-card-gradient p-4"
        aria-labelledby="raeume"
      >
        <h2 id="raeume" className="flex items-center gap-2 text-lg font-bold text-ink">
          <Icon name="users" size={18} className="text-brand" /> Online spielen
        </h2>
        <RoomBrowser gameId={null} onOpen={onOpenRoom} />
      </section>
    </div>
  );
}

/** Ein paar leuchtende Punkte im Kopf – Zier, bei reduzierter Bewegung ruhig. */
function Glitzer() {
  const punkte = [
    { left: '8%', top: '20%', size: 6, color: '#f472b6', delay: '0s' },
    { left: '22%', top: '70%', size: 4, color: '#38bdf8', delay: '0.6s' },
    { left: '64%', top: '18%', size: 5, color: '#facc15', delay: '1.1s' },
    { left: '82%', top: '60%', size: 7, color: '#4ade80', delay: '0.3s' },
    { left: '92%', top: '25%', size: 4, color: '#a78bfa', delay: '1.5s' },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div
        className="absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, #a78bfa, transparent 70%)' }}
      />
      <div
        className="absolute -bottom-20 left-10 h-48 w-48 rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, #38bdf8, transparent 70%)' }}
      />
      {punkte.map((punkt) => (
        <span
          key={`${punkt.left}-${punkt.top}`}
          className="absolute rounded-full motion-safe:animate-pulse-dot"
          style={{
            left: punkt.left,
            top: punkt.top,
            width: punkt.size,
            height: punkt.size,
            background: punkt.color,
            boxShadow: `0 0 12px ${punkt.color}`,
            animationDelay: punkt.delay,
          }}
        />
      ))}
    </div>
  );
}
