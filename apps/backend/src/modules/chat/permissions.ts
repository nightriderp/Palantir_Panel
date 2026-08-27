/**
 * `permissions`-Objekte des Chats (Pflichtenheft §5.2).
 *
 * Jedes DTO trägt seine Flags serverseitig berechnet; das Frontend leitet
 * nichts selbst aus Rollen, Mitgliedsstufen oder Absender-IDs ab.
 *
 * **Bewusste Lücke:** Ein Moderator bekommt hier **kein** Flag, das ihm Zugriff
 * auf eine Konversation oder auf das Löschen einer beliebigen Nachricht gäbe.
 * `message.moderate` wirkt ausschließlich auf Meldungen
 * ({@link computeMessageReportPermissions}) – Pflichtenheft §15.
 */

import {
  type ConversationPermissions,
  type MessagePermissions,
  type MessageReportPermissions,
} from '@palantir/contracts';
import { type PermissionActor, hasPermission } from '../rbac/index.js';
import { type MessageRecord } from './types.js';
import { type ConversationAudience, canSendMessage, canViewConversation } from './visibility.js';

export function computeConversationPermissions(
  audience: ConversationAudience,
  viewerId: string | null,
): ConversationPermissions {
  return {
    canView: canViewConversation(audience, viewerId),
    canSendMessage: canSendMessage(audience, viewerId),
  };
}

/**
 * Flags einer einzelnen Nachricht.
 *
 * `canDelete` gilt nur dem eigenen, noch nicht gelöschten Beitrag. Ein
 * Moderator löscht nicht hierüber, sondern als Entscheidung zu einer Meldung –
 * sonst gäbe es einen Weg an einer Meldung vorbei und damit einen generellen
 * Zugriff durch die Hintertür.
 *
 * `canReport` gilt nie dem eigenen Beitrag: Sich selbst zu melden erzeugt nur
 * Arbeit in der Moderation.
 */
export function computeMessagePermissions(
  message: MessageRecord,
  viewerId: string | null,
  alreadyReported: boolean,
): MessagePermissions {
  const isDeleted = message.deletedAt !== null;
  const isOwn = viewerId !== null && message.senderId === viewerId;

  return {
    canDelete: isOwn && !isDeleted,
    canReport: viewerId !== null && !isOwn && !isDeleted && !alreadyReported,
  };
}

/**
 * Flags einer Meldung.
 *
 * Sehen darf sie, wer moderiert – und zusätzlich das Konto, das gemeldet hat:
 * Es soll nachsehen können, was aus der eigenen Meldung geworden ist, ohne
 * dafür `message.moderate` zu brauchen. Entscheiden darf nur die Moderation,
 * und nur solange die Meldung offen ist.
 */
export function computeMessageReportPermissions(
  actor: PermissionActor,
  viewerId: string | null,
  report: { readonly reportedById: string; readonly status: string },
): MessageReportPermissions {
  const canModerate = hasPermission(actor, 'message.moderate');

  return {
    canView: canModerate || (viewerId !== null && report.reportedById === viewerId),
    canResolve: canModerate && report.status === 'open',
  };
}
