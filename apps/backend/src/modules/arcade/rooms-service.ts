/**
 * Ablauf der Online-Räume (Neubau 26.09.2026).
 *
 * Der Server ist Schiedsrichter: Nur hier werden Züge angewandt, mit denselben
 * Regeln wie im Browser (`@palantir/arcade`). Der Browser schlägt vor, der
 * Dienst prüft (Sitz am Zug, Regel erlaubt es, Fassung passt) und speichert.
 *
 * **Optimistische Sperre.** Jede Änderung liest den Raum, rechnet den neuen
 * Stand und schreibt ihn nur, wenn `version` inzwischen gleich geblieben ist.
 * Eigene Abläufe (Beitreten, Sitze, Start …) versuchen es bei verlorener Sperre
 * erneut; ein Zug nicht – er wurde gegen eine bestimmte Fassung gedacht und
 * scheitert dann mit `ARCADE_ROOM_VERSION_CONFLICT`. Chat ändert die Version
 * nicht, damit ein Zug nicht an einer Chatzeile scheitert.
 *
 * **Nach jeder Änderung**: Ergebnisse eintragen, wenn die Partie gerade zu Ende
 * ging; alle Menschen im Raum über den Live-Kanal anstoßen; den Bot-Läufer
 * planen, wenn als Nächstes ein Computer zieht.
 */

import { randomInt, randomUUID } from 'node:crypto';
import {
  ARCADE_GAME_CATALOG,
  ARCADE_ROOM_CHAT_LIMIT,
  ARCADE_ROOM_IDLE_HOURS,
  ARCADE_ROOM_MAX_OPEN_PER_USER,
  ARCADE_SCORE_MAX,
  type ArcadeBotLevel,
  type ArcadeGameId,
  type ArcadeRoomDto,
  type ArcadeRoomSummaryDto,
  type ErrorCode,
} from '@palantir/contracts';
import {
  type AnyTurnGame,
  type TurnMatch,
  applyRawMove,
  createMatch,
  nextBotSeat,
  stepBot,
} from '@palantir/arcade';
import { ArcadeError } from './errors.js';
import { type ArcadeLiveDelivery, noopArcadeLiveDelivery, roomUpdatedFrame } from './live.js';
import {
  type ArcadeRoom,
  type ArcadeRoomSeatRecord,
  type RoomViewer,
  type StoredMatch,
  controllersOf,
  gameHasBots,
  generateRoomCode,
  humanSeats,
  isOnlineGame,
  memberIds,
  openSeat,
  roomOutcome,
  roomPermissions,
  seatOf,
  toRoomDto,
  toRoomSummaryDto,
} from './rooms.js';
import { type ArcadeRoomRepository } from './rooms-repository.js';
import { type ArcadeRoomResult } from './service.js';
import { type ArcadeRuleRegistry, defaultArcadeRegistry } from './verify.js';

export interface CreateRoomInput {
  gameId: ArcadeGameId;
  seatCount: number;
  isPrivate: boolean;
  options?: unknown;
}

export interface SetSeatInput {
  seat: number;
  kind: 'open' | 'bot';
  botLevel?: ArcadeBotLevel | undefined;
}

export interface ArcadeRoomService {
  list(viewer: RoomViewer, gameId: ArcadeGameId | null): Promise<ArcadeRoomSummaryDto[]>;
  create(viewer: RoomViewer, input: CreateRoomInput): Promise<ArcadeRoomDto>;
  get(viewer: RoomViewer, id: string): Promise<ArcadeRoomDto>;
  getByCode(viewer: RoomViewer, code: string): Promise<ArcadeRoomDto>;
  join(
    viewer: RoomViewer,
    id: string,
    input: { seat?: number | undefined },
  ): Promise<ArcadeRoomDto>;
  leave(viewer: RoomViewer, id: string): Promise<ArcadeRoomDto>;
  setSeat(viewer: RoomViewer, id: string, input: SetSeatInput): Promise<ArcadeRoomDto>;
  start(viewer: RoomViewer, id: string): Promise<ArcadeRoomDto>;
  move(
    viewer: RoomViewer,
    id: string,
    input: { version: number; move?: unknown },
  ): Promise<ArcadeRoomDto>;
  chat(viewer: RoomViewer, id: string, input: { text: string }): Promise<ArcadeRoomDto>;
  rematch(viewer: RoomViewer, id: string): Promise<ArcadeRoomDto>;
  close(viewer: RoomViewer, id: string): Promise<ArcadeRoomDto>;
  /** Ein Bot-Zug (für den Bot-Läufer); `true`, wenn danach wieder ein Bot zieht. */
  botStep(roomId: string): Promise<boolean>;
  /** Minutentakt: verwaiste Räume schließen, laufende mit Bot am Zug fortsetzen. */
  maintain(): Promise<void>;
}

export interface ArcadeRoomServiceLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface ArcadeRoomServiceOptions {
  readonly repository: ArcadeRoomRepository;
  readonly registry?: ArcadeRuleRegistry;
  readonly live?: ArcadeLiveDelivery;
  /** Ergebnisse einer beendeten Partie eintragen (`ArcadeService.recordRoomResults`). */
  readonly recordResults?: (results: ArcadeRoomResult[]) => Promise<void>;
  /** Bot-Läufer anstoßen; wird von `index.ts` nachträglich verdrahtet. */
  scheduleBot?: (roomId: string) => void;
  readonly logger?: ArcadeRoomServiceLogger;
  readonly now?: () => Date;
  /** Ganzzahl in [0, max) – für Code und Startwert; Tests setzen sie fest. */
  readonly randomBelow?: (max: number) => number;
}

/** Wie oft eine eigene Änderung bei verlorener Sperre neu ansetzt. */
const MAX_RETRIES = 4;
/** Wie oft ein neuer Code gewürfelt wird, bevor das Anlegen aufgibt. */
const MAX_CODE_ATTEMPTS = 8;
/** Beendete Räume bleiben so lange in der eigenen Liste. */
const FINISHED_VISIBLE_MS = 24 * 60 * 60 * 1000;

function fail(code: ErrorCode, message?: string): never {
  throw new ArcadeError(code, message);
}

/** Ergebnis eines Änderungsschritts: neuer Stand plus Konten, die zusätzlich Bescheid bekommen. */
interface Change {
  next: ArcadeRoom;
  alsoNotify?: string[];
}

export function createArcadeRoomService(options: ArcadeRoomServiceOptions): ArcadeRoomService {
  const { repository } = options;
  const registry = options.registry ?? defaultArcadeRegistry;
  const live = options.live ?? noopArcadeLiveDelivery;
  const now = options.now ?? (() => new Date());
  const randomBelow = options.randomBelow ?? ((max: number) => randomInt(0, max));

  function gameOf(gameId: ArcadeGameId): AnyTurnGame {
    return registry.turn(gameId) ?? fail('ARCADE_ROOM_STATE', 'Die Regeln dieses Spiels fehlen.');
  }

  function newSeed(): number {
    // Zwei Hälften, weil `randomInt` höchstens 2^48 als Spanne nimmt und die
    // Tests einen einzigen Zufallsgeber einschleusen.
    return ((randomBelow(0x10000) << 16) | randomBelow(0x10000)) >>> 0;
  }

  async function dto(room: ArcadeRoom, viewer: RoomViewer): Promise<ArcadeRoomDto> {
    const profiles = await repository.profiles(memberIds(room));

    return toRoomDto(room, {
      viewer,
      game: gameOf(room.gameId),
      profiles,
      isOnline: (userId) => live.isOnline(userId),
    });
  }

  async function load(id: string): Promise<ArcadeRoom> {
    const room = await repository.findById(id);

    if (room === null || room.status === 'closed') fail('ARCADE_ROOM_NOT_FOUND');

    return room;
  }

  function isMember(room: ArcadeRoom, userId: string): boolean {
    return room.hostUserId === userId || seatOf(room, userId) !== null;
  }

  function notify(room: ArcadeRoom, also: readonly string[] = []): void {
    const frame = roomUpdatedFrame(
      { roomId: room.id, version: room.version, status: room.status },
      now(),
    );

    for (const userId of new Set([...memberIds(room), ...also])) {
      live.deliver(userId, frame);
    }
  }

  /** Setzt `status` auf `finished`, sobald die Partie ein Ergebnis hat. */
  function withFinish(room: ArcadeRoom, game: AnyTurnGame): ArcadeRoom {
    if (room.status === 'running' && roomOutcome(game, room.match) !== null) {
      return { ...room, status: 'finished', finishedAt: now() };
    }

    return room;
  }

  /** Ergebnisse einer regulär beendeten Partie für die Bestenliste. */
  function resultsOf(room: ArcadeRoom, game: AnyTurnGame): ArcadeRoomResult[] {
    if (room.match === null || room.match.aborted) return [];

    const outcome = roomOutcome(game, room.match);

    if (outcome === null) return [];

    const metric = ARCADE_GAME_CATALOG[room.gameId].metric;
    const results: ArcadeRoomResult[] = [];

    for (const index of humanSeats(room)) {
      const userId = room.seats[index]?.userId;

      if (!userId) continue;

      if (metric === 'wins') {
        if (outcome.winners.includes(index))
          results.push({ userId, gameId: room.gameId, score: 1 });
      } else {
        const score = outcome.scores?.[index];

        if (
          typeof score === 'number' &&
          Number.isInteger(score) &&
          score >= 0 &&
          score <= ARCADE_SCORE_MAX
        ) {
          results.push({ userId, gameId: room.gameId, score });
        }
      }
    }

    return results;
  }

  function botDue(room: ArcadeRoom, game: AnyTurnGame): boolean {
    return (
      room.status === 'running' &&
      room.match !== null &&
      !room.match.aborted &&
      nextBotSeat(game, room.match) !== null
    );
  }

  /** Alles, was nach einer gespeicherten Änderung geschieht. */
  async function afterChange(
    prev: ArcadeRoom,
    next: ArcadeRoom,
    also: readonly string[] = [],
  ): Promise<void> {
    const game = gameOf(next.gameId);

    if (prev.status === 'running' && next.status === 'finished') {
      const results = resultsOf(next, game);

      if (results.length > 0 && options.recordResults) {
        try {
          await options.recordResults(results);
        } catch (error) {
          options.logger?.error(
            { err: error, roomId: next.id },
            'Arcade: Ergebnisse der Online-Partie ließen sich nicht speichern.',
          );
        }
      }
    }

    notify(next, [...memberIds(prev), ...also]);

    if (botDue(next, game)) options.scheduleBot?.(next.id);
  }

  /**
   * Eine eigene Änderung unter optimistischer Sperre. `change` rechnet aus dem
   * frisch geladenen Raum den neuen Stand oder wirft einen fachlichen Fehler.
   */
  async function mutate(
    id: string,
    change: (room: ArcadeRoom, game: AnyTurnGame) => Change,
  ): Promise<{ prev: ArcadeRoom; next: ArcadeRoom }> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const room = await load(id);
      const game = gameOf(room.gameId);
      const { next, alsoNotify } = change(room, game);
      const stamped: ArcadeRoom = { ...next, version: room.version + 1, updatedAt: now() };

      if (await repository.update(stamped, room.version)) {
        await afterChange(room, stamped, alsoNotify);

        return { prev: room, next: stamped };
      }
    }

    return fail('ARCADE_ROOM_VERSION_CONFLICT');
  }

  function requireHost(room: ArcadeRoom, viewer: RoomViewer): void {
    if (room.hostUserId !== viewer.userId) fail('PERMISSION_DENIED', 'Das darf nur der Gastgeber.');
  }

  /** Nächster Mensch (außer `except`) als Gastgeber; `null`, wenn keiner bleibt. */
  function nextHost(seats: readonly ArcadeRoomSeatRecord[], except: string): string | null {
    const seat = seats.find((s) => s.kind === 'human' && s.userId !== null && s.userId !== except);

    return seat?.userId ?? null;
  }

  /** Neue Partie mit der aktuellen Sitzbelegung. */
  function newMatch(room: ArcadeRoom, game: AnyTurnGame): StoredMatch {
    try {
      return createMatch(game, newSeed(), room.options, controllersOf(room.seats)) as TurnMatch;
    } catch (error) {
      return fail(
        'ARCADE_ROOM_STATE',
        error instanceof Error ? error.message : 'Die Partie ließ sich nicht starten.',
      );
    }
  }

  return {
    async list(viewer, gameId) {
      const rooms = await repository.listVisible(
        viewer.userId,
        gameId,
        new Date(now().getTime() - FINISHED_VISIBLE_MS),
      );
      const profiles = await repository.profiles(rooms.flatMap((room) => memberIds(room)));
      const result: ArcadeRoomSummaryDto[] = [];

      for (const room of rooms) {
        const game = registry.turn(room.gameId);

        if (!game) continue;
        result.push(
          toRoomSummaryDto(room, {
            viewer,
            game,
            profiles,
            isOnline: (userId) => live.isOnline(userId),
          }),
        );
      }

      return result;
    },

    async create(viewer, input) {
      if (!isOnlineGame(input.gameId)) {
        fail('VALIDATION_FAILED', 'Dieses Spiel gibt es nicht online.');
      }

      const game =
        registry.turn(input.gameId) ??
        fail('VALIDATION_FAILED', 'Für dieses Spiel gibt es noch keine Regeln.');

      if (input.seatCount < game.minPlayers || input.seatCount > game.maxPlayers) {
        fail(
          'VALIDATION_FAILED',
          `Für dieses Spiel sind ${String(game.minPlayers)} bis ${String(game.maxPlayers)} Plätze möglich.`,
        );
      }

      const parsed: unknown = game.parseOptions(input.options ?? game.defaultOptions);

      if (parsed === null) fail('VALIDATION_FAILED', 'Die Einstellungen sind ungültig.');

      if ((await repository.countOpenByHost(viewer.userId)) >= ARCADE_ROOM_MAX_OPEN_PER_USER) {
        fail('ARCADE_ROOM_LIMIT');
      }

      const seats: ArcadeRoomSeatRecord[] = [
        { kind: 'human', userId: viewer.userId, botLevel: null },
        ...Array.from({ length: input.seatCount - 1 }, openSeat),
      ];

      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
        const room = await repository.insert({
          code: generateRoomCode(randomBelow),
          gameId: input.gameId,
          hostUserId: viewer.userId,
          isPrivate: input.isPrivate,
          seats,
          options: parsed,
        });

        if (room !== null) return dto(room, viewer);
      }

      return fail('INTERNAL_ERROR', 'Es ließ sich kein freier Raumcode finden.');
    },

    async get(viewer, id) {
      const room = await repository.findById(id);

      // Private Räume per Kennung nur für die, die drin sind – für alle
      // anderen gibt es sie nicht (404 statt 403: keine Auskunft).
      if (room === null || (room.isPrivate && !isMember(room, viewer.userId))) {
        return fail('ARCADE_ROOM_NOT_FOUND');
      }

      if (room.status === 'closed' && !isMember(room, viewer.userId)) {
        return fail('ARCADE_ROOM_NOT_FOUND');
      }

      return dto(room, viewer);
    },

    async getByCode(viewer, code) {
      const room = await repository.findOpenByCode(code.trim().toUpperCase());

      if (room === null) return fail('ARCADE_ROOM_NOT_FOUND');

      return dto(room, viewer);
    },

    async join(viewer, id, input) {
      const { next } = await mutate(id, (room) => {
        if (room.status !== 'lobby') fail('ARCADE_ROOM_STATE', 'Die Partie läuft schon.');
        if (seatOf(room, viewer.userId) !== null) {
          fail('ARCADE_ROOM_STATE', 'Du sitzt schon in diesem Raum.');
        }

        const wish = input.seat;
        let target: number;

        if (wish !== undefined) {
          if (wish >= room.seats.length) fail('VALIDATION_FAILED', 'Diesen Platz gibt es nicht.');
          if (room.seats[wish]?.kind !== 'open')
            fail('ARCADE_ROOM_FULL', 'Dieser Platz ist schon belegt.');
          target = wish;
        } else {
          target = room.seats.findIndex((seat) => seat.kind === 'open');
          if (target < 0) fail('ARCADE_ROOM_FULL');
        }

        const seats = room.seats.map((seat, index) =>
          index === target
            ? { kind: 'human' as const, userId: viewer.userId, botLevel: null }
            : seat,
        );

        return { next: { ...room, seats } };
      });

      return dto(next, viewer);
    },

    async leave(viewer, id) {
      const { next } = await mutate(id, (room, game) => {
        const mySeat = seatOf(room, viewer.userId);

        if (mySeat === null) fail('ARCADE_ROOM_STATE', 'Du sitzt nicht in diesem Raum.');

        if (room.status === 'lobby') {
          const seats = room.seats.map((seat, index) => (index === mySeat ? openSeat() : seat));

          if (room.hostUserId !== viewer.userId) return { next: { ...room, seats } };

          const host = nextHost(seats, viewer.userId);

          // Ohne weiteren Menschen gibt es niemanden mehr, der starten könnte.
          return {
            next:
              host === null
                ? { ...room, seats, status: 'closed' }
                : { ...room, seats, hostUserId: host },
          };
        }

        if (room.status !== 'running' || room.match === null) {
          return fail('ARCADE_ROOM_STATE', 'Die Partie ist schon vorbei.');
        }

        const host =
          room.hostUserId === viewer.userId ? nextHost(room.seats, viewer.userId) : room.hostUserId;

        if (host === null) {
          // Kein Mensch mehr im Raum: Niemand sähe die Partie zu Ende.
          return { next: { ...room, seats: room.seats.map(() => openSeat()), status: 'closed' } };
        }

        if (gameHasBots(game)) {
          // Der Computer übernimmt den Platz, die Partie geht weiter.
          const seats = room.seats.map((seat, index) =>
            index === mySeat
              ? { kind: 'bot' as const, userId: null, botLevel: 'mittel' as const }
              : seat,
          );
          const match: StoredMatch = {
            ...room.match,
            seats: room.match.seats.map((controller, index) =>
              index === mySeat ? { type: 'bot', level: 'mittel' } : controller,
            ),
          };

          return { next: { ...room, seats, match, hostUserId: host } };
        }

        // Ohne Computergegner lässt sich nicht weiterspielen.
        const seats = room.seats.map((seat, index) => (index === mySeat ? openSeat() : seat));

        return {
          next: {
            ...room,
            seats,
            hostUserId: host,
            status: 'finished',
            finishedAt: now(),
            match: {
              ...room.match,
              aborted: {
                summary: `${viewer.displayName} hat den Raum verlassen – die Partie ist abgebrochen.`,
              },
            },
          },
        };
      });

      return dto(next, viewer);
    },

    async setSeat(viewer, id, input) {
      const { next } = await mutate(id, (room, game) => {
        requireHost(room, viewer);
        if (room.status !== 'lobby') fail('ARCADE_ROOM_STATE', 'Die Partie läuft schon.');
        if (input.seat >= room.seats.length)
          fail('VALIDATION_FAILED', 'Diesen Platz gibt es nicht.');

        const current = room.seats[input.seat] as ArcadeRoomSeatRecord;

        if (current.kind === 'human' && current.userId === viewer.userId) {
          fail('ARCADE_ROOM_STATE', 'Den eigenen Platz kannst du nicht vergeben.');
        }

        if (input.kind === 'bot' && !gameHasBots(game)) {
          fail('ARCADE_ROOM_STATE', 'Dieses Spiel hat keinen Computergegner.');
        }

        const replacement: ArcadeRoomSeatRecord =
          input.kind === 'bot'
            ? { kind: 'bot', userId: null, botLevel: input.botLevel ?? 'mittel' }
            : openSeat();
        const removed = current.kind === 'human' && current.userId !== null ? [current.userId] : [];

        return {
          next: {
            ...room,
            seats: room.seats.map((seat, index) => (index === input.seat ? replacement : seat)),
          },
          alsoNotify: removed,
        };
      });

      return dto(next, viewer);
    },

    async start(viewer, id) {
      const { next } = await mutate(id, (room, game) => {
        requireHost(room, viewer);
        if (!roomPermissions(room, viewer, game).canStart) {
          fail(
            'ARCADE_ROOM_STATE',
            'Die Partie lässt sich gerade nicht starten – sind alle Plätze belegt?',
          );
        }

        return {
          next: { ...room, status: 'running', match: newMatch(room, game), finishedAt: null },
        };
      });

      return dto(next, viewer);
    },

    async move(viewer, id, input) {
      const room = await load(id);
      const game = gameOf(room.gameId);

      if (room.status !== 'running' || room.match === null || room.match.aborted) {
        fail('ARCADE_ROOM_STATE', 'In diesem Raum läuft gerade keine Partie.');
      }

      const mySeat = seatOf(room, viewer.userId);

      if (mySeat === null) fail('ARCADE_NOT_YOUR_TURN', 'Du spielst in diesem Raum nicht mit.');
      if (input.version !== room.version) fail('ARCADE_ROOM_VERSION_CONFLICT');
      if (!(game.activeSeats(room.match.state) as number[]).includes(mySeat)) {
        fail('ARCADE_NOT_YOUR_TURN');
      }

      const result = applyRawMove(game, room.match, mySeat, input.move);

      if (!result.ok) fail('ARCADE_MOVE_INVALID', result.error);

      const next = withFinish(
        { ...room, match: result.state, version: room.version + 1, updatedAt: now() },
        game,
      );

      if (!(await repository.update(next, room.version))) fail('ARCADE_ROOM_VERSION_CONFLICT');

      await afterChange(room, next);

      return dto(next, viewer);
    },

    async chat(viewer, id, input) {
      const room = await load(id);
      const game = gameOf(room.gameId);

      if (!roomPermissions(room, viewer, game).canChat) {
        fail('PERMISSION_DENIED', 'Schreiben kann nur, wer im Raum sitzt.');
      }

      const line = {
        id: randomUUID(),
        userId: viewer.userId,
        displayName: viewer.displayName,
        text: input.text.trim(),
        sentAt: now().toISOString(),
      };

      if (!(await repository.appendChat(room.id, line, ARCADE_ROOM_CHAT_LIMIT))) {
        fail('ARCADE_ROOM_NOT_FOUND');
      }

      const updated = (await repository.findById(room.id)) ?? room;

      notify(updated);

      return dto(updated, viewer);
    },

    async rematch(viewer, id) {
      const { next } = await mutate(id, (room, game) => {
        requireHost(room, viewer);
        if (room.status !== 'finished')
          fail('ARCADE_ROOM_STATE', 'Die Partie ist noch nicht vorbei.');

        // Ist ein Platz frei geworden, geht es zurück in die Lobby.
        if (room.seats.some((seat) => seat.kind === 'open')) {
          return { next: { ...room, status: 'lobby', match: null, finishedAt: null } };
        }

        return {
          next: { ...room, status: 'running', match: newMatch(room, game), finishedAt: null },
        };
      });

      return dto(next, viewer);
    },

    async close(viewer, id) {
      const { next } = await mutate(id, (room, game) => {
        if (!roomPermissions(room, viewer, game).canClose) {
          fail('PERMISSION_DENIED', 'Schließen darf nur der Gastgeber.');
        }

        return { next: { ...room, status: 'closed' } };
      });

      return dto(next, viewer);
    },

    async botStep(roomId) {
      const room = await repository.findById(roomId);

      if (room === null || room.status !== 'running' || room.match === null || room.match.aborted) {
        return false;
      }

      const game = registry.turn(room.gameId);

      if (!game || nextBotSeat(game, room.match) === null) return false;

      let next: ArcadeRoom;

      try {
        const stepped = stepBot(game, room.match);

        if (stepped === null) return false;
        next = { ...room, match: stepped };
      } catch (error) {
        // Ein illegaler Bot-Zug ist ein Fehler in den Regeln: Partie beenden,
        // laut loggen, aber nicht abstürzen.
        options.logger?.error(
          { err: error, roomId, gameId: room.gameId },
          'Arcade: Computergegner lieferte einen ungültigen Zug – Partie abgebrochen.',
        );
        next = {
          ...room,
          status: 'finished',
          finishedAt: now(),
          match: {
            ...room.match,
            aborted: { summary: 'Partie abgebrochen: Der Computergegner hat sich verrechnet.' },
          },
        };
      }

      next = withFinish({ ...next, version: room.version + 1, updatedAt: now() }, game);

      // Verlorene Sperre: Jemand anderes hat den Raum geändert – neu ansehen.
      if (!(await repository.update(next, room.version))) return true;

      await afterChange(room, next);

      return botDue(next, game);
    },

    async maintain() {
      const cutoff = new Date(now().getTime() - ARCADE_ROOM_IDLE_HOURS * 60 * 60 * 1000);

      for (const room of await repository.closeIdle(cutoff)) {
        notify(room);
      }

      for (const id of await repository.listRunningIds()) {
        const room = await repository.findById(id);
        const game = room ? registry.turn(room.gameId) : null;

        if (room && game && botDue(room, game)) options.scheduleBot?.(room.id);
      }
    },
  };
}
