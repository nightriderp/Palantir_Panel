/**
 * `permissions`-Objekte der Notification-Engine (Pflichtenheft §5.2).
 *
 * Kanäle, Regeln und Ankündigungen hängen alle an der einen Permission
 * `notification.manage` aus dem Katalog (Pflichtenheft §8) – es gibt bewusst
 * keine feinere Aufteilung: Wer Regeln ändern darf, entscheidet damit ohnehin,
 * wer welche Meldung bekommt.
 *
 * Die Inbox folgt einer anderen Regel: Sie gehört dem Empfänger. Eine Meldung
 * darf nur lesen, markieren und löschen, wem sie zugestellt wurde – auch ein
 * Admin bekommt hier keinen Fremdzugriff. Das ist dieselbe Zurückhaltung wie
 * bei privaten Nachrichten (Lastenheft §3.6: kein genereller Volleinblick).
 */

import type {
  AnnouncementPermissions,
  NotificationChannelPermissions,
  NotificationPermissions,
  NotificationRulePermissions,
} from '@palantir/contracts';
import { type PermissionActor, computePermissionFlags } from '../rbac/index.js';

export function computeChannelPermissions(actor: PermissionActor): NotificationChannelPermissions {
  return computePermissionFlags<keyof NotificationChannelPermissions>(actor, {
    canView: 'notification.manage',
    canEdit: 'notification.manage',
    canDelete: 'notification.manage',
    canTest: 'notification.manage',
  });
}

export function computeRulePermissions(actor: PermissionActor): NotificationRulePermissions {
  return computePermissionFlags<keyof NotificationRulePermissions>(actor, {
    canView: 'notification.manage',
    canEdit: 'notification.manage',
    canDelete: 'notification.manage',
  });
}

export function computeAnnouncementPermissions(actor: PermissionActor): AnnouncementPermissions {
  return computePermissionFlags<keyof AnnouncementPermissions>(actor, {
    canEdit: 'notification.manage',
    canDelete: 'notification.manage',
  });
}

/**
 * `permissions`-Objekt einer Inbox-Meldung.
 *
 * Bewusst **nicht** über den Permission-Katalog berechnet, sondern über die
 * Empfängerschaft: Eine Meldung ist an genau ein Konto zugestellt, und nur
 * dieses Konto darf sie markieren oder löschen. Ein Admin, der die Meldung
 * eines anderen als gelesen markiert, wäre kein sinnvoller Vorgang – wohl aber
 * eine Möglichkeit, fremde Hinweise verschwinden zu lassen.
 */
export function computeNotificationPermissions(
  viewerId: string,
  recipientId: string,
): NotificationPermissions {
  const isRecipient = viewerId === recipientId;

  return { canMarkRead: isRecipient, canDelete: isRecipient };
}
