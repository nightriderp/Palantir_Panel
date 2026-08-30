/**
 * Sichtbarkeitsregeln des Chats (Lastenheft §3.6, Pflichtenheft §15).
 *
 * **Die eine Regel, auf der alles aufbaut:** Eine Konversation liest, wer an
 * ihr teilnimmt – sonst niemand. Es gibt hier bewusst keinen zweiten Zweig für
 * Admins, Owner oder Moderatoren. `message.moderate` kommt in dieser Datei
 * nicht vor und darf hier auch nicht auftauchen: Moderation ist reaktiv und
 * arbeitet ausschließlich auf gemeldeten Einzelnachrichten
 * (`moderation.ts`), nie auf Konversationen (CLAUDE.md §2).
 *
 * Der Teilnehmerkreis kommt aus zwei Quellen:
 * - `dm` – die beiden Konten in `conversation_participants`
 * - `server_chat` – Besitzer und Mitglieder des Servers, bei jeder Prüfung
 *   frisch gelesen. Wer aus dem Server entfernt wird, ist im selben Moment aus
 *   dessen Chat draußen.
 */

import { type ConversationType } from '@palantir/contracts';
import { ChatError } from './errors.js';
import {
  type ChatServerRecord,
  type ConversationRecord,
  type ServerMembershipSource,
} from './types.js';

/**
 * Eine Konversation samt ihrem aufgelösten Teilnehmerkreis.
 *
 * Wird für jede Prüfung neu gebaut – ein zwischengespeicherter Teilnehmerkreis
 * wäre nach der ersten Mitgliederänderung falsch.
 */
export interface ConversationAudience {
  readonly conversation: ConversationRecord;
  /** Alle Konten, die diese Konversation lesen dürfen. */
  readonly participantIds: readonly string[];
  /** Server des Gruppen-Chats; `null` bei einer DM. */
  readonly server: ChatServerRecord | null;
}

/** Schlüssel einer Direktnachricht: beide Konto-IDs, sortiert und verkettet. */
export function dmKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join(':');
}

/** Teilnehmerquellen, die zum Auflösen eines Server-Chats gebraucht werden. */
export interface AudienceDependencies {
  readonly servers: ServerMembershipSource;
  /** Teilnehmer einer DM aus `conversation_participants`. */
  listDirectParticipants(conversationId: string): Promise<readonly string[]>;
}

/**
 * Löst den Teilnehmerkreis einer Konversation auf.
 *
 * Ein Server-Chat ohne zugehörigen Server hat keinen Teilnehmerkreis mehr und
 * ist damit für niemanden lesbar – das ist die sichere Vorgabe: Lieber
 * unerreichbar als für alle offen.
 */
export async function resolveAudience(
  deps: AudienceDependencies,
  conversation: ConversationRecord,
): Promise<ConversationAudience> {
  if (conversation.type === 'dm') {
    return {
      conversation,
      participantIds: await deps.listDirectParticipants(conversation.id),
      server: null,
    };
  }

  if (conversation.serverId === null) {
    return { conversation, participantIds: [], server: null };
  }

  const server = await deps.servers.findServer(conversation.serverId);

  if (!server) {
    return { conversation, participantIds: [], server: null };
  }

  const members = await deps.servers.listMembers(conversation.serverId);
  const participantIds = [server.ownerId, ...members.map((member) => member.userId)];

  // Der Besitzer könnte theoretisch zusätzlich als Mitglied eingetragen sein.
  return { conversation, participantIds: [...new Set(participantIds)], server };
}

/** Nimmt das Konto an dieser Konversation teil? */
export function isParticipant(audience: ConversationAudience, userId: string | null): boolean {
  return userId !== null && audience.participantIds.includes(userId);
}

/**
 * Darf das Konto die Konversation lesen?
 *
 * Identisch mit {@link isParticipant} – als eigene Funktion, damit die Regel an
 * genau einer Stelle steht und im Test benannt geprüft werden kann.
 */
export function canViewConversation(
  audience: ConversationAudience,
  userId: string | null,
): boolean {
  return isParticipant(audience, userId);
}

/**
 * Darf das Konto in dieser Konversation schreiben?
 *
 * Wer lesen darf, darf auch schreiben. Eine abgestufte Schreibberechtigung
 * (etwa nur ab Mitgliedsstufe `operator`) verlangt weder Lastenheft §3.6 noch
 * Pflichtenheft §15 – ein Zuschauer eines Servers gehört zum Teilnehmerkreis
 * seines Chats.
 */
export function canSendMessage(audience: ConversationAudience, userId: string | null): boolean {
  return isParticipant(audience, userId);
}

/**
 * Bricht ab, wenn das Konto nicht teilnimmt.
 *
 * Meldet `CONVERSATION_NOT_FOUND` und **nicht** `PERMISSION_DENIED`: Dass es
 * zwischen zwei anderen Konten eine Unterhaltung gibt, ist selbst schon eine
 * Information (Pflichtenheft §15).
 */
export function assertParticipant(audience: ConversationAudience, userId: string | null): void {
  if (!canViewConversation(audience, userId)) {
    throw new ChatError('CONVERSATION_NOT_FOUND');
  }
}

/**
 * Anzeigetitel aus Sicht eines Teilnehmers.
 *
 * Beim Server-Chat der Servername, bei der DM der Anzeigename des Gegenübers.
 * Steht der Name nicht zur Verfügung, bleibt ein neutraler Platzhalter – ein
 * leerer Titel wäre in der Liste nicht anklickbar.
 */
export function titleFor(
  audience: ConversationAudience,
  viewerId: string,
  displayNames: ReadonlyMap<string, string>,
): string {
  if (audience.conversation.type === 'server_chat') {
    return audience.server?.name ?? 'Gelöschter Server';
  }

  const otherId = audience.participantIds.find((id) => id !== viewerId);

  return otherId ? (displayNames.get(otherId) ?? 'Unbekanntes Konto') : 'Unterhaltung';
}

/** Teilnehmer außer dem genannten Konto – die Empfänger einer Zustellung. */
export function recipientsOf(
  audience: ConversationAudience,
  exceptUserId?: string,
): readonly string[] {
  return exceptUserId === undefined
    ? audience.participantIds
    : audience.participantIds.filter((id) => id !== exceptUserId);
}

/**
 * Darf zwischen diesen beiden Konten eine Direktnachricht beginnen?
 *
 * Lastenheft §3.6 erlaubt Direktnachrichten „zwischen freigeschalteten
 * Nutzern". Ein wartendes oder gesperrtes Konto ist damit ausgenommen – in
 * beide Richtungen, sonst könnte ein gesperrtes Konto weiter anschreiben.
 */
export function assertDirectRecipientAllowed(
  senderId: string,
  recipient: { readonly id: string; readonly banned: boolean; readonly approved: boolean },
): void {
  if (recipient.id === senderId) {
    throw new ChatError(
      'CONVERSATION_RECIPIENT_INVALID',
      'Mit dem eigenen Konto lässt sich keine Unterhaltung führen.',
    );
  }

  if (recipient.banned || !recipient.approved) {
    throw new ChatError('CONVERSATION_RECIPIENT_NOT_ALLOWED');
  }
}

/**
 * Prädikat-Gegenstück zu {@link assertDirectRecipientAllowed}: dieselbe Regel,
 * einmal werfend (an der Aufrufstelle) und einmal filternd (für das
 * Verzeichnis). Ein Konto darf angeschrieben werden, wenn es nicht das eigene
 * ist, nicht gesperrt und freigeschaltet ist.
 */
export function isDirectRecipientAllowed(
  senderId: string,
  recipient: { readonly id: string; readonly banned: boolean; readonly approved: boolean },
): boolean {
  return recipient.id !== senderId && !recipient.banned && recipient.approved;
}

/** Ein Server samt seinem Teilnehmerkreis, so weit das DM-Verzeichnis ihn braucht. */
export interface RecipientServerAudience {
  readonly ownerId: string;
  readonly memberIds: readonly string[];
}

/**
 * Kreis der Konten, die ein Nutzer als DM-Empfänger sehen darf: Besitzer und
 * Mitglieder der Server, auf die er selbst Zugriff hat – ohne ihn selbst
 * (Pflichtenheft §15, Datenschutz).
 *
 * Bewusst **kein** globales Nutzerverzeichnis: Sichtbar wird nur, wer sich
 * ohnehin einen Server mit dem Nutzer teilt. Wer mit niemandem einen Server
 * teilt, sieht ein leeres Verzeichnis und kann so keine DM „ins Blaue" beginnen.
 *
 * Reine Mengenbildung; ob ein Kandidat auch freigeschaltet ist, prüft erst
 * {@link isDirectRecipientAllowed} danach.
 */
export function directRecipientCandidateIds(
  viewerId: string,
  servers: readonly RecipientServerAudience[],
): string[] {
  const candidates = new Set<string>();

  for (const server of servers) {
    candidates.add(server.ownerId);

    for (const memberId of server.memberIds) {
      candidates.add(memberId);
    }
  }

  candidates.delete(viewerId);

  return [...candidates];
}

/** Konversationstyp aus dem Datensatz – nur zur Lesbarkeit an den Aufrufstellen. */
export function typeOf(audience: ConversationAudience): ConversationType {
  return audience.conversation.type;
}
