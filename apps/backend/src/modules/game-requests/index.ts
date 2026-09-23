/**
 * Spiel-Wünsche: Dienst und Port-Beschreibungen (Betreiber, 19.09.2026).
 *
 * Ablauf wie bei den Kontingent-Anfragen (`modules/quota-requests`), nur ohne
 * deren Nachwirkung: Eine Zusage ändert nichts an der Instanz. Sie sagt „ja,
 * das nehmen wir auf" – das Image baut danach ein Mensch. Genau deshalb steht
 * auch die Zusage im Protokoll: Sonst bliebe später offen, wer sie gegeben hat.
 */

import {
  type GameRequestDto,
  type GameRequestStatus,
  type NotificationEventPayloads,
} from '@palantir/contracts';
import {
  type CreateGameRequestInput,
  type DecideGameRequestInput,
  type GameRequestQuery,
} from '@palantir/validation';
import { isUniqueViolation } from '../../db/errors.js';
import { type AuditService } from '../admin/index.js';
import { type PermissionActor, hasPermission } from '../rbac/index.js';
import { GameRequestError } from './errors.js';

export { GameRequestError, isGameRequestError } from './errors.js';

export interface GameRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly userDisplayName: string;
  readonly game: string;
  readonly reason: string | null;
  readonly status: GameRequestStatus;
  readonly decisionNote: string | null;
  readonly decidedByDisplayName: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

export interface GameRequestRepository {
  create(input: {
    userId: string;
    game: string;
    reason: string | null;
  }): Promise<GameRequestRecord>;
  findById(id: string): Promise<GameRequestRecord | null>;
  listByUser(userId: string): Promise<GameRequestRecord[]>;
  list(query: GameRequestQuery): Promise<GameRequestRecord[]>;
  findOpenByUser(userId: string): Promise<GameRequestRecord | null>;
  decide(
    id: string,
    status: 'approved' | 'rejected',
    decidedById: string | null,
    note: string | null,
  ): Promise<GameRequestRecord | null>;
  withdraw(id: string): Promise<boolean>;
}

/** Senke für `gameRequest.created`; ohne Angabe wird nichts gemeldet. */
export interface GameRequestEventSink {
  emit(
    event: 'gameRequest.created',
    payload: NotificationEventPayloads['gameRequest.created'],
  ): void;
}

export interface GameRequestDecisionContext {
  readonly ipHint: string | null;
}

export interface GameRequestService {
  create(
    actor: PermissionActor,
    userId: string,
    input: CreateGameRequestInput,
  ): Promise<GameRequestDto>;
  listOwn(actor: PermissionActor, userId: string): Promise<GameRequestDto[]>;
  list(actor: PermissionActor, query: GameRequestQuery): Promise<GameRequestDto[]>;
  approve(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    input: DecideGameRequestInput,
    context?: GameRequestDecisionContext,
  ): Promise<GameRequestDto>;
  reject(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    input: DecideGameRequestInput,
    context?: GameRequestDecisionContext,
  ): Promise<GameRequestDto>;
  withdraw(actor: PermissionActor, userId: string, id: string): Promise<void>;
}

export interface GameRequestDependencies {
  readonly repository: GameRequestRepository;
  readonly events?: GameRequestEventSink;
  readonly audit?: AuditService;
  readonly now?: () => Date;
}

export function toGameRequestDto(
  actor: PermissionActor,
  viewerId: string | null,
  record: GameRequestRecord,
): GameRequestDto {
  const offen = record.status === 'pending';

  return {
    id: record.id,
    userId: record.userId,
    userDisplayName: record.userDisplayName,
    game: record.game,
    reason: record.reason,
    status: record.status,
    decisionNote: record.decisionNote,
    decidedByDisplayName: record.decidedByDisplayName,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    permissions: {
      canDecide: offen && hasPermission(actor, 'gametype.manage'),
      canWithdraw: offen && viewerId === record.userId,
    },
  };
}

export function createGameRequestService(deps: GameRequestDependencies): GameRequestService {
  const jetzt = deps.now ?? (() => new Date());

  function requireUserManage(actor: PermissionActor): void {
    // Ein neues Spiel ist eine Frage des Spieleangebots, nicht der Konten
    // (Fundpunkt 346).
    if (!hasPermission(actor, 'gametype.manage')) {
      throw new GameRequestError('PERMISSION_DENIED');
    }
  }

  async function requireRecord(id: string): Promise<GameRequestRecord> {
    const record = await deps.repository.findById(id);

    if (!record) {
      throw new GameRequestError('GAME_REQUEST_NOT_FOUND');
    }

    return record;
  }

  async function decide(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    status: 'approved' | 'rejected',
    input: DecideGameRequestInput,
    context?: GameRequestDecisionContext,
  ): Promise<GameRequestDto> {
    requireUserManage(actor);

    const record = await requireRecord(id);

    if (record.status !== 'pending') {
      throw new GameRequestError('GAME_REQUEST_INVALID_STATE');
    }

    const note = input.note?.trim();
    const beschieden = await deps.repository.decide(
      id,
      status,
      actorUserId,
      note === undefined || note === '' ? null : note,
    );

    /*
     * `null` heißt: Zwischen Lesen und Schreiben hat jemand anders beschieden.
     * Der Zustand ist dann nicht mehr offen – dieselbe Antwort wie oben.
     */
    if (!beschieden) {
      throw new GameRequestError('GAME_REQUEST_INVALID_STATE');
    }

    await deps.audit?.record({
      action: status === 'approved' ? 'gameRequest.approved' : 'gameRequest.rejected',
      actorId: actorUserId,
      actorDisplayName: beschieden.decidedByDisplayName,
      ipHint: context?.ipHint ?? null,
      targetType: 'gameRequest',
      targetId: beschieden.id,
      metadata: {
        userId: beschieden.userId,
        game: beschieden.game,
        decisionNote: beschieden.decisionNote,
      },
    });

    return toGameRequestDto(actor, actorUserId, beschieden);
  }

  return {
    async create(actor, userId, input) {
      /*
       * Erst fragen, dann schreiben – und den Unique-Index trotzdem abfangen:
       * Zwei Anläufe desselben Kontos im selben Augenblick kämen beide durch
       * die Vorprüfung, und die Datenbank hätte das letzte Wort.
       */
      const offen = await deps.repository.findOpenByUser(userId);

      if (offen) {
        throw new GameRequestError('GAME_REQUEST_ALREADY_OPEN');
      }

      const reason = input.reason?.trim();

      let record: GameRequestRecord;

      try {
        record = await deps.repository.create({
          userId,
          game: input.game,
          reason: reason === undefined || reason === '' ? null : reason,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new GameRequestError('GAME_REQUEST_ALREADY_OPEN');
        }

        throw error;
      }

      deps.events?.emit('gameRequest.created', {
        at: jetzt().toISOString(),
        actorId: record.userId,
        gameRequestId: record.id,
        userId: record.userId,
        displayName: record.userDisplayName,
        game: record.game,
        reason: record.reason,
      });

      return toGameRequestDto(actor, userId, record);
    },

    async listOwn(actor, userId) {
      const rows = await deps.repository.listByUser(userId);

      return rows.map((row) => toGameRequestDto(actor, userId, row));
    },

    async list(actor, query) {
      requireUserManage(actor);

      const rows = await deps.repository.list(query);

      return rows.map((row) => toGameRequestDto(actor, null, row));
    },

    approve(actor, actorUserId, id, input, context) {
      return decide(actor, actorUserId, id, 'approved', input, context);
    },

    reject(actor, actorUserId, id, input, context) {
      return decide(actor, actorUserId, id, 'rejected', input, context);
    },

    async withdraw(actor, userId, id) {
      const record = await requireRecord(id);

      /*
       * Ein fremder Wunsch ist für den Abrufenden nicht vorhanden, nicht
       * „verboten": Sonst verriete die Antwort, dass es ihn gibt.
       */
      if (record.userId !== userId) {
        throw new GameRequestError('GAME_REQUEST_NOT_FOUND');
      }

      if (record.status !== 'pending') {
        throw new GameRequestError('GAME_REQUEST_INVALID_STATE');
      }

      const zurueckgezogen = await deps.repository.withdraw(id);

      if (!zurueckgezogen) {
        throw new GameRequestError('GAME_REQUEST_INVALID_STATE');
      }
    },
  };
}
