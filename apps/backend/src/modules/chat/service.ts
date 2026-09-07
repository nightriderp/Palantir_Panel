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
import { isUniqueViolation } from '../../db/errors.js';
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
  conversationReadFrame,
  messageDeletedFrame,
  messageSentFrame,
  noopChatDelivery,
} from './live.js';
import { type ChatRepository } from './repository.js';
import {
  type ChatUserDirectory,
  type Clock,
  type ConversationRecord,
  type MessageRecord,
  type ServerMembershipSource,
  systemClock,
} from './types.js';
import {
  type ConversationAudience,
  assertDirectRecipientAllowed,
  assertMessageParticipant,
  assertParticipant,
  canSendMessage,
  directRecipientCandidateIds,
  dmKeyFor,
  isDirectRecipientAllowed,
  recipientsOf,
  resolveAudience,
  serverParticipantIds,
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
  /**
   * Markiert eine Konversation aus Sicht des Aufrufers als gelesen (Fundpunkt
   * 95): setzt seinen Lesestand auf jetzt, liefert die aktualisierte
   * Konversation und stellt `conversation.read` an seine weiteren Verbindungen
   * zu. `CONVERSATION_NOT_FOUND`, wenn der Aufrufer nicht teilnimmt.
   */
  markConversationRead(ctx: ChatContext, conversationId: string): Promise<ConversationDto>;
  /** Lädt Konversation samt Teilnehmerkreis – von `moderation.ts` mitbenutzt. */
  audienceOf(conversationId: string): Promise<ConversationAudience>;
  /**
   * Teilnehmerkreis der Konversation, in der eine **Nachricht** liegt – samt
   * Teilnahmeprüfung des Aufrufers.
   *
   * Meldet in beiden Fällen (Konversation weg, Aufrufer nicht dabei)
   * `MESSAGE_NOT_FOUND`: Ein Vorgang, der eine Nachricht benennt, antwortet
   * überall mit demselben Code, sonst unterscheidet der Fehlercode zwischen
   * „gibt es nicht" und „gehört jemand anderem" (Audit W3-4,
   * `backend-community-visibility-09`).
   */
  messageAudience(conversationId: string, userId: string): Promise<ConversationAudience>;
}

/**
 * Sortierschlüssel des Verlaufs: `(createdAt, id)`, aufsteigend.
 *
 * Derselbe Schlüssel, auf dem das Repository blättert – nur andersherum. Ohne
 * das `id`-Kriterium wäre die Reihenfolge bei gleichem Zeitstempel eine andere
 * als beim Blättern, und der Cursor (die älteste Nachricht der Seite) zeigte
 * auf die falsche Nachricht (Audit W3-4, `backend-community-04`).
 */
function nachAlterAufsteigend(a: MessageRecord, b: MessageRecord): number {
  const zeit = a.createdAt.getTime() - b.createdAt.getTime();

  if (zeit !== 0) {
    return zeit;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

  /**
   * Wie {@link participatingAudience}, aber für Vorgänge, die eine Nachricht
   * benennen: Beide Absagen tragen `MESSAGE_NOT_FOUND` (siehe
   * {@link ChatService.messageAudience}).
   */
  async function messageAudience(
    conversationId: string,
    userId: string,
  ): Promise<ConversationAudience> {
    const conversation = await repository.findConversation(conversationId);

    if (!conversation) {
      throw new ChatError('MESSAGE_NOT_FOUND');
    }

    const audience = await resolveAudience(audienceDeps, conversation);

    assertMessageParticipant(audience, userId);

    return audience;
  }

  /**
   * Kreis der Konten, die für den Aufrufer als DM-Empfänger in Frage kommen:
   * Besitzer und Mitglieder der Server, auf die er Zugriff hat
   * (Pflichtenheft §15).
   *
   * Eine Stelle für beide Aufrufer – das Verzeichnis
   * (`listDirectMessageRecipients`) und den Start einer neuen Unterhaltung
   * (`openDirectConversation`). Zwei Auslegungen derselben Regel waren genau
   * die Lücke aus dem Audit (`backend-community-visibility-02`).
   *
   * Die Teilnehmerkreise werden frisch gelesen (wie überall im Modul): Wer aus
   * einem Server entfernt wurde, fällt sofort heraus. Ein zwischenzeitlich
   * gelöschter Server liefert kein Audience und wird übersprungen.
   */
  async function directRecipientCandidates(viewerId: string): Promise<readonly string[]> {
    const serverIds = await servers.listServerIdsForUser(viewerId);

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

    return directRecipientCandidateIds(viewerId, audiences);
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

    try {
      const created = await repository.createConversation({
        type: 'server_chat',
        serverId,
        dmKey: null,
        participantIds: [],
      });

      return created.id;
    } catch (error) {
      /*
       * Zwei Teilnehmer öffnen den Server-Chat im selben Moment zum ersten Mal
       * (Audit W2-9, `backend-community-05`): Beide finden nichts, beide legen
       * an, der Unique-Index `conversations_server_id_idx` fängt den zweiten.
       * Fachlich ist das kein Fehler – es gibt die Konversation dann eben schon,
       * und genau die ist gemeint. Bisher endete der Fall als 500.
       */
      if (!isUniqueViolation(error)) {
        throw error;
      }

      const nachgelesen = await repository.findConversationByServerId(serverId);

      if (!nachgelesen) {
        // Der Index hat ausgelöst, die Zeile ist trotzdem nicht da: Das ist
        // kein Rennen mehr, sondern ein Widerspruch – unverändert nach oben.
        throw error;
      }

      return nachgelesen.id;
    }
  }

  /** Lesestand des Aufrufers in dieser Konversation (Fundpunkt 95). */
  interface ReadState {
    readonly unreadCount: number;
    readonly lastReadAt: Date | null;
  }

  /** Der Lesestand einer noch leeren, gerade angelegten Konversation. */
  const EMPTY_READ_STATE: ReadState = { unreadCount: 0, lastReadAt: null };

  /** Lesestände eines Kontos zu mehreren Konversationen in einem Zug. */
  async function readStatesFor(
    viewerId: string,
    conversationIds: readonly string[],
  ): Promise<Map<string, ReadState>> {
    const result = new Map<string, ReadState>();

    if (conversationIds.length === 0) {
      return result;
    }

    const [unread, lastRead] = await Promise.all([
      repository.unreadCounts(viewerId, conversationIds),
      repository.lastReadAtFor(viewerId, conversationIds),
    ]);

    for (const conversationId of conversationIds) {
      result.set(conversationId, {
        unreadCount: unread.get(conversationId) ?? 0,
        lastReadAt: lastRead.get(conversationId) ?? null,
      });
    }

    return result;
  }

  /** Lesestand einer einzelnen Konversation. */
  async function readStateFor(viewerId: string, conversationId: string): Promise<ReadState> {
    const states = await readStatesFor(viewerId, [conversationId]);

    return states.get(conversationId) ?? EMPTY_READ_STATE;
  }

  /** Baut den DTO einer Konversation aus Sicht genau eines Kontos. */
  async function conversationDtoFor(
    audience: ConversationAudience,
    viewerId: string,
    lastMessage: MessageRecord | null,
    readState: ReadState,
  ): Promise<ConversationDto> {
    const base = await messageContext(
      viewerId,
      lastMessage ? [lastMessage] : [],
      audience.participantIds,
    );

    const context: ConversationDtoContext = {
      ...base,
      viewerId,
      lastMessage,
      unreadCount: readState.unreadCount,
      lastReadAt: readState.lastReadAt,
    };

    return toConversationDto(audience, context);
  }

  return {
    audienceOf,
    messageAudience,
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

      const conversationIds = visible.map((audience) => audience.conversation.id);

      const [lastMessages, readStates] = await Promise.all([
        repository.lastMessages(conversationIds),
        readStatesFor(viewerId, conversationIds),
      ]);

      const dtos = await Promise.all(
        visible.map((audience) =>
          conversationDtoFor(
            audience,
            viewerId,
            lastMessages.get(audience.conversation.id) ?? null,
            readStates.get(audience.conversation.id) ?? EMPTY_READ_STATE,
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
      const [lastMessages, readState] = await Promise.all([
        repository.lastMessages([conversationId]),
        readStateFor(viewerId, conversationId),
      ]);

      return conversationDtoFor(
        audience,
        viewerId,
        lastMessages.get(conversationId) ?? null,
        readState,
      );
    },

    async openDirectConversation(ctx, recipientId) {
      const viewerId = requireUserId(ctx);

      /*
       * Zuerst der **Absender** (Audit W2-2, `backend-community-visibility-02`):
       * Lastenheft §3.6 erlaubt Direktnachrichten „zwischen freigeschalteten
       * Nutzern" – in beide Richtungen. Geprüft wurde bisher nur der Empfänger,
       * ein wartendes Gast-Konto konnte also jedes Konto anschreiben, dessen Id
       * es kannte.
       *
       * Die Prüfung steht vor dem Nachschlagen des Empfängers, damit ein nicht
       * freigeschaltetes Konto nicht über den Fehlercode erfährt, ob eine
       * fremde Konto-Id existiert.
       */
      const sender = await users.find(viewerId);

      if (!sender || sender.banned || !sender.approved) {
        throw new ChatError(
          'PERMISSION_DENIED',
          'Direktnachrichten stehen erst nach der Freischaltung des Kontos offen.',
        );
      }

      const recipient = await users.find(recipientId);

      if (!recipient) {
        throw new ChatError('USER_NOT_FOUND');
      }

      assertDirectRecipientAllowed(viewerId, recipient);

      const dmKey = dmKeyFor(viewerId, recipientId);

      /** DTO einer Unterhaltung, die es bereits gibt – samt Lesestand. */
      async function bestehende(vorhanden: ConversationRecord): Promise<ConversationDto> {
        const audience = await resolveAudience(audienceDeps, vorhanden);
        const [lastMessages, readState] = await Promise.all([
          repository.lastMessages([vorhanden.id]),
          readStateFor(viewerId, vorhanden.id),
        ]);

        return conversationDtoFor(
          audience,
          viewerId,
          lastMessages.get(vorhanden.id) ?? null,
          readState,
        );
      }

      const existing = await repository.findConversationByDmKey(dmKey);

      if (existing) {
        return bestehende(existing);
      }

      /*
       * Eine **neue** Unterhaltung entsteht nur innerhalb des Kandidatenkreises,
       * den auch das Verzeichnis zeigt (`directRecipientCandidateIds`): Besitzer
       * und Mitglieder gemeinsamer Server (Pflichtenheft §15). Sonst wäre die
       * Zusicherung „keine DM ins Blaue" allein eine Frage der bekannten Id –
       * und die Arcade-Bestenliste liefert Ids an jede Sitzung.
       *
       * Bewusst erst hier und nicht vor dem Nachschlagen der bestehenden
       * Unterhaltung: Eine einmal rechtmäßig entstandene DM bleibt erreichbar,
       * auch wenn der gemeinsame Server später wegfällt – sie steht ohnehin
       * weiter in `listConversations`.
       */
      const candidateIds = await directRecipientCandidates(viewerId);

      if (!candidateIds.includes(recipientId)) {
        throw new ChatError('CONVERSATION_RECIPIENT_NOT_ALLOWED');
      }

      let created: ConversationRecord;

      try {
        created = await repository.createConversation({
          type: 'dm',
          serverId: null,
          dmKey,
          participantIds: [viewerId, recipientId],
        });
      } catch (error) {
        /*
         * Beide Seiten schreiben sich im selben Moment zum ersten Mal an
         * (Audit W2-9, `backend-community-05`): Der Unique-Index
         * `conversations_dm_key_idx` lässt nur einen Insert zu. Der Verlierer
         * bekommt die eben entstandene Unterhaltung – dieselbe Antwort, die ein
         * Wimpernschlag später ohnehin herausgekommen wäre – statt eines 500.
         * Kein `conversation.created` an das Gegenüber: Das hat der Gewinner
         * des Rennens bereits verschickt.
         */
        if (!isUniqueViolation(error)) {
          throw error;
        }

        const nachgelesen = await repository.findConversationByDmKey(dmKey);

        if (!nachgelesen) {
          throw error;
        }

        return bestehende(nachgelesen);
      }

      const audience = await resolveAudience(audienceDeps, created);
      const dto = await conversationDtoFor(audience, viewerId, null, EMPTY_READ_STATE);

      /*
       * Das Gegenüber erfährt sofort von der neuen Unterhaltung – mit einem
       * DTO aus **seiner** Sicht, nicht aus der des Absenders: Titel und
       * `permissions` unterscheiden sich je Empfänger (Pflichtenheft §5.2).
       */
      for (const recipientUserId of recipientsOf(audience, viewerId)) {
        const recipientDto = await conversationDtoFor(
          audience,
          recipientUserId,
          null,
          EMPTY_READ_STATE,
        );

        delivery.deliver(
          recipientUserId,
          conversationCreatedFrame({ conversation: recipientDto }, clock.now()),
        );
      }

      return dto;
    },

    async listDirectMessageRecipients(ctx) {
      const viewerId = requireUserId(ctx);
      const candidateIds = await directRecipientCandidates(viewerId);

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

      /*
       * Zuerst der Teilnehmerkreis des **Servers**, dann erst der Chat (Audit
       * W3-4, `backend-community-visibility-10`).
       *
       * Vorher legte `ensureServerConversation` die Konversation an, bevor
       * irgendjemand die Teilnahme geprüft hatte: Ein Unbeteiligter erzeugte
       * damit eine Zeile in einem fremden Server und unterschied über den
       * Fehlercode (`SERVER_NOT_FOUND` vs. `CONVERSATION_NOT_FOUND`), welche
       * Server-Ids es gibt. Beide Fälle antworten jetzt gleich – ein Server,
       * zu dem der Aufrufer nicht gehört, ist für ihn nicht von einem
       * nicht existierenden zu unterscheiden.
       */
      const [server, members] = await Promise.all([
        servers.findServer(serverId),
        servers.listMembers(serverId),
      ]);

      if (server === null || !serverParticipantIds(server, members).includes(viewerId)) {
        throw new ChatError('CONVERSATION_NOT_FOUND');
      }

      const conversationId = await ensureServerConversation(serverId);

      // Teilnahme wird auch danach geprüft: Der Teilnehmerkreis wird für das
      // DTO ohnehin frisch aufgelöst, und der Chat eines fremden Servers bleibt
      // auch dann verschlossen, wenn er längst entstanden ist.
      const audience = await participatingAudience(conversationId, viewerId);
      const [lastMessages, readState] = await Promise.all([
        repository.lastMessages([conversationId]),
        readStateFor(viewerId, conversationId),
      ]);

      return conversationDtoFor(
        audience,
        viewerId,
        lastMessages.get(conversationId) ?? null,
        readState,
      );
    },

    async listMessages(ctx, conversationId, query) {
      const viewerId = requireUserId(ctx);

      await participatingAudience(conversationId, viewerId);

      const page = await repository.listMessages(conversationId, {
        limit: query.limit,
        ...(query.before === undefined ? {} : { before: query.before }),
      });

      const context = await messageContext(viewerId, page.messages);

      /*
       * Das Repository liefert die jüngsten zuerst; der Vertrag verlangt
       * aufsteigende Reihenfolge, damit das Frontend nichts umdrehen muss.
       * Sortiert wird über den vollen Schlüssel `(createdAt, id)` – die
       * Umkehrung muss dieselbe Ordnung treffen, auf der das Repository
       * blättert, sonst zeigt `nextCursor` bei gleichem Zeitstempel auf die
       * falsche Nachricht und die nächste Seite lässt eine aus.
       */
      const ordered = [...page.messages].sort(nachAlterAufsteigend);

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
       * **Ein** Kontext für alle Empfänger (Audit W2-3,
       * `backend-community-visibility-06`, `backend-community-10`).
       *
       * Vorher lief `messageContext()` je Empfänger, also zwei Abfragen mal
       * Teilnehmerzahl, nacheinander abgewartet, bevor die 201 hinausging: In
       * einem Server-Chat mit 40 Mitgliedern 80 Abfragen für eine Nachricht.
       * Beide liefern für eine gerade angelegte Nachricht aber für jeden
       * dasselbe:
       *  - `displayNames` fragt nur nach dem Absender und ist damit unabhängig
       *    vom Empfänger;
       *  - `reportedMessageIds` ist zwingend leer – melden kann niemand eine
       *    Nachricht, die es in diesem Moment erst gibt.
       * Empfängerabhängig ist allein `viewerId`, und der fließt nur in
       * `computeMessagePermissions` ein. Also einmal laden und je Empfänger
       * ausschließlich die Sicht austauschen.
       */
      const displayNames = await users.displayNames([message.senderId]);
      const reportedByViewer: ReadonlySet<string> = new Set<string>();

      /*
       * Zugestellt wird an **alle** Teilnehmer, den Absender eingeschlossen:
       * Er hat womöglich mehrere Geräte offen, und dort soll die Nachricht
       * ebenso erscheinen.
       */
      for (const recipientId of recipientsOf(audience)) {
        delivery.deliver(
          recipientId,
          messageSentFrame(
            {
              conversationId,
              message: toMessageDto(message, {
                viewerId: recipientId,
                displayNames,
                reportedByViewer,
              }),
            },
            sentAt,
          ),
        );
      }

      return toMessageDto(message, { viewerId, displayNames, reportedByViewer });
    },

    async deleteOwnMessage(ctx, messageId) {
      const viewerId = requireUserId(ctx);
      const message = await repository.findMessage(messageId);

      if (!message) {
        throw new ChatError('MESSAGE_NOT_FOUND');
      }

      // Erst die Teilnahme prüfen: Sonst verriete die Fehlermeldung, ob es die
      // Nachricht in einer fremden Konversation gibt. Beide Absagen tragen
      // denselben Code wie die unbekannte Id.
      const audience = await messageAudience(message.conversationId, viewerId);

      if (message.senderId !== viewerId) {
        throw new ChatError('MESSAGE_NOT_FOUND');
      }

      if (message.deletedAt !== null) {
        throw new ChatError('MESSAGE_ALREADY_DELETED');
      }

      const deletedAt = clock.now();

      /*
       * Die Vorprüfung oben liest einen Stand, der beim Schreiben schon veraltet
       * sein kann: Löscht ein Moderator im selben Moment (`moderation.ts`),
       * bestünden beide Aufrufe die Prüfung und der letzte überschriebe
       * `deletedById` – das DTO-Flag `deletedByModerator` kippte je nach
       * Reihenfolge. Wer die Löschung beansprucht, entscheidet deshalb das
       * bedingte `UPDATE` (Audit W3-4, `backend-community-12`).
       */
      const beansprucht = await repository.markMessageDeleted(messageId, viewerId, deletedAt);

      if (!beansprucht) {
        throw new ChatError('MESSAGE_ALREADY_DELETED');
      }

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

    async markConversationRead(ctx, conversationId) {
      const viewerId = requireUserId(ctx);

      // Teilnahme prüfen, bevor irgendetwas geschrieben wird: Wer nicht
      // teilnimmt, kann den Lesestand einer fremden Konversation weder setzen
      // noch aus der Antwort ableiten (Pflichtenheft §15).
      const audience = await participatingAudience(conversationId, viewerId);

      const readAt = clock.now();

      await repository.markConversationRead(conversationId, viewerId, readAt);

      const [lastMessages, readState] = await Promise.all([
        repository.lastMessages([conversationId]),
        readStateFor(viewerId, conversationId),
      ]);

      const dto = await conversationDtoFor(
        audience,
        viewerId,
        lastMessages.get(conversationId) ?? null,
        readState,
      );

      /*
       * Der Lesestand gehört dem Konto, nicht der Konversation: zugestellt wird
       * allein an dieses Konto (alle seine Geräte/Tabs), nicht an die übrigen
       * Teilnehmer. So zieht ein zweites Gerät seinen Ungelesen-Zähler nach,
       * ohne zu pollen; andere Teilnehmer erfahren nichts über fremdes
       * Leseverhalten.
       */
      delivery.deliver(
        viewerId,
        conversationReadFrame(
          { conversationId, lastReadAt: readAt.toISOString(), unreadCount: readState.unreadCount },
          readAt,
        ),
      );

      return dto;
    },
  };
}
