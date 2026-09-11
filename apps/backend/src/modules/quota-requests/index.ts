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
import { isUniqueViolation } from '../../db/errors.js';
import { type AuditService } from '../admin/index.js';
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
  /**
   * Bescheidet eine **offene** Anfrage; `null`, wenn sie es nicht mehr ist.
   *
   * Die Bedingung „noch offen" gehört ins `UPDATE` selbst und nicht in eine
   * Prüfung davor: Nur so entscheidet die Datenbank ein gleichzeitiges
   * Bescheiden und Zurückziehen (backend-admin-resources-06).
   */
  decide(
    id: string,
    status: 'approved' | 'rejected',
    decidedById: string | null,
    note: string | null,
  ): Promise<QuotaRequestRecord | null>;
  /**
   * Nimmt eine bereits beschiedene Anfrage zurück auf `pending`.
   *
   * Ausschließlich als Rücknahme eines Genehmigungslaufs gedacht, bei dem das
   * Setzen des Kontingents danach gescheitert ist.
   */
  reopen(id: string): Promise<void>;
  /**
   * Setzt eine **offene** Anfrage auf `withdrawn`; `false`, wenn sie inzwischen
   * beschieden wurde und deshalb nichts mehr zurückzuziehen war.
   *
   * Kein `DELETE` mehr (Audit W2-15): Der Vorgang bleibt als Beleg stehen, wie
   * jeder beschiedene auch. Eine neue Anfrage ist trotzdem sofort möglich – der
   * partielle Unique-Index deckt nur `status = 'pending'`.
   */
  withdraw(id: string): Promise<boolean>;
}

/** Setzt das Kontingent – erfüllt vom Ressourcen-Modul (B4). */
export interface QuotaWriter {
  setUserLimits(
    actor: PermissionActor,
    userId: string,
    input: UserResourceLimitsInput,
  ): Promise<unknown>;
}

/**
 * Herkunft der Entscheidung fuer das Audit-Log.
 *
 * Am Pruefstand aufgefallen: `quotaRequest.rejected` und `user.limitsChanged`
 * standen als einzige Eintraege ohne `ipHint` im Protokoll, waehrend jeder
 * Eintrag aus B3 und B8 einen traegt. Eine Entscheidung ueber fremde
 * Ressourcen soll dieselbe Spur hinterlassen wie jeder andere Eingriff.
 *
 * Optional, damit ein Aufruf ohne Request (Tests, Wartungslaeufe) nicht
 * gezwungen ist, eine Adresse zu erfinden.
 */
export interface QuotaDecisionContext {
  readonly ipHint: string | null;
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
    context?: QuotaDecisionContext,
  ): Promise<QuotaRequestDto>;
  reject(
    actor: PermissionActor,
    actorUserId: string | null,
    id: string,
    input: DecideQuotaRequestInput,
    context?: QuotaDecisionContext,
  ): Promise<QuotaRequestDto>;
  /** Zurückziehen – nur der Antragsteller, nur solange offen. */
  withdraw(actor: PermissionActor, userId: string, id: string): Promise<void>;
}

export interface QuotaRequestDependencies {
  readonly repository: QuotaRequestRepository;
  /** Zum Setzen des Kontingents bei einer Genehmigung. */
  readonly quotas: QuotaWriter;
  /**
   * Audit-Log (B8) für die Genehmigung.
   *
   * `user.limitsChanged` hing bisher allein an der Route
   * `PUT /admin/users/:userId/limits` – wer ein Kontingent über den
   * Genehmigungsweg erhöhte, tat das unprotokolliert (Pflichtenheft §6).
   *
   * Optional, damit Tests des Ablaufs ohne Admin-Modul auskommen; ohne Angabe
   * wird nichts protokolliert.
   */
  readonly audit?: AuditService;
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
    context?: QuotaDecisionContext,
  ): Promise<QuotaRequestDto> {
    requireUserManage(actor);

    // Vorprüfung, damit „gibt es nicht" 404 bleibt und nicht als Konflikt
    // erscheint. Entschieden wird der Zustand aber unten in der Datenbank.
    const record = await requireRecord(id);

    if (record.status !== 'pending') {
      throw new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE');
    }

    /*
     * Die Anfrage wird zuerst **beansprucht**: Das `UPDATE` trägt die Bedingung
     * `status = 'pending'` selbst, also gewinnt bei gleichzeitigem Bescheiden
     * und Zurückziehen genau einer, und der Verlierer bekommt den Fachcode
     * `QUOTA_REQUEST_INVALID_STATE` (409) statt eines 500 aus einem ins Leere
     * laufenden Folge-Lesen (backend-admin-resources-06).
     */
    const entschieden = await deps.repository.decide(
      id,
      status,
      actorUserId,
      input.note?.trim() === '' ? null : (input.note ?? null),
    );

    if (!entschieden) {
      throw new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE');
    }

    if (status === 'approved') {
      /*
       * Das Kontingent erst nach dem Anspruch: Eine genehmigte Anfrage ohne das
       * versprochene Kontingent wäre falsch, deshalb wird die Anfrage wieder
       * geöffnet, wenn das Setzen scheitert – sie kann dann erneut beschieden
       * werden.
       *
       * Nur die beantragten Felder – ein nicht genannter Wunsch lässt die
       * übrigen Grenzen stehen (Teil-Update, siehe `setUserLimits`).
       */
      try {
        await deps.quotas.setUserLimits(actor, record.userId, {
          ...(record.requestedRamMb === null ? {} : { maxRamMb: record.requestedRamMb }),
          ...(record.requestedMaxConcurrentServers === null
            ? {}
            : { maxConcurrentServers: record.requestedMaxConcurrentServers }),
        });
      } catch (error) {
        // Scheitert auch das Zurücksetzen, bleibt der ursprüngliche Fehler der
        // aussagekräftigere – er wird gemeldet, nicht der Folgefehler.
        await deps.repository.reopen(id).catch(() => undefined);

        throw error;
      }

      /*
       * Dieselbe Aktion wie beim Setzen von Hand: Für das Log zählt, dass sich
       * das Kontingent eines fremden Kontos geändert hat – nicht, über welchen
       * der beiden Wege (Pflichtenheft §6). Die Anfrage steht als Beleg
       * daneben in den Metadaten.
       *
       * Erst nach dem gesetzten Kontingent: Ein gescheiterter Lauf hat die
       * Anfrage wieder geöffnet und ist keine Änderung, die ins Log gehört.
       */
      await deps.audit?.record({
        action: 'user.limitsChanged',
        actorId: actorUserId,
        actorDisplayName: entschieden.decidedByDisplayName,
        ipHint: context?.ipHint ?? null,
        targetType: 'user',
        targetId: entschieden.userId,
        metadata: {
          quotaRequestId: entschieden.id,
          maxRamMb: entschieden.requestedRamMb,
          maxConcurrentServers: entschieden.requestedMaxConcurrentServers,
        },
      });
    } else {
      /*
       * Fundpunkt 237: Die Ablehnung stand im Katalog und wurde nie
       * geschrieben. Die Genehmigung hinterlaesst wenigstens ein
       * `user.limitsChanged` – eine Ablehnung hinterliess gar nichts. Wer
       * hinterher fragt, warum ein Konto sein Kontingent nicht bekommen hat,
       * fand im Protokoll keine Zeile dazu, obwohl die Oberflaeche die Aktion
       * bereits beschriftet (`admin/labels.ts`).
       *
       * Der Vermerk der Entscheidung geht mit in die Metadaten: Er ist die
       * Begruendung, und ohne ihn saehe der Eintrag aus wie eine Ablehnung
       * ohne Grund.
       */
      await deps.audit?.record({
        action: 'quotaRequest.rejected',
        actorId: actorUserId,
        actorDisplayName: entschieden.decidedByDisplayName,
        ipHint: context?.ipHint ?? null,
        // Zielart `quotaRequest` und nicht `user`: Gegenstand der Entscheidung
        // ist die Anfrage. Das betroffene Konto steht in den Metadaten - beim
        // genehmigten Fall ist es umgekehrt, weil sich dort das Kontingent des
        // Kontos aendert.
        targetType: 'quotaRequest',
        targetId: entschieden.id,
        metadata: {
          userId: entschieden.userId,
          decisionNote: entschieden.decisionNote,
        },
      });
    }

    return toQuotaRequestDto(actor, actorUserId, entschieden);
  }

  return {
    async create(actor, userId, input) {
      if (await deps.repository.findOpenByUser(userId)) {
        throw new QuotaRequestError('QUOTA_REQUEST_ALREADY_OPEN');
      }

      let record: QuotaRequestRecord;

      try {
        record = await deps.repository.create({
          userId,
          requestedRamMb: input.requestedRamMb ?? null,
          requestedMaxConcurrentServers: input.requestedMaxConcurrentServers ?? null,
          reason: input.reason,
        });
      } catch (error) {
        /*
         * Zwei gleichzeitige Anfragen desselben Kontos (Audit W2-9,
         * `backend-admin-resources-12`): Beide bestehen `findOpenByUser()`, den
         * zweiten Insert fängt der partielle Index
         * `quota_requests_open_per_user_idx`. Fachlich ist das derselbe Fall,
         * den die Vorprüfung meldet – bisher kam er als 500 zurück.
         */
        if (isUniqueViolation(error)) {
          throw new QuotaRequestError('QUOTA_REQUEST_ALREADY_OPEN');
        }

        throw error;
      }

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

    approve: (actor, actorUserId, id, input, context) =>
      decide(actor, actorUserId, id, 'approved', input, context),

    reject: (actor, actorUserId, id, input, context) =>
      decide(actor, actorUserId, id, 'rejected', input, context),

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

      /*
       * Auch hier entscheidet die Bedingung im `UPDATE`, nicht die Prüfung
       * darüber: Wird gleichzeitig beschieden, trifft das `UPDATE` keine Zeile
       * mehr und der Rückzug scheitert fachlich (409), statt den bereits
       * erteilten Bescheid zu überschreiben (backend-admin-resources-06).
       */
      const zurueckgezogen = await deps.repository.withdraw(id);

      if (!zurueckgezogen) {
        throw new QuotaRequestError('QUOTA_REQUEST_INVALID_STATE');
      }
    },
  };
}
