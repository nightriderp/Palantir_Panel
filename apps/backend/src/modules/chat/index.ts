/**
 * B7 – Chat & Moderation (Lastenheft §3.6, Pflichtenheft §15, STRUKTUR.md).
 *
 * Umfang:
 * - Direktnachrichten (1:1) zwischen freigeschalteten Nutzern
 * - Server-Chat, dessen Teilnehmerkreis `ServerMember` folgt
 * - Live-Zustellung über einen eigenen WebSocket-Kanal je angemeldetem Konto
 * - Melde-Funktion für einzelne Nachrichten
 * - Moderationsansicht **ausschließlich** über gemeldete Nachrichten
 * - jede Moderationsentscheidung im Audit-Log (`message.moderated`)
 *
 * **Das Datenschutz-Prinzip ist die Architektur dieses Moduls, nicht eine
 * Prüfung darin** (Pflichtenheft §15 und §18):
 *
 * - `visibility.ts` kennt genau eine Regel – lesen darf, wer teilnimmt. Es gibt
 *   dort keinen Zweig für Admin, Owner oder Moderator.
 * - `moderation.ts` erreicht Inhalte ausschließlich über eine bestehende
 *   Meldung und liefert daraus nur die eine gemeldete Nachricht
 *   (`ReportedMessageDto`).
 * - `repository.ts` bietet gar keine Methode an, die Nachrichten über
 *   Konversationsgrenzen hinweg liest – der Baustein für einen generellen
 *   Zugriff fehlt also schon in der Persistenz.
 * - Die Metadaten des Audit-Eintrags tragen keinen Nachrichteninhalt: Das Log
 *   sehen alle mit `audit.view`, und das ist ein größerer Kreis als der, den
 *   eine Meldung öffnen soll.
 *
 * Wer eine dieser Stellen aufweicht, ändert nicht das Modul, sondern eine
 * Zusicherung des Pflichtenhefts (CLAUDE.md §2).
 *
 * **Anschlüsse an andere Arbeitspakete:**
 * - B2 liefert `message.moderate` und den Guard.
 * - B3 liefert den Teilnehmerkreis der Server-Chats (nur lesend).
 *   `ChatService.ensureServerConversation()` steht bereit, falls B3 den
 *   Gruppen-Chat später schon beim Anlegen des Servers erzeugen will.
 * - B6 kann sich als {@link ChatEventPublisher} für `message.reported`
 *   einhängen; ohne Anschluss läuft das Ereignis ins Leere.
 * - B8 liefert den `AuditService`.
 */

export { ChatError, isChatError } from './errors.js';

export { type ChatContext, contextOf, requireUserId } from './context.js';

export {
  type ChatServerMember,
  type ChatServerRecord,
  type ChatUserDirectory,
  type ChatUserRecord,
  type Clock,
  type ConversationRecord,
  type IdFactory,
  type MessageRecord,
  type MessageReportRecord,
  type ServerMembershipSource,
  systemClock,
} from './types.js';

export {
  type AudienceDependencies,
  type ConversationAudience,
  assertDirectRecipientAllowed,
  assertParticipant,
  canSendMessage,
  canViewConversation,
  dmKeyFor,
  isParticipant,
  recipientsOf,
  resolveAudience,
  titleFor,
  typeOf,
} from './visibility.js';

export {
  computeConversationPermissions,
  computeMessagePermissions,
  computeMessageReportPermissions,
} from './permissions.js';

export {
  type ConversationDtoContext,
  type MessageDtoContext,
  type MessageReportDtoContext,
  toConversationDto,
  toMessageDto,
  toMessageReportDto,
  toReportedMessageDto,
} from './dto.js';

export {
  type ChatRepository,
  type CreateConversationData,
  type CreateMessageData,
  type CreateReportData,
  type MessagePage,
  type MessageReportPage,
  type ResolveReportData,
} from './repository.js';

export {
  createDrizzleChatRepository,
  createDrizzleChatUserDirectory,
  createDrizzleServerMembershipSource,
} from './repositories.js';

export {
  type ChatDelivery,
  type ChatSocket,
  ChatLiveHub,
  conversationCreatedFrame,
  messageDeletedFrame,
  messageSentFrame,
  noopChatDelivery,
} from './live.js';

export { type ChatService, type ChatServiceDependencies, createChatService } from './service.js';

export {
  type ChatEventPublisher,
  type ModerationService,
  type ModerationServiceDependencies,
  createModerationService,
  noopChatEventPublisher,
} from './moderation.js';

export { type ChatRoutesOptions, registerChatRoutes } from './routes.js';

export { type ChatModule, type ChatModuleOptions, createChatModule } from './module.js';
