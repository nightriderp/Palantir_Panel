'use client';

import {
  ARCADE_GAME_CATALOG,
  type ArcadeGameId,
  type ArcadeRoomSummaryDto,
} from '@palantir/contracts';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Button,
  Checkbox,
  EmptyState,
  Panel,
  Spinner,
  cn,
  formatRelativeTime,
  useToast,
} from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { createArcadeRoom, listArcadeRooms } from '@/lib/arcade/api';
import { getTurnBoard } from './boards';

/**
 * Offene Räume, Beitreten per Code und – mit Spiel – „Raum erstellen".
 *
 * Auf der Auswahlseite ohne Spiel (alle offenen Räume), im Spielbildschirm mit
 * Spiel (nur dessen Räume plus Erstellen). Geöffnet wird ein Raum immer über
 * seinen Code: Der steht dann in der Adresse (`/arcade?raum=…`), und der Link
 * lässt sich so, wie er ist, an Freunde schicken.
 */

const REFRESH_MS = 20_000;
const CODE_PATTERN = /^[A-Z0-9]{4,8}$/;

export interface RoomBrowserProps {
  gameId: ArcadeGameId | null;
  onOpen(code: string): void;
  className?: string;
}

export function RoomBrowser({ gameId, onOpen, className }: RoomBrowserProps) {
  const rooms = useApiResource<ArcadeRoomSummaryDto[]>(
    (signal) => listArcadeRooms(gameId, signal),
    [gameId],
  );
  const { reload } = rooms;

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  const liste = (rooms.data ?? []).filter(
    (room) => room.status === 'lobby' || room.status === 'running',
  );

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="grid gap-4 md:grid-cols-2">
        <CodeJoin onOpen={onOpen} />
        {gameId ? <CreateRoom gameId={gameId} onCreated={onOpen} /> : null}
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-ink">Offene Räume</h3>
        <Button variant="ghost" size="sm" iconLeft="restart" onClick={reload}>
          Aktualisieren
        </Button>
      </div>

      {rooms.loading && rooms.data === null ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> Räume werden geladen …
        </div>
      ) : rooms.error && rooms.data === null ? (
        <p className="text-sm text-danger">{rooms.error}</p>
      ) : liste.length === 0 ? (
        <EmptyState
          icon="users"
          title="Gerade kein offener Raum"
          description={
            gameId
              ? 'Erstell einen und schick den Link an deine Freunde.'
              : 'Öffne ein Spiel und erstell einen Raum.'
          }
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {liste.map((room) => (
            <RoomRow key={room.id} room={room} onOpen={() => onOpen(room.code)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RoomRow({ room, onOpen }: { room: ArcadeRoomSummaryDto; onOpen(): void }) {
  const game = ARCADE_GAME_CATALOG[room.gameId];
  const belegt = room.seats.filter((seat) => seat.kind !== 'open').length;
  const frei = room.seats.length - belegt;
  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-line bg-fill p-2.5 transition hover:border-line-strong"
      style={{ borderLeft: `4px solid ${game.accent}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- statische SVG-Kachel, kein Bildoptimierer nötig */}
      <img
        src={`/arcade/art/${room.gameId}.svg`}
        alt=""
        className="h-12 w-[4.8rem] shrink-0 rounded-lg object-cover"
        loading="lazy"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{game.name}</div>
        <div className="truncate text-xs text-ink-muted">
          {room.hostDisplayName} · {belegt}/{room.seats.length} Plätze
          {room.status === 'running' ? ' · läuft' : ''} · {formatRelativeTime(room.updatedAt)}
        </div>
        <div className="mt-1 flex gap-1" aria-hidden>
          {room.seats.map((seat) => (
            <span
              key={seat.index}
              className={cn('h-1.5 w-4 rounded-full', seat.kind === 'open' ? 'bg-line-strong' : '')}
              style={seat.kind === 'open' ? undefined : { background: game.accent }}
            />
          ))}
        </div>
      </div>
      <Button
        size="sm"
        variant={room.status === 'lobby' && frei > 0 ? 'primary' : 'secondary'}
        onClick={onOpen}
      >
        {room.status === 'lobby' && frei > 0 ? 'Beitreten' : 'Ansehen'}
      </Button>
    </li>
  );
}

function CodeJoin({ onOpen }: { onOpen(code: string): void }) {
  const [code, setCode] = useState('');
  const gueltig = CODE_PATTERN.test(code);
  const absenden = (event: FormEvent) => {
    event.preventDefault();
    if (gueltig) onOpen(code);
  };
  return (
    <Panel variant="outline" className="flex flex-col gap-2">
      <span className="text-sm font-semibold text-ink">Mit Code beitreten</span>
      <form className="flex gap-2" onSubmit={absenden}>
        <input
          className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-fill px-3 font-mono text-lg uppercase tracking-[0.3em] text-ink placeholder:tracking-normal placeholder:text-ink-faint"
          value={code}
          onChange={(event) =>
            setCode(
              event.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 8),
            )
          }
          placeholder="z. B. K7QX2M"
          aria-label="Raumcode"
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="primary" disabled={!gueltig}>
          Los
        </Button>
      </form>
    </Panel>
  );
}

function CreateRoom({
  gameId,
  onCreated,
}: {
  gameId: ArcadeGameId;
  onCreated(code: string): void;
}) {
  const board = getTurnBoard(gameId);
  const toast = useToast();
  const min = Math.max(2, board?.rules.minPlayers ?? 2);
  const max = Math.max(min, board?.rules.maxPlayers ?? min);
  const [seatCount, setSeatCount] = useState(Math.min(max, Math.max(min, 2)));
  const [isPrivate, setPrivate] = useState(false);
  const [options, setOptions] = useState<unknown>(() => board?.rules.defaultOptions);
  const [busy, setBusy] = useState(false);
  if (!board) return null;
  const OptionsForm = board.OptionsForm;

  const erstellen = async () => {
    const parsed: unknown = board.rules.parseOptions(options);
    if (parsed === null) {
      toast.error('Diese Einstellungen passen nicht zum Spiel.');
      return;
    }
    setBusy(true);
    const result = await createArcadeRoom({ gameId, seatCount, isPrivate, options: parsed });
    setBusy(false);
    if (!result.success) {
      toast.error(errorText(result));
      return;
    }
    onCreated(result.data.code);
  };

  return (
    <Panel variant="outline" className="flex flex-col gap-3">
      <span className="text-sm font-semibold text-ink">Raum erstellen</span>
      {max > min ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm text-ink-muted">Plätze</span>
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={n === seatCount}
              onClick={() => setSeatCount(n)}
              className={cn(
                'h-8 min-w-8 rounded-lg border px-2 font-mono text-sm',
                n === seatCount
                  ? 'border-brand-line bg-brand-soft text-brand'
                  : 'border-line bg-fill text-ink-muted hover:text-ink',
              )}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
      {/* `Checkbox` ist für Tabellen gebaut und zeigt keinen Text – hier braucht es ihn. */}
      <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-muted">
        <Checkbox
          checked={isPrivate}
          onChange={setPrivate}
          label="Privat – nur mit Code oder Link"
        />
        Privat – nur mit Code oder Link
      </label>
      {OptionsForm ? (
        <OptionsForm value={options} onChange={setOptions} seatCount={seatCount} />
      ) : null}
      <div>
        <Button variant="primary" iconLeft="plus" loading={busy} onClick={() => void erstellen()}>
          Raum erstellen
        </Button>
      </div>
    </Panel>
  );
}
