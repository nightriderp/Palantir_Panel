/**
 * Persistenz des Chat-Moduls (B7).
 *
 * Reiner Datenzugriff – jede fachliche Regel (wer darf lesen, wer darf melden,
 * was sieht ein Moderator) liegt in `visibility.ts`, `permissions.ts` und den
 * Diensten daneben. Dadurch laufen alle Regeln in Tests ohne PostgreSQL
 * (CLAUDE.md §4).
 *
 * **Bewusst unvollständig:** Es gibt hier keine Methode, die Nachrichten über
 * Konversationsgrenzen hinweg sucht oder auflistet, und keine, die eine
 * Konversation ohne Teilnehmerbezug lädt. Eine solche Methode wäre der
 * Baustein, aus dem sich ein genereller Admin-Zugriff bauen ließe – genau das
 * schließt Pflichtenheft §15 aus. Die Moderation kommt allein über
 * {@link ChatRepository.listReports} und {@link ChatRepository.findReport} an
 * Inhalte, und dort immer nur an die eine gemeldete Nachricht.
 */

import { type MessageReportQuery } from '@palantir/validation';
import { type ConversationRecord, type MessageRecord, type MessageReportRecord } from './types.js';

export interface CreateConversationData {
  readonly type: 'dm' | 'server_chat';
  readonly serverId: string | null;
  readonly dmKey: string | null;
  /** Teilnehmer einer DM; beim Server-Chat leer (Teilnehmerkreis folgt `ServerMember`). */
  readonly participantIds: readonly string[];
}

export interface CreateMessageData {
  readonly conversationId: string;
  readonly senderId: string;
  readonly content: string;
}

export interface CreateReportData {
  readonly messageId: string;
  readonly reportedById: string;
  readonly reason: string;
  readonly reportedContent: string;
}

export interface ResolveReportData {
  readonly status: 'resolved' | 'dismissed';
  readonly actionTaken: 'dismiss' | 'deleteMessage';
  readonly moderatorNote: string | null;
  readonly resolvedById: string | null;
  readonly resolvedAt: Date;
}

export interface MessagePage {
  readonly messages: readonly MessageRecord[];
  /** `true`, wenn es vor der ältesten gelieferten Nachricht noch weitere gibt. */
  readonly hasMore: boolean;
}

export interface MessageReportPage {
  readonly reports: readonly MessageReportRecord[];
  readonly total: number;
}

export interface ChatRepository {
  // -- Konversationen --------------------------------------------------------
  findConversation(conversationId: string): Promise<ConversationRecord | null>;
  findConversationByDmKey(dmKey: string): Promise<ConversationRecord | null>;
  findConversationByServerId(serverId: string): Promise<ConversationRecord | null>;
  createConversation(data: CreateConversationData): Promise<ConversationRecord>;
  /** Teilnehmer einer DM; beim Server-Chat immer leer. */
  listDirectParticipants(conversationId: string): Promise<readonly string[]>;
  /** DMs, an denen das Konto teilnimmt. */
  listDirectConversationsForUser(userId: string): Promise<readonly ConversationRecord[]>;

  // -- Nachrichten -----------------------------------------------------------
  createMessage(data: CreateMessageData): Promise<MessageRecord>;
  findMessage(messageId: string): Promise<MessageRecord | null>;
  /**
   * Verlauf einer Konversation, absteigend nach `createdAt` – jüngste zuerst.
   * `before` ist die `Message.id`, ab der weiter in die Vergangenheit gelesen
   * wird.
   */
  listMessages(
    conversationId: string,
    options: { readonly limit: number; readonly before?: string },
  ): Promise<MessagePage>;
  /** Jüngste Nachricht je Konversation – für die Vorschau in der Liste. */
  lastMessages(conversationIds: readonly string[]): Promise<ReadonlyMap<string, MessageRecord>>;
  /** Markiert eine Nachricht als gelöscht; der Datensatz bleibt stehen. */
  markMessageDeleted(messageId: string, deletedById: string, deletedAt: Date): Promise<void>;

  // -- Meldungen -------------------------------------------------------------
  createReport(data: CreateReportData): Promise<MessageReportRecord>;
  findReport(reportId: string): Promise<MessageReportRecord | null>;
  findReportByMessageAndReporter(
    messageId: string,
    reportedById: string,
  ): Promise<MessageReportRecord | null>;
  /** IDs der Nachrichten aus der Liste, die das Konto bereits gemeldet hat. */
  reportedMessageIds(
    reportedById: string,
    messageIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  listReports(query: MessageReportQuery): Promise<MessageReportPage>;
  resolveReport(reportId: string, data: ResolveReportData): Promise<MessageReportRecord>;
}
