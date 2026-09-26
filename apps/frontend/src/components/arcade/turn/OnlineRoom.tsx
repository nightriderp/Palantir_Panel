'use client';

import {
  ARCADE_BOT_LEVELS,
  ARCADE_BOT_LEVEL_LABELS,
  ARCADE_GAME_CATALOG,
  ARCADE_ROOM_CHAT_MAX_LENGTH,
  type ArcadeBotLevel,
  type ArcadeRoomDto,
} from '@palantir/contracts';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  Panel,
  Spinner,
  cn,
  formatChatTime,
  useToast,
} from '@/components/shared';
import { type ApiResult, errorText, isTransportFailure } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import {
  closeArcadeRoom,
  fetchArcadeRoomByCode,
  joinArcadeRoom,
  leaveArcadeRoom,
  rematchArcadeRoom,
  sendArcadeRoomChat,
  sendArcadeRoomMove,
  setArcadeRoomSeat,
  startArcadeRoom,
} from '@/lib/arcade/api';
import { useArcadeAudio } from '@/lib/arcade/audio/ArcadeAudioProvider';
import { useArcadeLive } from '@/lib/arcade/live';
import { avatarUrl } from '@/lib/auth/api';
import { AudioControls } from '../AudioControls';
import { getTurnBoard } from './boards';
import { BoardFrame, MatchLog, OutcomeSummary, SeatList, type SeatRowExtra } from './parts';
import { seatColor } from './seatColors';
import { type TurnSeatInfo } from './types';

/**
 * Online-Raum eines rundenbasierten Spiels.
 *
 * Der Server ist Schiedsrichter: Der Browser schlägt Züge vor und bekommt den
 * neuen Stand zurück – mit der Sicht **seines** Sitzes. Über den Live-Kanal
 * kommt nur „Raum hat sich geändert", dann wird neu geladen. Weil ein
 * Live-Kanal hinter einem Proxy einschlafen kann, fragt die Ansicht zusätzlich
 * alle 15 s nach.
 */

const POLL_MS = 15_000;

export interface OnlineRoomProps {
  code: string;
  onExit(): void;
}

function seatInfos(room: ArcadeRoomDto): TurnSeatInfo[] {
  return room.seats.map((seat) => ({
    index: seat.index,
    name:
      seat.kind === 'open'
        ? 'Freier Platz'
        : seat.kind === 'bot'
          ? `Computer (${seat.botLevel ? ARCADE_BOT_LEVEL_LABELS[seat.botLevel] : '?'})`
          : (seat.displayName ?? 'Mitspieler'),
    kind: seat.kind,
    color: seatColor(seat.index),
    isMe: seat.isCurrentUser,
  }));
}

export function OnlineRoom({ code, onExit }: OnlineRoomProps) {
  const toast = useToast();
  const { sfx, playMusic } = useArcadeAudio();
  const resource = useApiResource<ArcadeRoomDto>(
    (signal) => fetchArcadeRoomByCode(code, signal),
    [code],
  );
  const room = resource.data;
  const { reload, setData } = resource;
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [chat, setChat] = useState('');
  const [schliessenFragen, setSchliessenFragen] = useState(false);

  const versionRef = useRef<{ id: string | null; version: number }>({ id: null, version: -1 });
  useEffect(() => {
    versionRef.current = { id: room?.id ?? null, version: room?.version ?? -1 };
  });

  useArcadeLive((event) => {
    const aktuell = versionRef.current;
    if (event.roomId === aktuell.id && event.version > aktuell.version) reload();
  });

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  // Musik des Spiels, sobald klar ist, welches Spiel im Raum läuft.
  const raumSpiel = room?.gameId ?? null;
  useEffect(() => {
    if (!raumSpiel) return;
    playMusic(raumSpiel);
    return () => playMusic(null);
  }, [raumSpiel, playMusic]);

  // Klänge: eigener Zug, Sieg/Niederlage.
  const meinZug =
    room !== null &&
    room.mySeat !== null &&
    room.status === 'running' &&
    room.activeSeats.includes(room.mySeat);
  useEffect(() => {
    if (meinZug) sfx('turn');
  }, [meinZug, sfx]);
  const ende =
    room?.status === 'finished'
      ? room.outcome?.winners.includes(room.mySeat ?? -1)
        ? 'win'
        : room.mySeat !== null
          ? 'lose'
          : null
      : null;
  useEffect(() => {
    if (ende) sfx(ende);
  }, [ende, sfx]);

  /** Aktion ausführen und den gelieferten Raum übernehmen. */
  async function aktion(run: () => Promise<ApiResult<ArcadeRoomDto | null>>, erfolg?: string) {
    setBusy(true);
    const result = await run();
    setBusy(false);
    if (!result.success) {
      toast.error(errorText(result));
      if (result.error.code === 'ARCADE_ROOM_VERSION_CONFLICT') reload();
      return false;
    }
    if (result.data) setData(result.data);
    else reload();
    if (erfolg) toast.success(erfolg);
    return true;
  }

  if (resource.error && !room) {
    return (
      <EmptyState
        icon="warning"
        title="Raum nicht gefunden"
        description={resource.error}
        action={
          <Button variant="secondary" iconLeft="arrowLeft" onClick={onExit}>
            Zur Spielhalle
          </Button>
        }
      />
    );
  }

  if (!room) {
    return (
      <div className="flex items-center gap-2 p-6 text-ink-muted">
        <Spinner /> Raum {code} wird geladen …
      </div>
    );
  }

  const game = ARCADE_GAME_CATALOG[room.gameId];
  const board = getTurnBoard(room.gameId);
  const seats = seatInfos(room);
  const p = room.permissions;

  const onMove = async (move: unknown) => {
    if (sending || !p.canMove) return;
    setSending(true);
    const result = await sendArcadeRoomMove(room.id, { version: room.version, move });
    setSending(false);
    if (result.success) {
      setData(result.data);
      return;
    }
    sfx('error');
    if (result.error.code === 'ARCADE_ROOM_VERSION_CONFLICT') {
      toast.warning(errorText(result));
      reload();
    } else if (result.error.code === 'ARCADE_MOVE_INVALID' && !isTransportFailure(result)) {
      // Hier nennt das Backend den Grund aus den Regeln („Dieses Feld ist belegt.").
      toast.warning(result.error.message || errorText(result));
    } else {
      toast.error(errorText(result));
    }
  };

  const chatSenden = async (event: FormEvent) => {
    event.preventDefault();
    const text = chat.trim();
    if (!text) return;
    const ok = await aktion(() => sendArcadeRoomChat(room.id, text));
    if (ok) setChat('');
  };

  const linkKopieren = async () => {
    const link = `${window.location.origin}/arcade?raum=${encodeURIComponent(room.code)}`;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link kopiert.');
    } catch {
      toast.show(link, { durationMs: 10_000 });
    }
  };

  const extras: Record<number, SeatRowExtra> = {};
  for (const seat of room.seats) {
    const extra: SeatRowExtra = {};
    if (seat.kind === 'human') {
      extra.avatarSrc = seat.userId ? avatarUrl(seat.userId, seat.avatarUpdatedAt) : null;
      extra.online = seat.online;
    }
    if (room.status === 'lobby') {
      const knoepfe: ReactNode[] = [];
      if (seat.kind === 'open' && p.canJoin && room.mySeat === null) {
        knoepfe.push(
          <Button
            key="join"
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => void aktion(() => joinArcadeRoom(room.id, { seat: seat.index }))}
          >
            Hinsetzen
          </Button>,
        );
      }
      if (p.canManageSeats && !seat.isCurrentUser) {
        knoepfe.push(
          <select
            key="manage"
            aria-label={`Sitz ${seat.index + 1} belegen`}
            className="h-8 rounded-lg border border-line-strong bg-fill px-1.5 text-xs text-ink"
            disabled={busy}
            value={
              seat.kind === 'bot'
                ? `bot:${seat.botLevel ?? 'mittel'}`
                : seat.kind === 'open'
                  ? 'open'
                  : 'human'
            }
            onChange={(event) => {
              const value = event.target.value;
              if (value === 'human') return;
              void aktion(() =>
                setArcadeRoomSeat(
                  room.id,
                  value === 'open'
                    ? { seat: seat.index, kind: 'open' }
                    : { seat: seat.index, kind: 'bot', botLevel: value.slice(4) as ArcadeBotLevel },
                ),
              );
            }}
          >
            {seat.kind === 'human' ? (
              <option value="human">{seat.displayName ?? 'Mitspieler'}</option>
            ) : null}
            <option value="open">{seat.kind === 'human' ? 'Entfernen' : 'Offen'}</option>
            {board?.rules.bot
              ? ARCADE_BOT_LEVELS.map((level) => (
                  <option key={level} value={`bot:${level}`}>
                    Computer ({ARCADE_BOT_LEVEL_LABELS[level]})
                  </option>
                ))
              : null}
          </select>,
        );
      }
      if (knoepfe.length > 0)
        extra.actions = <span className="flex shrink-0 gap-1">{knoepfe}</span>;
    }
    extras[seat.index] = extra;
  }

  const Board = board?.Board;
  const kopf = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="rounded-xl border border-line-strong bg-fill px-3 py-1.5 text-center">
          <div className="text-[0.65rem] uppercase tracking-widest text-ink-faint">Raumcode</div>
          <div
            className="font-mono text-2xl font-bold tracking-[0.2em]"
            style={{ color: game.accent }}
          >
            {room.code}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-lg font-bold leading-tight text-ink">{game.name}</span>
          <span className="text-sm text-ink-muted">Gastgeber: {room.hostDisplayName}</span>
          <span className="flex flex-wrap gap-1.5">
            <Badge
              tone={
                room.status === 'running'
                  ? 'success'
                  : room.status === 'lobby'
                    ? 'brand'
                    : 'neutral'
              }
              withDot
            >
              {room.status === 'lobby'
                ? 'Wartet auf Mitspieler'
                : room.status === 'running'
                  ? 'Läuft'
                  : room.status === 'finished'
                    ? 'Beendet'
                    : 'Geschlossen'}
            </Badge>
            {room.isPrivate ? <Badge tone="warning">Privat</Badge> : null}
            {room.mySeat === null ? <Badge tone="neutral">Du schaust zu</Badge> : null}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <AudioControls />
        <Button variant="secondary" size="sm" iconLeft="copy" onClick={() => void linkKopieren()}>
          Link kopieren
        </Button>
        {p.canClose ? (
          <Button
            variant="danger"
            size="sm"
            iconLeft="close"
            onClick={() => setSchliessenFragen(true)}
          >
            Raum schließen
          </Button>
        ) : null}
      </div>
    </div>
  );

  const chatBereich = (
    <Panel className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">Chat</h3>
      <ol className="flex max-h-56 flex-col gap-1 overflow-y-auto text-sm" aria-label="Chat">
        {room.chat.length === 0 ? (
          <li className="text-ink-faint">Noch keine Nachrichten.</li>
        ) : null}
        {room.chat.map((message) => (
          <li key={message.id} className="leading-snug">
            <span className="font-semibold text-ink">{message.displayName}</span>{' '}
            <span className="text-xs text-ink-faint">{formatChatTime(message.sentAt)}</span>
            <div className="break-words text-ink-muted">{message.text}</div>
          </li>
        ))}
      </ol>
      {p.canChat ? (
        <form className="flex gap-2" onSubmit={(event) => void chatSenden(event)}>
          <input
            className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-fill px-2.5 text-sm text-ink placeholder:text-ink-faint"
            value={chat}
            maxLength={ARCADE_ROOM_CHAT_MAX_LENGTH}
            placeholder="Nachricht …"
            aria-label="Nachricht"
            onChange={(event) => setChat(event.target.value)}
          />
          <Button type="submit" size="sm" iconLeft="send" disabled={busy || chat.trim() === ''}>
            Senden
          </Button>
        </form>
      ) : null}
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      {kopf}

      {room.status === 'closed' ? (
        <EmptyState
          icon="lock"
          title="Dieser Raum ist geschlossen"
          action={
            <Button variant="secondary" iconLeft="arrowLeft" onClick={onExit}>
              Zur Spielhalle
            </Button>
          }
        />
      ) : room.status === 'lobby' ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <Panel className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-ink">Sitze</h3>
            <SeatList seats={seats} activeSeats={[]} extras={extras} />
            <p className="text-sm text-ink-muted">
              {room.isPrivate
                ? 'Privater Raum: Er steht nicht in der Liste – teile Code oder Link.'
                : 'Offener Raum: Er steht in der Lobby, jeder Angemeldete kann sich dazusetzen.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {p.canStart ? (
                <Button
                  variant="primary"
                  iconLeft="play"
                  loading={busy}
                  onClick={() => void aktion(() => startArcadeRoom(room.id))}
                >
                  Partie starten
                </Button>
              ) : p.canManageSeats ? (
                <span className="text-sm text-ink-muted">
                  Belege jeden freien Platz mit Mitspielern oder dem Computer, dann geht es los.
                </span>
              ) : room.mySeat !== null ? (
                <span className="text-sm text-ink-muted">Warte, bis der Gastgeber startet …</span>
              ) : null}
              {p.canJoin && room.mySeat === null ? (
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void aktion(() => joinArcadeRoom(room.id))}
                >
                  Beitreten
                </Button>
              ) : null}
              {p.canLeave ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void aktion(() => leaveArcadeRoom(room.id))}
                >
                  Platz verlassen
                </Button>
              ) : null}
            </div>
          </Panel>
          {chatBereich}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-3">
            {room.status === 'finished' && room.outcome ? (
              <Panel variant="outline" className="flex flex-col gap-3 motion-safe:animate-fade-up">
                <OutcomeSummary
                  winners={room.outcome.winners}
                  summary={room.outcome.summary}
                  scores={room.outcome.scores}
                  seats={seats}
                />
                <div className="flex flex-wrap gap-2">
                  {p.canRematch ? (
                    <Button
                      variant="primary"
                      iconLeft="restart"
                      loading={busy}
                      onClick={() => void aktion(() => rematchArcadeRoom(room.id))}
                    >
                      Revanche
                    </Button>
                  ) : (
                    <span className="text-sm text-ink-muted">
                      Der Gastgeber kann eine Revanche starten.
                    </span>
                  )}
                </div>
              </Panel>
            ) : null}
            <div
              className={cn(
                'flex items-center gap-2 text-sm',
                meinZug ? 'font-semibold' : 'text-ink-muted',
              )}
              style={meinZug ? { color: game.accent } : undefined}
            >
              {sending ? <Spinner /> : meinZug ? <Icon name="play" size={14} /> : null}
              {room.status === 'finished'
                ? 'Partie beendet'
                : meinZug
                  ? 'Du bist am Zug'
                  : `Am Zug: ${room.activeSeats.map((i) => seats[i]?.name ?? '').join(', ')}`}
            </div>
            {Board ? (
              <BoardFrame accent={game.accent}>
                <Board
                  view={room.view}
                  mySeat={room.mySeat}
                  seats={seats}
                  activeSeats={room.activeSeats}
                  canAct={p.canMove && !sending && room.status === 'running'}
                  onMove={(move: unknown) => void onMove(move)}
                  sfx={sfx}
                  finished={room.status !== 'running'}
                />
              </BoardFrame>
            ) : (
              <EmptyState icon="warning" title="Dieses Spiel kennt die Oberfläche noch nicht" />
            )}
          </div>
          <aside className="flex flex-col gap-4">
            <Panel className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">Am Tisch</h3>
              <SeatList
                seats={seats}
                activeSeats={room.status === 'running' ? room.activeSeats : []}
                extras={extras}
                winners={room.outcome?.winners ?? []}
                scores={room.outcome?.scores}
              />
            </Panel>
            <Panel className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-ink">Spielverlauf</h3>
              <MatchLog entries={room.log} seats={seats} />
            </Panel>
            {chatBereich}
          </aside>
        </div>
      )}

      <div>
        <Button variant="ghost" iconLeft="arrowLeft" onClick={onExit}>
          Zur Spielhalle
        </Button>
      </div>

      <ConfirmDialog
        open={schliessenFragen}
        onClose={() => setSchliessenFragen(false)}
        title="Raum schließen?"
        message="Die Partie endet für alle, der Code verfällt."
        confirmLabel="Schließen"
        busy={busy}
        onConfirm={() =>
          void aktion(() => closeArcadeRoom(room.id), 'Raum geschlossen.').then((ok) => {
            if (ok) setSchliessenFragen(false);
          })
        }
      />
    </div>
  );
}
