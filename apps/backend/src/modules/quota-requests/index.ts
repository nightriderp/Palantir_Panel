/**
 * Kontingent-Anfragen (Mockup-Abgleich 12.3.1).
 *
 * Ein Nutzer stößt an seine Grenze, begründet, was er braucht, und ein
 * Administrator entscheidet. Genehmigt er, wird das Kontingent **hier** nicht
 * selbst geschrieben, sondern über den Ressourcen-Dienst gesetzt: Die Regeln,
 * wie ein Kontingent aussieht und was ein Teil-Update bedeutet, stehen dort und
 * sollen nicht ein zweites Mal daneben entstehen (CLAUDE.md §3).
 *
 * Eigenes Modul, weil die Anfrage zwei Seiten hat: Der Nutzer stellt sie, der
 * Administrator bescheidet sie. Sie gehört damit weder allein in B4
 * (Kontingente) noch allein in B8 (Administration).
 */

import { type QuotaRequestDto, type QuotaRequestStatus } from '@palantir/contracts';
import {
  type CreateQuotaRequestInput,
  type DecideQuotaRequestInput,
  type QuotaRequestQuery,
  type UserResourceLimitsInput,
} from '@palantir/validation';
import { type PermissionActor, hasPermission } from '../rbac/index.js';
import { QuotaRequestError } from './errors.js';

export { QuotaRequestError, isQuotaRequestError } from './errors.js';

/** Anfrage, wie sie in der Datenbank steht. */
export interface QuotaRequestRecord {
  readonly id: string;
  readonly userId: string;
  readonly userDisplayName: string;
  readonly requestedRamMb: number | null;
  readonly requestedMaxConcurrentServers: number | null;
  readonly reason: string;
  readonly status: QuotaRequestStatus;
  readonly decisionNote: string | null;
  readonly decidedByDisplayName: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

export interface QuotaRequestRepository {
  create(input: {
    userId: string;
    requestedRamMb: number | null;
    requestedMaxConcurrentServers: number | null;
    reason: string;
  }): Promise<QuotaRequestRecord>;
  findById(id: string): Promise<QuotaRequestRecord | null>;
  listByUser(userId: string): Promise<QuotaRequestRecord[]>;
  list(query: QuotaRequestQuery): Promise<QuotaRequestRecord[]>;
  /** Offene Anfrage eines Kontos; `null`, wenn keine offen ist. */
  findOpenByUser(userId: string): Promise<QuotaRequestRecord | null>;
  decide(
    id: string,
    status: Exclude<QuotaRequestStatus, 'pending'>,
    decidedById: string | null,
    note: string | null,
  ): Promise<QuotaRequestRecord>;
  remove(id: string): Promise<void>;
}

/** Setzt das Kontingent – erfüllt vom Ressourcen-Modul (B4). */
export interface QuotaWriter {
  setUserLimits(
    actor: PermissionActor,
    userId: string,
    input: UserResourceLimitsInput,
  ): Promise<unknown>;
}

export interface QuotaRequestService {
  /** Anfrage stellen – für das eigene Konto. */
  create(
    actor: PermissionActor,
    userId: string,
    input: CreateQuotaRequestInput,
  ): Promise<QuotaRequestDto>;
  /** Eigene Anfragen, jüngste zuerst. */
  listOwn(actor: PermissionActor, userId: string): Promise<QuotaRequestDto[]>;
  /** Alle Anfragen – verlangt `user.manage`. */
  list(actor: PermissionActor, query: QuotaRequestQuery): Promise<QuotaRequestDto[]>;
  /** Genehmigen: setzt das Kontingent und schließt die Anfrage. */
  approve(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    input: DecideQuotaRequestInput,
  ): Promise<QuotaRequestDto>;
  reject(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    input: DecideQuotaRequestInput,
  ): Promise<QuotaRequestDto>;
  /** Zurückziehen – nur der Antragsteller, nur solange offen. */
  withdraw(actor: PermissionActor, userId: string, id: string): Promise<void>;
}

export interface QuotaRequestDependencies {
  readonly repository: QuotaRequestRepository;
  /** Zum Setzen des Kontingents bei einer Genehmigung. */
  readonly quotas: QuotaWriter;
}

export function toQuotaRequestDto(
  actor: PermissionActor,
  viewerId: string | null,
  record: QuotaRequestRecord,
): QuotaRequestDto {
  const offen = record.status === 'pending';

  return {
    id: record.id,
    userId: record.userId,
    userDisplayName: record.userDisplayName,
    requestedRamMb: record.requestedRamMb,
    requestedMaxConcurrentServers: record.requestedMaxConcurrentServers,
    reason: record.reason,
    status: record.status,
    decisionNote: record.decisionNote,
    decidedByDisplayName: record.decidedByDisplayName,
    decidedAt: record.decidedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    permissions: {
      canDecide: offen && hasPermission(actor, 'user.manage'),
      // Der eigene Antrag, und nur solange niemand entschieden hat.
      canWithdraw: offen && viewerId === record.userId,
    },
  };
}

export function createQuotaRequestService(deps: QuotaRequestDependencies): QuotaRequestService {
  function requireUserManage(actor: PermissionActor): void {
    if (!hasPermission(actor, 'user.manage')) {
      throw new QuotaRequestError('PERMISSION_DENIED');
    }
  }

  async function requireRecord(id: string): Promise<QuotaRequestRecord> {
    const record = await deps.repository.findById(id);

    if (!record) {
      throw new QuotaRequestError('QUOTA_REQUEST_NOT_FOUND');
    }

    return record;
  }

  async function decide(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    status: 'approved' | 'rejected',
    input: DecideQuotaRequestInput,
  ): Promise<QuotaRequestDto> {
    requireUserManage(actor);

    const record = await requireRecord(id);

    if (record.status !== 'pending') {
      throw new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE');
    }

    if (status === 'approved') {
      /*
       * Erst das Kontingent, dann die Anfrage schließen: Scheitert das Setzen,
       * bleibt die Anfrage offen und kann erneut beschieden werden. Andersherum
       * stünde eine genehmigte Anfrage ohne das Kontingent da, das sie
       * verspricht.
       *
       * Nur die beantragten Felder – ein nicht genannter Wunsch lässt die
       * übrigen Grenzen stehen (Teil-Update, siehe `setUserLimits`).
       */
      await deps.quotas.setUserLimits(actor, record.userId, {
        ...(record.requestedRamMb === null ? {} : { maxRamMb: record.requestedRamMb }),
        ...(record.requestedMaxConcurrentServers === null
          ? {}
          : { maxConcurrentServers: record.requestedMaxConcurrentServers }),
      });
    }

    const entschieden = await deps.repository.decide(
      id,
      status,
      actorUserId,
      input.note?.trim() === '' ? null : (input.note ?? null),
    );

    return toQuotaRequestDto(actor, actorUserId, entschieden);
  }

  return {
    async create(actor, userId, input) {
      if (await deps.repository.findOpenByUser(userId)) {
        throw new QuotaRequestError('QUOTA_REQUEST_ALREADY_OPEN');
      }

      const record = await deps.repository.create({
        userId,
        requestedRamMb: input.requestedRamMb ?? null,
        requestedMaxConcurrentServers: input.requestedMaxConcurrentServers ?? null,
        reason: input.reason,
      });

      return toQuotaRequestDto(actor, userId, record);
    },

    async listOwn(actor, userId) {
      const rows = await deps.repository.listByUser(userId);

      return rows.map((row) => toQuotaRequestDto(actor, userId, row));
    },

    async list(actor, query) {
      requireUserManage(actor);

      const rows = await deps.repository.list(query);

      return rows.map((row) => toQuotaRequestDto(actor, null, row));
    },

    approve: (actor, actorUserId, id, input) => decide(actor, actorUserId, id, 'approved', input),

    reject: (actor, actorUserId, id, input) => decide(actor, actorUserId, id, 'rejected', input),

    async withdraw(actor, userId, id) {
      const record = await requireRecord(id);

      // Fremde Anfragen gibt es für den Aufrufer nicht – auch nicht als
      // „darfst du nicht": Das verriete, dass es sie gibt.
      if (record.userId !== userId) {
        throw new QuotaRequestError('QUOTA_REQUEST_NOT_FOUND');
      }

      if (record.status !== 'pending') {
        throw new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE');
      }

      await deps.repository.remove(id);
    },
  };
}
