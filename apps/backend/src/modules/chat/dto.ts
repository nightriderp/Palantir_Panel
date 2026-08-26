/**
 * DTO-Aufbau des Chats (Pflichtenheft §5.2).
 *
 * Jede Ressource wird vollständig ausgeliefert, inklusive ihres serverseitig
 * berechneten `permissions`-Objekts – kein Zuschneiden auf einzelne Ansichten.
 *
 * **Eine Nachricht ist je Empfänger verschieden:** `permissions.canDelete`,
 * `canReport` und `reportedByViewer` hängen am Betrachter. Deshalb nimmt
 * {@link toMessageDto} den Betrachter entgegen, statt einen DTO zu bauen, der
 * für alle gälte – auch bei der Live-Zustellung wird er je Empfänger neu
 * gebaut (`live.ts`).
 */

import {
  type ConversationDto,
  type MessageDto,
  type MessageReportDto,
  type ReportedMessageDto,
} from '@palantir/contracts';
import { type PermissionActor } from '../rbac/index.js';
import {
  computeConversationPermissions,
  computeMessagePermissions,
  computeMessageReportPermissions,
} from './permissions.js';
import { type ConversationRecord, type MessageRecord, type MessageReportRecord } from './types.js';
import { type ConversationAudience, titleFor } from './visibility.js';

/** Anzeigename oder ein neutraler Platzhalter, wenn das Konto nicht mehr existiert. */
function nameOf(displayNames: ReadonlyMap<string, string>, userId: string): string {
  return displayNames.get(userId) ?? 'Unbekanntes Konto';
}

export interface MessageDtoContext {
  readonly viewerId: string | null;
  readonly displayNames: ReadonlyMap<string, string>;
  /** IDs der Nachrichten, die der Betrachter bereits gemeldet hat. */
  readonly reportedByViewer: ReadonlySet<string>;
}

/**
 * Eine Nachricht als DTO.
 *
 * Eine gelöschte Nachricht behält ihren Platz im Verlauf, gibt ihren Inhalt
 * aber nicht mehr heraus – auch nicht an den Absender selbst. Wer den Inhalt
 * nach der Löschung noch braucht, ist die Moderation, und die bekommt ihn
 * ausschließlich über die Meldung ({@link toReportedMessageDto}).
 */
export function toMessageDto(message: MessageRecord, context: MessageDtoContext): MessageDto {
  const isDeleted = message.deletedAt !== null;

  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderDisplayName: nameOf(context.displayNames, message.senderId),
    content: isDeleted ? '' : message.content,
    createdAt: message.createdAt.toISOString(),
    deletedAt: message.deletedAt?.toISOString() ?? null,
    deletedByModerator: isDeleted ? message.deletedById !== message.senderId : null,
    reportedByViewer: context.reportedByViewer.has(message.id),
    permissions: computeMessagePermissions(
      message,
      context.viewerId,
      context.reportedByViewer.has(message.id),
    ),
  };
}

export interface ConversationDtoContext extends MessageDtoContext {
  readonly viewerId: string;
  readonly lastMessage: MessageRecord | null;
}

export function toConversationDto(
  audience: ConversationAudience,
  context: ConversationDtoContext,
): ConversationDto {
  const { conversation } = audience;

  return {
    id: conversation.id,
    type: conversation.type,
    serverId: conversation.serverId,
    title: titleFor(audience, context.viewerId, context.displayNames),
    participants: audience.participantIds.map((userId) => ({
      userId,
      displayName: nameOf(context.displayNames, userId),
    })),
    lastMessage: context.lastMessage ? toMessageDto(context.lastMessage, context) : null,
    createdAt: conversation.createdAt.toISOString(),
    permissions: computeConversationPermissions(audience, context.viewerId),
  };
}

/**
 * Die gemeldete Nachricht, wie ein Moderator sie sieht.
 *
 * Der Inhalt stammt aus der Meldung (`reportedContent`), nicht aus der
 * Nachricht: So bleibt nachvollziehbar, worüber entschieden wurde, auch wenn
 * die Nachricht danach gelöscht wird – und der Zugriff bleibt auf genau diesen
 * einen Beitrag beschränkt (Pflichtenheft §15).
 */
export function toReportedMessageDto(
  report: MessageReportRecord,
  message: MessageRecord,
  displayNames: ReadonlyMap<string, string>,
): ReportedMessageDto {
  return {
    id: message.id,
    senderId: message.senderId,
    senderDisplayName: nameOf(displayNames, message.senderId),
    content: report.reportedContent,
    createdAt: message.createdAt.toISOString(),
    deletedAt: message.deletedAt?.toISOString() ?? null,
  };
}

export interface MessageReportDtoContext {
  readonly actor: PermissionActor;
  readonly viewerId: string | null;
  readonly displayNames: ReadonlyMap<string, string>;
  readonly message: MessageRecord;
  readonly conversation: ConversationRecord;
}

export function toMessageReportDto(
  report: MessageReportRecord,
  context: MessageReportDtoContext,
): MessageReportDto {
  return {
    id: report.id,
    messageId: report.messageId,
    conversationId: context.conversation.id,
    conversationType: context.conversation.type,
    serverId: context.conversation.serverId,
    reportedById: report.reportedById,
    reportedByDisplayName: nameOf(context.displayNames, report.reportedById),
    reason: report.reason,
    status: report.status,
    actionTaken: report.actionTaken,
    moderatorNote: report.moderatorNote,
    resolvedById: report.resolvedById,
    resolvedByDisplayName: report.resolvedById
      ? nameOf(context.displayNames, report.resolvedById)
      : null,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
    message: toReportedMessageDto(report, context.message, context.displayNames),
    permissions: computeMessageReportPermissions(context.actor, context.viewerId, report),
  };
}
