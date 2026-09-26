/**
 * Testhilfen der Spielhalle: Mini-Spiele, ein eingeschleustes Register und
 * In-Memory-Attrappen der Repositories.
 *
 * Die Mini-Spiele sind absichtlich winzig und vollständig deterministisch,
 * damit die Tests nicht an den (parallel entstehenden) echten Regeln hängen:
 *
 *  - **Zähler** (Echtzeit): `UP` gibt einen Punkt, `ACTION` beendet die Partie.
 *  - **Nimm** (rundenbasiert): Reihum ein oder zwei Steine nehmen, wer den
 *    letzten nimmt, gewinnt. Punkte je Sitz = genommene Steine. Der Bot nimmt
 *    `Steine mod 3` (mindestens einen).
 */

import { type ArcadeGameId } from '@palantir/contracts';
import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_UP,
  type AnyRealtimeGame,
  type AnyTurnGame,
  type RealtimeGame,
  type TurnGame,
  type TurnLogEntry,
  intIn,
  isRecord,
} from '@palantir/arcade';
import { type ArcadeRoomChatRecord } from '../../db/schema/arcade.js';
import { type ArcadeRoom, type RoomProfile } from './rooms.js';
import { type ArcadeRoomRepository, type NewArcadeRoom } from './rooms-repository.js';
import { type ArcadeRuleRegistry } from './verify.js';

interface ZaehlerState {
  score: number;
  over: boolean;
}

export const zaehlerGame: RealtimeGame<ZaehlerState> = {
  kind: 'realtime',
  id: 'kriechpfad',
  version: 3,
  create: () => ({ score: 0, over: false }),
  step(state, input) {
    if (input === ARCADE_INPUT_UP) state.score += 1;
    if (input === ARCADE_INPUT_ACTION) state.over = true;

    return state;
  },
  isOver: (state) => state.over,
  score: (state) => state.score,
  tickMs: () => 16,
};

export interface NimState {
  stones: number;
  current: number;
  players: number;
  taken: number[];
  last: number | null;
  log: TurnLogEntry[];
}

export function nimGame(
  id: ArcadeGameId,
  overrides: Partial<
    Pick<TurnGame<NimState, { take: number }, { stones: number }, unknown>, 'bot' | 'version'>
  > = {},
): TurnGame<NimState, { take: number }, { stones: number }, unknown> {
  return {
    kind: 'turn',
    id,
    version: 1,
    minPlayers: 1,
    maxPlayers: 4,
    defaultOptions: { stones: 7 },
    hiddenInformation: false,
    parseOptions(raw) {
      if (!isRecord(raw)) return null;
      const stones = raw.stones === undefined ? 7 : intIn(raw.stones, 1, 50);

      return stones === null ? null : { stones };
    },
    setup: ({ players, options }) => ({
      stones: options.stones,
      current: 0,
      players,
      taken: Array.from({ length: players }, () => 0),
      last: null,
      log: [],
    }),
    activeSeats: (state) => (state.stones > 0 ? [state.current] : []),
    parseMove(raw) {
      if (!isRecord(raw)) return null;
      const take = intIn(raw.take, 1, 2);

      return take === null ? null : { take };
    },
    applyMove(state, seat, move) {
      if (state.stones === 0) return { ok: false, error: 'Vorbei.' };
      if (seat !== state.current) return { ok: false, error: 'Nicht am Zug.' };
      if (move.take > state.stones)
        return { ok: false, error: 'So viele Steine liegen nicht mehr da.' };

      const taken = [...state.taken];
      taken[seat] = (taken[seat] ?? 0) + move.take;

      return {
        ok: true,
        state: {
          ...state,
          stones: state.stones - move.take,
          current: (state.current + 1) % state.players,
          taken,
          last: seat,
          log: [...state.log, { seat, text: `nimmt ${String(move.take)}` }],
        },
      };
    },
    outcome: (state) =>
      state.stones === 0
        ? { winners: [state.last ?? 0], summary: 'Letzter Stein genommen.', scores: state.taken }
        : null,
    view: (state, seat) => ({ stones: state.stones, current: state.current, seat }),
    log: (state) => state.log,
    bot: (state) => ({ take: state.stones % 3 === 0 ? 1 : state.stones % 3 }),
    ...overrides,
  };
}

/** Register mit Zähler (`kriechpfad`), Nimm als Siegspiel (`vier-gewinnt`) und als Punktespiel (`kniffel`). */
export function miniRegistry(
  turn: Partial<Record<ArcadeGameId, AnyTurnGame>> = {},
  realtime: Partial<Record<ArcadeGameId, AnyRealtimeGame>> = {},
): ArcadeRuleRegistry {
  const turnGames: Partial<Record<ArcadeGameId, AnyTurnGame>> = {
    'vier-gewinnt': nimGame('vier-gewinnt'),
    kniffel: nimGame('kniffel'),
    ...turn,
  };
  const realtimeGames: Partial<Record<ArcadeGameId, AnyRealtimeGame>> = {
    kriechpfad: zaehlerGame,
    ...realtime,
  };

  return {
    realtime: (id) => realtimeGames[id] ?? null,
    turn: (id) => turnGames[id] ?? null,
  };
}

/** In-Memory-Räume; bildet optimistische Sperre und Chat-Anhängen nach. */
export function fakeRoomRepository(profiles: Record<string, string> = {}): ArcadeRoomRepository & {
  rooms: Map<string, ArcadeRoom>;
  /** Nächstes `update` verliert die Sperre (gleichzeitige Änderung). */
  verliereSperre: { naechstes: boolean };
} {
  const rooms = new Map<string, ArcadeRoom>();
  const verliereSperre = { naechstes: false };
  let counter = 0;
  const clone = (room: ArcadeRoom): ArcadeRoom => structuredClone(room);

  return {
    rooms,
    verliereSperre,
    async insert(input: NewArcadeRoom) {
      for (const room of rooms.values()) {
        if (room.code === input.code && room.status !== 'closed') return null;
      }
      counter += 1;
      const id = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
      const now = new Date(1_700_000_000_000);
      const room: ArcadeRoom = {
        ...structuredClone(input),
        id,
        status: 'lobby',
        match: null,
        version: 0,
        chat: [],
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
      };
      rooms.set(id, room);

      return clone(room);
    },
    async findById(id) {
      const room = rooms.get(id);

      return room ? clone(room) : null;
    },
    async findOpenByCode(code) {
      for (const room of rooms.values()) {
        if (room.code === code && room.status !== 'closed') return clone(room);
      }

      return null;
    },
    async listVisible(userId, gameId) {
      return [...rooms.values()]
        .filter((room) => gameId === null || room.gameId === gameId)
        .filter(
          (room) =>
            (room.status === 'lobby' && !room.isPrivate) ||
            room.hostUserId === userId ||
            room.seats.some((seat) => seat.userId === userId),
        )
        .map(clone);
    },
    async countOpenByHost(userId) {
      return [...rooms.values()].filter(
        (room) =>
          room.hostUserId === userId && (room.status === 'lobby' || room.status === 'running'),
      ).length;
    },
    async update(room, expectedVersion) {
      const current = rooms.get(room.id);

      if (verliereSperre.naechstes) {
        verliereSperre.naechstes = false;
        if (current) rooms.set(room.id, { ...current, version: current.version + 1 });

        return false;
      }

      if (!current || current.version !== expectedVersion) return false;
      rooms.set(room.id, { ...clone(room), chat: current.chat });

      return true;
    },
    async appendChat(id, line: ArcadeRoomChatRecord, limit) {
      const current = rooms.get(id);

      if (!current || current.status === 'closed') return false;
      current.chat = [...current.chat, line].slice(-limit);

      return true;
    },
    async listRunningIds() {
      return [...rooms.values()].filter((room) => room.status === 'running').map((room) => room.id);
    },
    async closeIdle(cutoff) {
      const closed: ArcadeRoom[] = [];

      for (const room of rooms.values()) {
        if (room.status !== 'closed' && room.updatedAt < cutoff) {
          room.status = 'closed';
          room.version += 1;
          closed.push(clone(room));
        }
      }

      return closed;
    },
    async profiles(userIds) {
      const map = new Map<string, RoomProfile>();

      for (const id of userIds) {
        map.set(id, { displayName: profiles[id] ?? id, avatarUpdatedAt: null });
      }

      return map;
    },
  };
}
