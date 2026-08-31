import {
  type ConversationDto,
  type DirectMessageRecipientDto,
  type MessageDto,
  type MessagePageDto,
  type MessageReportDto,
} from '@palantir/contracts';
import {
  type MessagePageQuery,
  type ReportMessageInput,
  type SendMessageInput,
} from '@palantir/validation';
import { type ApiResult, apiRequest } from './client';

/**
 * REST-Endpunkte des Chats (Arbeitspaket B7, Pflichtenheft §6 und §15).
 *
 * Nur der **Teilnehmerweg** unter `/api/chat`. Die Moderationsrouten
 * (`/api/moderation/reports`) gehören zum Admin-Bereich (F10) und haben hier
 * bewusst nichts zu suchen – es gibt in F5 keinen Pfad, über den ein Moderator
 * in fremde Konversationen sähe (Pflichtenheft §15, CLAUDE.md §2).
 *
 * Ergebnisse sind immer der Response-Envelope aus Pflichtenheft §5.1; hier wird
 * nichts ausgepackt und nichts geworfen – wie in den übrigen `lib/api`-Modulen.
 */

const CHAT = '/api/chat';

/** Alle Konversationen des angemeldeten Kontos – DMs und Server-Chats. */
export function fetchConversations(signal?: AbortSignal): Promise<ApiResult<ConversationDto[]>> {
  return apiRequest<ConversationDto[]>(`${CHAT}/conversations`, { signal });
}

/**
 * Lesestand einer Konversation auf jetzt setzen.
 *
 * Ohne Körper – den Zeitpunkt setzt das Backend. Antwort ist die aktualisierte
 * Konversation mit neuem `unreadCount`, damit die Liste ohne zweiten Aufruf
 * stimmt. Serverseitig geführt, damit der Zähler über Geräte hinweg gilt
 * (`ConversationDto.unreadCount` in `@palantir/contracts`).
 */
export function markConversationRead(conversationId: string): Promise<ApiResult<ConversationDto>> {
  return apiRequest<ConversationDto>(
    `${CHAT}/conversations/${encodeURIComponent(conversationId)}/read`,
    { method: 'POST' },
  );
}

/** Eine einzelne Konversation; `CONVERSATION_NOT_FOUND`, wenn nicht teilgenommen. */
export function fetchConversation(
  conversationId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConversationDto>> {
  return apiRequest<ConversationDto>(
    `${CHAT}/conversations/${encodeURIComponent(conversationId)}`,
    { signal },
  );
}

/** Öffnet die Direktnachricht mit einem anderen Konto und legt sie beim ersten Mal an. */
/**
 * Wen darf der Aufrufer direkt anschreiben? (Gefundener Punkt 102.)
 *
 * Kein globales Nutzerverzeichnis: Das Backend gibt nur Konten heraus, mit
 * denen der Aufrufer ohnehin einen Server teilt – als Besitzer **oder**
 * Mitglied.
 */
export function fetchDirectMessageRecipients(
  signal?: AbortSignal,
): Promise<ApiResult<DirectMessageRecipientDto[]>> {
  return apiRequest<DirectMessageRecipientDto[]>('/api/chat/recipients', { signal });
}

export function openDirectConversation(recipientId: string): Promise<ApiResult<ConversationDto>> {
  return apiRequest<ConversationDto>(`${CHAT}/conversations/direct`, {
    method: 'POST',
    json: { recipientId },
  });
}

/**
 * Gruppen-Chat eines Servers. Entsteht beim ersten Zugriff automatisch
 * (Pflichtenheft §15); der Teilnehmerkreis folgt den Server-Mitgliedern.
 */
export function openServerConversation(
  serverId: string,
  signal?: AbortSignal,
): Promise<ApiResult<ConversationDto>> {
  return apiRequest<ConversationDto>(
    `${CHAT}/servers/${encodeURIComponent(serverId)}/conversation`,
    { signal },
  );
}

/**
 * Eine Seite des Nachrichtenverlaufs.
 *
 * `messages` ist aufsteigend nach `createdAt` sortiert (der Vertrag garantiert
 * das); `nextCursor` ist die `Message.id`, ab der die nächste, ältere Seite über
 * `before` geholt wird.
 */
export function fetchMessages(
  conversationId: string,
  query: Partial<MessagePageQuery>,
  signal?: AbortSignal,
): Promise<ApiResult<MessagePageDto>> {
  return apiRequest<MessagePageDto>(
    `${CHAT}/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      query: { before: query.before, limit: query.limit },
      signal,
    },
  );
}

/** Neue Nachricht in einer bestehenden Konversation (Zustellung läuft über den Live-Kanal). */
export function sendMessage(
  conversationId: string,
  input: SendMessageInput,
): Promise<ApiResult<MessageDto>> {
  return apiRequest<MessageDto>(
    `${CHAT}/conversations/${encodeURIComponent(conversationId)}/messages`,
    { method: 'POST', json: input },
  );
}

/** Löscht den **eigenen** Beitrag. Moderatoren löschen ausschließlich über F10. */
export function deleteMessage(messageId: string): Promise<ApiResult<null>> {
  return apiRequest<null>(`${CHAT}/messages/${encodeURIComponent(messageId)}`, {
    method: 'DELETE',
  });
}

/**
 * Meldet eine einzelne Nachricht mit Begründung.
 *
 * Bewusst eine Teilnehmer-Aktion unter `/api/chat` – keine Moderationsaktion.
 * Sie setzt die Teilnahme an der Konversation voraus und verlangt keine
 * Permission (Pflichtenheft §15).
 */
export function reportMessage(
  messageId: string,
  input: ReportMessageInput,
): Promise<ApiResult<MessageReportDto>> {
  return apiRequest<MessageReportDto>(`${CHAT}/messages/${encodeURIComponent(messageId)}/report`, {
    method: 'POST',
    json: input,
  });
}
