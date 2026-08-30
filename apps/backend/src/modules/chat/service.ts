/**
 * Chat-Dienst (Lastenheft §3.6, Pflichtenheft §15) – Konversationen und
 * Nachrichten.
 *
 * Jeder lesende und schreibende Vorgang geht durch dieselbe Schranke:
 * {@link ChatService} lädt die Konversation, löst ihren Teilnehmerkreis auf
 * (`visibility.ts`) und bricht mit `CONVERSATION_NOT_FOUND` ab, wenn der
 * Aufrufer nicht dazugehört. Es gibt hier keinen zweiten Weg an eine
 * Konversation heran – auch nicht für den Owner (Pflichtenheft §15,
 * CLAUDE.md §2).
 *
 * Die Moderation gemeldeter Nachrichten liegt bewusst in einer eigenen Datei
 * (`moderation.ts`), damit die beiden Zugriffswege nicht ineinanderlaufen.
 */

import {
  type ConversationDto,
  type DirectMessageRecipientDto,
  type MessageDto,
  type MessagePageDto,
} from '@palantir/contracts';
import { type MessagePageQuery, type SendMessageInput } from '@palantir/validation';
import { type ChatContext, requireUserId } from './context.js';
import {
  type ConversationDtoContext,
  type MessageDtoContext,
  toConversationDto,
  toDirectMessageRecipientDto,
  toMessageDto,
} from './dto.js';
import { ChatError } from './errors.js';
import {
  type ChatDelivery,
  conversationCreatedFrame,
  messageDeletedFrame,
  messageSentFrame,
  noopChatDelivery,
} from './live.js';
import { type ChatRepository } from './repository.js';
import {
  type ChatUserDirectory,
  type Clock,
  type MessageRecord,
  type ServerMembershipSource,
  systemClock,
} from './types.js';
import {
  type ConversationAudience,
  assertDirectRecipientAllowed,
  assertParticipant,
  canSendMessage,
  directRecipientCandidateIds,
  dmKeyFor,
  isDirectRecipientAllowed,
  recipientsOf,
  resolveAudience,
} from './visibility.js';

export interface ChatServiceDependencies {
  readonly repository: ChatRepository;
  readonly users: ChatUserDirectory;
  /** Teilnehmerkreis der Server-Chats (B3). */
  readonly servers: ServerMembershipSource;
  /** Live-Zustellung; ohne Angabe wird nichts zugestellt. */
  readonly delivery?: ChatDelivery;
  readonly clock?: Clock;
}

export interface ChatService {
  /** Alle Konversationen des Aufrufers – DMs und Server-Chats. */
  listConversations(ctx: ChatContext): Promise<ConversationDto[]>;
  /** Eine Konversation; `CONVERSATION_NOT_FOUND`, wenn der Aufrufer nicht teilnimmt. */
  getConversation(ctx: ChatContext, conversationId: string): Promise<ConversationDto>;
  /** Öffnet die Unterhaltung mit einem anderen Konto und legt sie beim ersten Mal an. */
  openDirectConversation(ctx: ChatContext, recipientId: string): Promise<ConversationDto>;
  /**
   * Zulässige DM-Empfänger für den Aufrufer (Pflichtenheft §15): Besitzer und
   * Mitglieder der Server, auf die er Zugriff hat – freigeschaltet, nicht
   * gesperrt, ohne ihn selbst. Bewusst keine globale Nutzerliste.
   */
  listDirectMessageRecipients(ctx: ChatContext): Promise<DirectMessageRecipientDto[]>;
  /**
   * Gruppen-Chat eines Servers; legt ihn beim ersten Zugriff an
   * („entsteht automatisch mit dem Server", Pflichtenheft §15).
   */
  openServerConversation(ctx: ChatContext, serverId: string): Promise<ConversationDto>;
  /**
   * Legt den Gruppen-Chat eines Servers ohne Aufrufer an – Anschlusspunkt für
   * B3, falls die Orchestrierung ihn schon beim Anlegen des Servers erzeugen
   * will. Prüft keine Rechte, weil sie kein Konto kennt: Sie liefert nur die
   * Konversation, sichtbar wird sie erst über den Teilnehmerkreis.
   */
  ensureServerConversation(serverId: string): Promise<string>;
  listMessages(
    ctx: ChatContext,
    conversationId: string,
    query: MessagePageQuery,
  ): Promise<MessagePageDto>;
  sendMessage(
    ctx: ChatContext,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<MessageDto>;
  /** Löscht den **eigenen** Beitrag. Moderatoren löschen über `moderation.ts`. */
  deleteOwnMessage(ctx: ChatContext, messageId: string): Promise<void>;
  /** Lädt Konversation samt Teilnehmerkreis – von `moderation.ts` mitbenutzt. */
  audienceOf(conversationId: string): Promise<ConversationAudience>;
}

export function createChatService(deps: ChatServiceDependencies): ChatService {
  const { repository, users, servers } = deps;
  const delivery = deps.delivery ?? noopChatDelivery;
  const clock = deps.clock ?? systemClock;

  const audienceDeps = {
    servers,
    listDirectParticipants: (conversationId: string) =>
      repository.listDirectParticipants(conversationId),
  };

  /** Lädt eine Konversation samt Teilnehmerkreis oder bricht mit `CONVERSATION_NOT_FOUND` ab. */
  async function audienceOf(conversationId: string): Promise<ConversationAudience> {
    const conversation = await repository.findConversation(conversationId);

    if (!conversation) {
      throw new ChatError('CONVERSATION_NOT_FOUND');
    }

    return resolveAudience(audienceDeps, conversation);
  }

  /** Lädt eine Konversation und prüft in einem Zug die Teilnahme des Aufrufers. */
  async function participatingAudience(
    conversationId: string,
    userId: string,
  ): Promise<ConversationAudience> {
    const audience = await audienceOf(conversationId);

    assertParticipant(audience, userId);

    return audience;
  }

  /** Baut den DTO-Kontext für eine Menge Nachrichten aus Sicht eines Kontos. */
  async function messageContext(
    viewerId: string,
    messages: readonly MessageRecord[],
    extraUserIds: readonly string[] = [],
  ): Promise<MessageDtoContext> {
    const userIds = [...new Set([...messages.map((m) => m.senderId), ...extraUserIds])];

    const [displayNames, reportedByViewer] = await Promise.all([
      users.displayNames(userIds),
      repository.reportedMessageIds(
        viewerId,
        messages.map((message) => message.id),
      ),
    ]);

    return { viewerId, displayNames, reportedByViewer };
  }

  /**
   * Legt den Gruppen-Chat eines Servers an, falls es ihn noch nicht gibt.
   *
   * Bewusst ohne Rechteprüfung: Die Konversation allein macht nichts sichtbar –
   * lesen darf sie erst, wer im Teilnehmerkreis des Servers steht. Die Prüfung
   * passiert deshalb an der Aufrufstelle, nicht hier.
   */
  async function ensureServerConversation(serverId: string): Promise<string> {
    const existing = await repository.findConversationByServerId(serverId);

    if (existing) {
      return existing.id;
    }

    const server = await servers.findServer(serverId);

    if (!server) {
      throw new ChatError('SERVER_NOT_FOUND');
    }

    const created = await repository.createConversation({
      type: 'server_chat',
      serverId,
      dmKey: null,
      participantIds: [],
    });

    return created.id;
  }

  /** Baut den DTO einer Konversation aus Sicht genau eines Kontos. */
  async function conversationDtoFor(
    audience: ConversationAudience,
    viewerId: string,
    lastMessage: MessageRecord | null,
  ): Promise<ConversationDto> {
    const base = await messageContext(
      viewerId,
      lastMessage ? [lastMessage] : [],
      audience.participantIds,
    );

    const context: ConversationDtoContext = { ...base, viewerId, lastMessage };

    return toConversationDto(audience, context);
  }

  return {
    audienceOf,
    ensureServerConversation,

    async listConversations(ctx) {
      const viewerId = requireUserId(ctx);

      const [directConversations, serverIds] = await Promise.all([
        repository.listDirectConversationsForUser(viewerId),
        servers.listServerIdsForUser(viewerId),
      ]);

      /*
       * Server-Chats werden beim ersten Zugriff angelegt. In der Übersicht
       * erscheinen deshalb nur die, die es schon gibt – ein Server ohne bisher
       * genutzten Chat würde die Liste sonst mit leeren Einträgen füllen.
       */
      const serverConversations = (
        await Promise.all(
          serverIds.map((serverId) => repository.findConversationByServerId(serverId)),
        )
      ).filter((conversation) => conversation !== null);

      const audiences = await Promise.all(
        [...directConversations, ...serverConversations].map((conversation) =>
          resolveAudience(audienceDeps, conversation),
        ),
      );

      const visible = audiences.filter((audience) => audience.participantIds.includes(viewerId));

      const lastMessages = await repository.lastMessages(
        visible.map((audience) => audience.conversation.id),
      );

      const dtos = await Promise.all(
        visible.map((audience) =>
          conversationDtoFor(
            audience,
            viewerId,
            lastMessages.get(audience.conversation.id) ?? null,
          ),
        ),
      );

      /*
       * Jüngste Aktivität zuerst; Konversationen ohne Nachricht landen nach
       * ihrem Entstehungszeitpunkt dazwischen – so steht oben, wo gerade etwas
       * passiert.
       */
      return dtos.sort((a, b) => {
        const left = a.lastMessage?.createdAt ?? a.createdAt;
        const right = b.lastMessage?.createdAt ?? b.createdAt;

        return right.localeCompare(left);
      });
    },

    async getConversation(ctx, conversationId) {
      const viewerId = requireUserId(ctx);
      const audience = await participatingAudience(conversationId, viewerId);
      const lastMessages = await repository.lastMessages([conversationId]);

      return conversationDtoFor(audience, viewerId, lastMessages.get(conversationId) ?? null);
    },

    async openDirectConversation(ctx, recipientId) {
      const viewerId = requireUserId(ctx);
      const recipient = await users.find(recipientId);

      if (!recipient) {
        throw new ChatError('USER_NOT_FOUND');
      }

      assertDirectRecipientAllowed(viewerId, recipient);

      const dmKey = dmKeyFor(viewerId, recipientId);
      const existing = await repository.findConversationByDmKey(dmKey);

      if (existing) {
        const audience = await resolveAudience(audienceDeps, existing);
        const lastMessages = await repository.lastMessages([existing.id]);

        return conversationDtoFor(audience, viewerId, lastMessages.get(existing.id) ?? null);
      }

      const created = await repository.createConversation({
        type: 'dm',
        serverId: null,
        dmKey,
        participantIds: [viewerId, recipientId],
      });

      const audience = await resolveAudience(audienceDeps, created);
      const dto = await conversationDtoFor(audience, viewerId, null);

      /*
       * Das Gegenüber erfährt sofort von der neuen Unterhaltung – mit einem
       * DTO aus **seiner** Sicht, nicht aus der des Absenders: Titel und
       * `permissions` unterscheiden sich je Empfänger (Pflichtenheft §5.2).
       */
      for (const recipientUserId of recipientsOf(audience, viewerId)) {
        const recipientDto = await conversationDtoFor(audience, recipientUserId, null);

        delivery.deliver(
          recipientUserId,
          conversationCreatedFrame({ conversation: recipientDto }, clock.now()),
        );
      }

      return dto;
    },

    async listDirectMessageRecipients(ctx) {
      const viewerId = requireUserId(ctx);

      const serverIds = await servers.listServerIdsForUser(viewerId);

      /*
       * Teilnehmerkreise der gemeinsamen Server frisch lesen (wie überall im
       * Modul, Pflichtenheft §15): Wer aus einem Server entfernt wurde, fällt
       * damit sofort aus dem Verzeichnis. Ein zwischenzeitlich gelöschter
       * Server liefert kein Audience und wird übersprungen.
       */
      const audiences = (
        await Promise.all(
          serverIds.map(async (serverId) => {
            const [server, members] = await Promise.all([
              servers.findServer(serverId),
              servers.listMembers(serverId),
            ]);

            return server
              ? { ownerId: server.ownerId, memberIds: members.map((member) => member.userId) }
              : null;
          }),
        )
      ).filter((audience) => audience !== null);

      const candidateIds = directRecipientCandidateIds(viewerId, audiences);

      if (candidateIds.length === 0) {
        return [];
      }

      const candidates = await users.listByIds(candidateIds);

      return candidates
        .filter((candidate) => isDirectRecipientAllowed(viewerId, candidate))
        .map(toDirectMessageRecipientDto)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    async openServerConversation(ctx, serverId) {
      const viewerId = requireUserId(ctx);
      const conversationId = await ensureServerConversation(serverId);

      // Teilnahme wird auch hier geprüft: Der Chat eines fremden Servers ist
      // für Nichtmitglieder nicht sichtbar – auch nicht, nachdem er entstanden
      // ist.
      const audience = await participatingAudience(conversationId, viewerId);
      const lastMessages = await repository.lastMessages([conversationId]);

      return conversationDtoFor(audience, viewerId, lastMessages.get(conversationId) ?? null);
    },

    async listMessages(ctx, conversationId, query) {
      const viewerId = requireUserId(ctx);

      await participatingAudience(conversationId, viewerId);

      const page = await repository.listMessages(conversationId, {
        limit: query.limit,
        ...(query.before === undefined ? {} : { before: query.before }),
      });

      const context = await messageContext(viewerId, page.messages);

      // Das Repository liefert die jüngsten zuerst; der Vertrag verlangt
      // aufsteigende Reihenfolge, damit das Frontend nichts umdrehen muss.
      const ordered = [...page.messages].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );

      const oldest = ordered[0];

      return {
        conversationId,
        messages: ordered.map((message) => toMessageDto(message, context)),
        nextCursor: page.hasMore && oldest ? oldest.id : null,
        limit: query.limit,
      };
    },

    async sendMessage(ctx, conversationId, input) {
      const viewerId = requireUserId(ctx);
      const audience = await participatingAudience(conversationId, viewerId);

      if (!canSendMessage(audience, viewerId)) {
        throw new ChatError('PERMISSION_DENIED');
      }

      const message = await repository.createMessage({
        conversationId,
        senderId: viewerId,
        content: input.content,
      });

      const sentAt = clock.now();

      /*
       * Zugestellt wird an **alle** Teilnehmer, den Absender eingeschlossen:
       * Er hat womöglich mehrere Geräte offen, und dort soll die Nachricht
       * ebenso erscheinen.
       */
      for (const recipientId of recipientsOf(audience)) {
        const context = await messageContext(recipientId, [message]);

        delivery.deliver(
          recipientId,
          messageSentFrame({ conversationId, message: toMessageDto(message, context) }, sentAt),
        );
      }

      const ownContext = await messageContext(viewerId, [message]);

      return toMessageDto(message, ownContext);
    },

    async deleteOwnMessage(ctx, messageId) {
      const viewerId = requireUserId(ctx);
      const message = await repository.findMessage(messageId);

      if (!message) {
        throw new ChatError('MESSAGE_NOT_FOUND');
      }

      // Erst die Teilnahme prüfen: Sonst verriete die Fehlermeldung, ob es die
      // Nachricht in einer fremden Konversation gibt.
      const audience = await participatingAudience(message.conversationId, viewerId);

      if (message.senderId !== viewerId) {
        throw new ChatError('MESSAGE_NOT_FOUND');
      }

      if (message.deletedAt !== null) {
        throw new ChatError('MESSAGE_ALREADY_DELETED');
      }

      const deletedAt = clock.now();

      await repository.markMessageDeleted(messageId, viewerId, deletedAt);

      const frame = messageDeletedFrame(
        {
          conversationId: message.conversationId,
          messageId,
          deletedAt: deletedAt.toISOString(),
          byModerator: false,
        },
        deletedAt,
      );

      for (const recipientId of recipientsOf(audience)) {
        delivery.deliver(recipientId, frame);
      }
    },
  };
}
