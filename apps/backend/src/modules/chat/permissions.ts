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
 *
 * **Gelöschtes Absender-Konto** (Fundpunkt 141): `senderId` ist dann `null` und
 * `isOwn` damit nie wahr – beide Kennungen werden ausdrücklich gegen `null`
 * geprüft, bevor sie verglichen werden. Ohne diese Prüfung träfen sich zwei
 * `null` bei einem Betrachter ohne Konto und machten jede Nachricht eines
 * gelöschten Kontos zu seinem eigenen Beitrag – mit `canDelete: true`. Melden
 * bleibt dagegen möglich: Der Text steht weiter im Verlauf und kann weiter
 * verletzend sein; die Entscheidung eines Moderators richtet sich ohnehin gegen
 * die Nachricht, nicht gegen ein Konto.
 */
export function computeMessagePermissions(
  message: MessageRecord,
  viewerId: string | null,
  alreadyReported: boolean,
): MessagePermissions {
  const isDeleted = message.deletedAt !== null;
  const isOwn = viewerId !== null && message.senderId !== null && message.senderId === viewerId;

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
 *
 * Ist das Melder-Konto gelöscht (`reportedById === null`, Fundpunkt 141), bleibt
 * die Meldung für die Moderation sichtbar und für alle anderen unsichtbar – aus
 * demselben Grund wie oben: Zwei `null` dürfen sich nicht treffen und niemanden
 * zum Melder einer fremden Meldung machen.
 */
export function computeMessageReportPermissions(
  actor: PermissionActor,
  viewerId: string | null,
  report: { readonly reportedById: string | null; readonly status: string },
): MessageReportPermissions {
  const canModerate = hasPermission(actor, 'message.moderate');
  const isReporter =
    viewerId !== null && report.reportedById !== null && report.reportedById === viewerId;

  return {
    canView: canModerate || isReporter,
    canResolve: canModerate && report.status === 'open',
  };
}
