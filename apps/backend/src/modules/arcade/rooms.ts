/**
 * Online-Räume der Spielhalle – Datenform und reine Regeln (Neubau 26.09.2026).
 *
 * Hier steht alles, was ohne Datenbank und ohne Uhr entscheidbar ist: wer auf
 * welchem Sitz sitzt, was ein Konto im Raum darf (serverseitig berechnete
 * `permissions`, Pflichtenheft §5.2), wie das DTO aus Sicht eines Kontos
 * aussieht und wie ein Beitrittscode entsteht. Der Ablauf (Laden, Sperre,
 * Speichern, Senden) liegt in `rooms-service.ts`.
 */

import {
  ARCADE_BOT_LEVEL_LABELS,
  ARCADE_GAME_CATALOG,
  type ArcadeGameId,
  type ArcadeRoomDto,
  type ArcadeRoomOutcomeDto,
  type ArcadeRoomPermissions,
  type ArcadeRoomSeatDto,
  type ArcadeRoomStatus,
  type ArcadeRoomSummaryDto,
} from '@palantir/contracts';
import {
  type AnyTurnGame,
  type SeatController,
  type TurnLogEntry,
  type TurnMatch,
  type TurnOutcome,
} from '@palantir/arcade';
import { type ArcadeRoomChatRecord, type ArcadeRoomSeatRecord } from '../../db/schema/arcade.js';

export type { ArcadeRoomChatRecord, ArcadeRoomSeatRecord };

/**
 * Die Partie, wie sie im Raum liegt: ein `TurnMatch` der Regeln, dazu
 * optional der Vermerk, dass sie abgebrochen wurde (Mitspieler weg ohne
 * Computer-Ersatz, Fehler im Computergegner). Die Regeln kennen keinen
 * Abbruch – deshalb steht er neben ihrem Zustand und nicht darin.
 */
export type StoredMatch = TurnMatch & { aborted?: { summary: string } };

export interface ArcadeRoom {
  id: string;
  code: string;
  gameId: ArcadeGameId;
  hostUserId: string;
  status: ArcadeRoomStatus;
  isPrivate: boolean;
  seats: ArcadeRoomSeatRecord[];
  options: unknown;
  match: StoredMatch | null;
  version: number;
  chat: ArcadeRoomChatRecord[];
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}

/** Wer den Raum ansieht oder bedient. */
export interface RoomViewer {
  userId: string;
  displayName: string;
  /** Darf jeden Raum schließen (`gametype.manage`). */
  isAdmin: boolean;
}

export interface RoomProfile {
  displayName: string;
  avatarUpdatedAt: Date | null;
}

/** Zeichen der Beitrittscodes: ohne 0/O und 1/I, die man verwechselt. */
export const ARCADE_ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ARCADE_ROOM_CODE_LENGTH = 6;

/** Neuer Beitrittscode; `randomBelow(n)` liefert eine Ganzzahl in [0, n). */
export function generateRoomCode(randomBelow: (max: number) => number): string {
  let code = '';

  for (let i = 0; i < ARCADE_ROOM_CODE_LENGTH; i += 1) {
    code += ARCADE_ROOM_CODE_ALPHABET[randomBelow(ARCADE_ROOM_CODE_ALPHABET.length)];
  }

  return code;
}

export function openSeat(): ArcadeRoomSeatRecord {
  return { kind: 'open', userId: null, botLevel: null };
}

/** Sitz eines Kontos; `null`, wenn es nicht mitspielt. */
export function seatOf(room: Pick<ArcadeRoom, 'seats'>, userId: string): number | null {
  const index = room.seats.findIndex((seat) => seat.kind === 'human' && seat.userId === userId);

  return index >= 0 ? index : null;
}

/** Alle Menschen, die Live-Meldungen zum Raum bekommen: Gastgeber und Sitze. */
export function memberIds(room: Pick<ArcadeRoom, 'seats' | 'hostUserId'>): string[] {
  const ids = new Set<string>([room.hostUserId]);

  for (const seat of room.seats) {
    if (seat.kind === 'human' && seat.userId !== null) ids.add(seat.userId);
  }

  return [...ids];
}

/** Menschliche Sitze in Reihenfolge. */
export function humanSeats(room: Pick<ArcadeRoom, 'seats'>): number[] {
  return room.seats.flatMap((seat, index) => (seat.kind === 'human' ? [index] : []));
}

/** Sitzbelegung in der Sprache der Regeln. Freie Sitze gibt es beim Start nicht. */
export function controllersOf(seats: readonly ArcadeRoomSeatRecord[]): SeatController[] {
  return seats.map((seat) =>
    seat.kind === 'bot' ? { type: 'bot', level: seat.botLevel ?? 'mittel' } : { type: 'human' },
  );
}

/** Ergebnis der Partie – aus den Regeln oder aus dem Abbruch-Vermerk. */
export function roomOutcome(game: AnyTurnGame, match: StoredMatch | null): TurnOutcome | null {
  if (match === null) return null;
  if (match.aborted) return { winners: [], summary: match.aborted.summary };

  return (game.outcome(match.state) as TurnOutcome | null) ?? null;
}

/** Sitze, die jetzt ziehen dürfen – nur solange die Partie läuft. */
export function roomActiveSeats(game: AnyTurnGame, room: ArcadeRoom): number[] {
  if (room.status !== 'running' || room.match === null || room.match.aborted) return [];

  return game.activeSeats(room.match.state) as number[];
}

/** Hat das Spiel einen Computergegner? */
export function gameHasBots(game: AnyTurnGame): boolean {
  return typeof game.bot === 'function';
}

/**
 * Rechte des Kontos im Raum (Pflichtenheft §5.2) – eine Stelle, aus der das
 * DTO **und** die Prüfungen im Service lesen.
 */
export function roomPermissions(
  room: ArcadeRoom,
  viewer: RoomViewer,
  game: AnyTurnGame,
): ArcadeRoomPermissions {
  const mySeat = seatOf(room, viewer.userId);
  const isHost = room.hostUserId === viewer.userId;
  const lobby = room.status === 'lobby';
  const hasOpenSeat = room.seats.some((seat) => seat.kind === 'open');
  const seatCountFits =
    room.seats.length >= game.minPlayers && room.seats.length <= game.maxPlayers;

  return {
    canJoin: lobby && mySeat === null && hasOpenSeat,
    canLeave: mySeat !== null && (lobby || room.status === 'running'),
    canStart: isHost && lobby && !hasOpenSeat && seatCountFits,
    canManageSeats: isHost && lobby,
    canMove: mySeat !== null && roomActiveSeats(game, room).includes(mySeat),
    canChat: room.status !== 'closed' && (mySeat !== null || isHost),
    canClose: room.status !== 'closed' && (isHost || viewer.isAdmin),
    canRematch: isHost && room.status === 'finished',
  };
}

function seatDto(
  seat: ArcadeRoomSeatRecord,
  index: number,
  viewer: RoomViewer,
  profiles: ReadonlyMap<string, RoomProfile>,
  isOnline: (userId: string) => boolean,
): ArcadeRoomSeatDto {
  if (seat.kind === 'human' && seat.userId !== null) {
    const profile = profiles.get(seat.userId);

    return {
      index,
      kind: 'human',
      userId: seat.userId,
      displayName: profile?.displayName ?? 'Unbekannt',
      avatarUpdatedAt: profile?.avatarUpdatedAt?.toISOString() ?? null,
      botLevel: null,
      isCurrentUser: seat.userId === viewer.userId,
      online: isOnline(seat.userId),
    };
  }

  if (seat.kind === 'bot') {
    const level = seat.botLevel ?? 'mittel';

    return {
      index,
      kind: 'bot',
      userId: null,
      displayName: `Computer (${ARCADE_BOT_LEVEL_LABELS[level]})`,
      avatarUpdatedAt: null,
      botLevel: level,
      isCurrentUser: false,
      online: false,
    };
  }

  return {
    index,
    kind: 'open',
    userId: null,
    displayName: null,
    avatarUpdatedAt: null,
    botLevel: null,
    isCurrentUser: false,
    online: false,
  };
}

export interface RoomDtoContext {
  viewer: RoomViewer;
  game: AnyTurnGame;
  profiles: ReadonlyMap<string, RoomProfile>;
  isOnline: (userId: string) => boolean;
}

export function toRoomSummaryDto(room: ArcadeRoom, ctx: RoomDtoContext): ArcadeRoomSummaryDto {
  return {
    id: room.id,
    code: room.code,
    gameId: room.gameId,
    status: room.status,
    hostUserId: room.hostUserId,
    hostDisplayName: ctx.profiles.get(room.hostUserId)?.displayName ?? 'Unbekannt',
    isPrivate: room.isPrivate,
    seats: room.seats.map((seat, index) =>
      seatDto(seat, index, ctx.viewer, ctx.profiles, ctx.isOnline),
    ),
    createdAt: room.createdAt.toISOString(),
    updatedAt: room.updatedAt.toISOString(),
    permissions: roomPermissions(room, ctx.viewer, ctx.game),
  };
}

export function toRoomDto(room: ArcadeRoom, ctx: RoomDtoContext): ArcadeRoomDto {
  const { game } = ctx;
  const mySeat = seatOf(room, ctx.viewer.userId);
  const outcome = roomOutcome(game, room.match);
  const log: TurnLogEntry[] =
    room.match === null ? [] : [...(game.log(room.match.state) as TurnLogEntry[])];

  if (room.match?.aborted) {
    log.push({ seat: null, text: room.match.aborted.summary });
  }

  const outcomeDto: ArcadeRoomOutcomeDto | null =
    outcome === null
      ? null
      : {
          winners: outcome.winners,
          summary: outcome.summary,
          ...(outcome.scores === undefined ? {} : { scores: outcome.scores }),
        };

  return {
    ...toRoomSummaryDto(room, ctx),
    options: room.options,
    mySeat,
    version: room.version,
    activeSeats: roomActiveSeats(game, room),
    // Nur die Sicht des eigenen Sitzes – verdeckte Information anderer Sitze
    // verlässt den Server nie (`TurnGame.view`).
    view: room.match === null ? null : game.view(room.match.state, mySeat),
    log: log.map((entry) => ({ seat: entry.seat, text: entry.text })),
    outcome: outcomeDto,
    chat: room.chat.map((line) => ({ ...line })),
  };
}

/** Ist das Spiel online spielbar? */
export function isOnlineGame(gameId: ArcadeGameId): boolean {
  const definition = ARCADE_GAME_CATALOG[gameId];

  return definition.engine === 'turn' && definition.modes.online;
}
