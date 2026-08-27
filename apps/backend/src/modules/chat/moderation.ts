/**
 * Melde- und Moderationsvorgänge (Lastenheft §3.6, Pflichtenheft §15).
 *
 * **Das Datenschutz-Prinzip in Code:** Der einzige Weg, auf dem ein Konto mit
 * `message.moderate` an einen fremden Nachrichteninhalt kommt, führt über eine
 * bestehende Meldung – und liefert genau die gemeldete Nachricht, nichts
 * darum herum. Es gibt in diesem Dienst
 *
 * - keine Methode, die eine Konversation lädt,
 * - keine Methode, die einen Verlauf liest,
 * - keine Suche über Nachrichten,
 * - und keinen Zweig, der für den Owner mehr erlaubte.
 *
 * Wer eine solche Methode ergänzt, hebt die Zusicherung aus Pflichtenheft §15
 * und §18 auf – das ist keine Erweiterung, sondern ein Bruch (CLAUDE.md §2).
 *
 * Jede Moderationsentscheidung landet im Audit-Log (`message.moderated`).
 */

import {
  type MessageReportDto,
  type MessageReportPageDto,
  type WebSocketEventName,
} from '@palantir/contracts';
import { type MessageReportQuery, type ResolveMessageReportInput } from '@palantir/validation';
import { type AuditService } from '../admin/index.js';
import { hasPermission } from '../rbac/index.js';
import { type ChatContext, requireUserId } from './context.js';
import { toMessageReportDto } from './dto.js';
import { ChatError } from './errors.js';
import { type ChatDelivery, messageDeletedFrame, noopChatDelivery } from './live.js';
import { type ChatRepository } from './repository.js';
import { type ChatService } from './service.js';
import {
  type ChatUserDirectory,
  type Clock,
  type ConversationRecord,
  type MessageRecord,
  type MessageReportRecord,
  systemClock,
} from './types.js';
import { assertParticipant, recipientsOf } from './visibility.js';

/**
 * Ereignis-Senke für die Notification-Engine (B6, Pflichtenheft §14).
 *
 * `message.reported` steht bereits im Katalog; wer darauf hört, entscheidet
 * B6 – dieses Modul kennt die Engine nicht.
 */
export interface ChatEventPublisher {
  publish(event: WebSocketEventName, payload: Record<string, unknown>): void | Promise<void>;
}

/**
 * Senke ohne Wirkung, solange B6 fehlt.
 *
 * Bewusst wirkungslos statt einer Fehlermeldung: Eine Meldung darf nicht daran
 * scheitern, dass niemand zuhört – sie steht anschließend trotzdem in der
 * Moderationsübersicht.
 */
export const noopChatEventPublisher: ChatEventPublisher = {
  publish() {
    // absichtlich leer
  },
};

export interface ModerationServiceDependencies {
  readonly repository: ChatRepository;
  readonly chat: ChatService;
  readonly users: ChatUserDirectory;
  readonly audit: AuditService;
  readonly events?: ChatEventPublisher;
  readonly delivery?: ChatDelivery;
  readonly clock?: Clock;
}

export interface ModerationService {
  /** Meldet genau eine Nachricht. Setzt Teilnahme an deren Konversation voraus. */
  reportMessage(ctx: ChatContext, messageId: string, reason: string): Promise<MessageReportDto>;
  /** Moderationsübersicht – ausschließlich gemeldete Nachrichten. Verlangt `message.moderate`. */
  listReports(ctx: ChatContext, query: MessageReportQuery): Promise<MessageReportPageDto>;
  /** Eine Meldung im Detail. Verlangt `message.moderate`. */
  getReport(ctx: ChatContext, reportId: string): Promise<MessageReportDto>;
  /** Entscheidung über eine Meldung; landet im Audit-Log. Verlangt `message.moderate`. */
  resolveReport(
    ctx: ChatContext,
    reportId: string,
    input: ResolveMessageReportInput,
  ): Promise<MessageReportDto>;
}

function requireModerator(ctx: ChatContext): void {
  if (!hasPermission(ctx.actor, 'message.moderate')) {
    throw new ChatError('PERMISSION_DENIED');
  }
}

export function createModerationService(deps: ModerationServiceDependencies): ModerationService {
  const { repository, chat, users, audit } = deps;
  const events = deps.events ?? noopChatEventPublisher;
  const delivery = deps.delivery ?? noopChatDelivery;
  const clock = deps.clock ?? systemClock;

  /**
   * Lädt Meldung, gemeldete Nachricht und deren Konversation.
   *
   * Die Konversation wird ausschließlich für Typ und `serverId` gebraucht – der
   * DTO gibt daraus nichts weiter als die Einordnung „DM oder Server-Chat".
   */
  async function loadReport(reportId: string): Promise<{
    report: MessageReportRecord;
    message: MessageRecord;
    conversation: ConversationRecord;
  }> {
    const report = await repository.findReport(reportId);

    if (!report) {
      throw new ChatError('MESSAGE_REPORT_NOT_FOUND');
    }

    const message = await repository.findMessage(report.messageId);

    if (!message) {
      // Die Nachricht ist samt Konto verschwunden; die Meldung hat keinen
      // Gegenstand mehr.
      throw new ChatError('MESSAGE_REPORT_NOT_FOUND');
    }

    const conversation = await repository.findConversation(message.conversationId);

    if (!conversation) {
      throw new ChatError('MESSAGE_REPORT_NOT_FOUND');
    }

    return { report, message, conversation };
  }

  async function toDto(
    ctx: ChatContext,
    report: MessageReportRecord,
    message: MessageRecord,
    conversation: ConversationRecord,
  ): Promise<MessageReportDto> {
    const userIds = [report.reportedById, message.senderId];

    if (report.resolvedById) {
      userIds.push(report.resolvedById);
    }

    const displayNames = await users.displayNames([...new Set(userIds)]);

    return toMessageReportDto(report, {
      actor: ctx.actor,
      viewerId: ctx.userId,
      displayNames,
      message,
      conversation,
    });
  }

  return {
    async reportMessage(ctx, messageId, reason) {
      const viewerId = requireUserId(ctx);
      const message = await repository.findMessage(messageId);

      if (!message) {
        throw new ChatError('MESSAGE_NOT_FOUND');
      }

      /*
       * Melden darf nur, wer die Nachricht überhaupt sehen durfte. Ohne diese
       * Prüfung wäre die Melde-Funktion der Umweg, über den sich jeder beliebige
       * fremde Nachrichteninhalt in die Moderationsansicht heben ließe.
       */
      const audience = await chat.audienceOf(message.conversationId);

      assertParticipant(audience, viewerId);

      if (message.senderId === viewerId) {
        throw new ChatError(
          'MESSAGE_REPORT_NOT_ALLOWED',
          'Eigene Nachrichten lassen sich nicht melden.',
        );
      }

      const existing = await repository.findReportByMessageAndReporter(messageId, viewerId);

      if (existing) {
        throw new ChatError('MESSAGE_REPORT_DUPLICATE');
      }

      const report = await repository.createReport({
        messageId,
        reportedById: viewerId,
        reason,
        // Kopie des Inhalts: Die Entscheidung soll nachvollziehbar bleiben,
        // auch wenn die Nachricht danach gelöscht wird.
        reportedContent: message.content,
      });

      const conversation = await repository.findConversation(message.conversationId);

      if (!conversation) {
        throw new ChatError('CONVERSATION_NOT_FOUND');
      }

      /*
       * `message.reported` ist das einzige Chat-Ereignis, das laut
       * Pflichtenheft §14 eine Benachrichtigung auslösen darf. Die Nutzlast
       * trägt bewusst **keinen** Nachrichteninhalt: Eine Benachrichtigung geht
       * an einen Kanal (Discord-Webhook), und dorthin gehört kein privater
       * Text.
       */
      await events.publish('message.reported', {
        reportId: report.id,
        messageId,
        conversationType: conversation.type,
        serverId: conversation.serverId,
        reportedById: viewerId,
      });

      return toDto(ctx, report, message, conversation);
    },

    async listReports(ctx, query) {
      requireModerator(ctx);

      const page = await repository.listReports(query);

      const reports: MessageReportDto[] = [];

      for (const report of page.reports) {
        const message = await repository.findMessage(report.messageId);
        const conversation = message
          ? await repository.findConversation(message.conversationId)
          : null;

        if (!message || !conversation) {
          // Nachricht oder Konversation sind mit einem gelöschten Konto
          // verschwunden; die Meldung hat keinen Gegenstand mehr.
          continue;
        }

        reports.push(await toDto(ctx, report, message, conversation));
      }

      return {
        reports,
        total: page.total,
        limit: query.limit,
        offset: query.offset,
      };
    },

    async getReport(ctx, reportId) {
      requireModerator(ctx);

      const { report, message, conversation } = await loadReport(reportId);

      return toDto(ctx, report, message, conversation);
    },

    async resolveReport(ctx, reportId, input) {
      requireModerator(ctx);

      const moderatorId = requireUserId(ctx);
      const { report, message, conversation } = await loadReport(reportId);

      if (report.status !== 'open') {
        throw new ChatError('MESSAGE_REPORT_ALREADY_RESOLVED');
      }

      const resolvedAt = clock.now();
      const deleteMessage = input.action === 'deleteMessage';

      /*
       * Löschen ist idempotent gedacht: Hat der Absender seinen Beitrag
       * inzwischen selbst entfernt, bleibt die Entscheidung trotzdem gültig und
       * wird protokolliert – nur gelöscht wird nicht ein zweites Mal.
       */
      if (deleteMessage && message.deletedAt === null) {
        await repository.markMessageDeleted(message.id, moderatorId, resolvedAt);

        const audience = await chat.audienceOf(message.conversationId);
        const frame = messageDeletedFrame(
          {
            conversationId: message.conversationId,
            messageId: message.id,
            deletedAt: resolvedAt.toISOString(),
            byModerator: true,
          },
          resolvedAt,
        );

        for (const recipientId of recipientsOf(audience)) {
          delivery.deliver(recipientId, frame);
        }
      }

      const resolved = await repository.resolveReport(reportId, {
        status: deleteMessage ? 'resolved' : 'dismissed',
        actionTaken: input.action,
        moderatorNote: input.note ?? null,
        resolvedById: moderatorId,
        resolvedAt,
      });

      /*
       * Audit-Eintrag (Pflichtenheft §15: „Moderationsaktionen werden im
       * Audit-Log erfasst"). Die Metadaten tragen bewusst **keinen**
       * Nachrichteninhalt: Das Audit-Log ist für Admins mit `audit.view`
       * einsehbar, und das ist ein größerer Kreis als der, den eine Meldung
       * öffnen soll.
       */
      await audit.record({
        action: 'message.moderated',
        actorId: moderatorId,
        actorDisplayName: ctx.displayName,
        targetType: 'message',
        targetId: message.id,
        ipHint: ctx.ipHint,
        metadata: {
          reportId,
          action: input.action,
          conversationType: conversation.type,
          serverId: conversation.serverId,
          reportedById: report.reportedById,
          messageSenderId: message.senderId,
        },
      });

      const updatedMessage = (await repository.findMessage(message.id)) ?? message;

      return toDto(ctx, resolved, updatedMessage, conversation);
    },
  };
}
