/**
 * Empfängerauflösung: Ereignis + Empfängerkreis → Konto-Ids.
 *
 * Zwei der vier Kreise aus Lastenheft §3.6 stecken bereits in der Nutzlast des
 * Ereignisses (`resourceOwner`, `serverMembers`) und brauchen keinen
 * Datenbankzugriff. Nur `role` und `allUsers` fragen das
 * {@link RecipientDirectory}. Diese Trennung steht hier als reine Funktion,
 * damit sie ohne Datenbank prüfbar bleibt (CLAUDE.md §4).
 */

import type {
  NotificationEvent,
  NotificationRecipientScope,
} from '@palantir/contracts';
import type { RecipientDirectory } from './ports.js';

/**
 * Empfänger, die schon in der Nutzlast stehen.
 *
 * Rückgabe `null` bedeutet: Dieser Kreis lässt sich nicht aus der Nutzlast
 * beantworten und braucht das Verzeichnis. Bewusst getrennt von der leeren
 * Liste – „niemand" und „weiß ich hier nicht" sind verschiedene Antworten.
 */
export function directRecipientsOf(
  input: NotificationEvent,
  scope: NotificationRecipientScope,
): string[] | null {
  if (scope === 'role' || scope === 'allUsers') {
    return null;
  }

  switch (input.event) {
    case 'server.created':
    case 'server.started':
    case 'server.stopped':
    case 'server.restarted':
    case 'server.crashed':
    case 'server.failed':
    case 'server.cloned':
    case 'server.deleted':
    case 'autoShutdown.triggered':
      return scope === 'serverMembers'
        ? [input.payload.ownerId, ...input.payload.memberUserIds]
        : [input.payload.ownerId];

    /*
     * Ein fehlgeschlagenes Backup kennt nur den Besitzer des Servers. Die
     * Mitverwalter stehen nicht in der Nutzlast, weil B5 sie für den Vorgang
     * selbst nicht braucht; `serverMembers` trifft hier deshalb denselben
     * Kreis wie `resourceOwner` statt eine zweite Abfrage zu erzwingen.
     */
    case 'backup.failed':
      return [input.payload.ownerId];

    /*
     * `resource.low` hat nur bei `scope: 'server'` einen Besitzer. Die
     * Node-Warnung gehört niemandem – für sie ist `role` (etwa „alle Admins")
     * der richtige Empfängerkreis.
     */
    case 'resource.low':
      return input.payload.ownerId === null ? [] : [input.payload.ownerId];

    /*
     * Diese drei Ereignisse haben keinen Besitzer: Eine neue Registrierung, eine
     * gemeldete Nachricht und eine systemweite Ankündigung gehören keiner
     * Ressource eines einzelnen Nutzers. Regeln darauf nutzen `role` oder
     * `allUsers`.
     */
    case 'user.registered':
    case 'message.reported':
    case 'announcement.published':
      return [];

    default: {
      const exhaustive: never = input;

      throw new Error(
        `Kein Empfängerkreis für das Ereignis ${JSON.stringify(exhaustive)} hinterlegt.`,
      );
    }
  }
}

/**
 * Vollständige Empfängerliste zu einem Ereignis und einem Empfängerkreis.
 *
 * Doppelte Ids fallen weg: Besitzer und Mitverwalter können sich überschneiden,
 * und niemand soll dieselbe Meldung zweimal in der Inbox haben.
 */
export async function resolveRecipients(
  input: NotificationEvent,
  scope: NotificationRecipientScope,
  roleId: string | null,
  directory: RecipientDirectory,
): Promise<string[]> {
  const direct = directRecipientsOf(input, scope);

  if (direct !== null) {
    return [...new Set(direct)];
  }

  if (scope === 'allUsers') {
    return [...new Set(await directory.listActiveUserIds())];
  }

  /*
   * `role` ohne Rolle kann nicht entstehen: Die Eingabe-Schemas lehnen das ab
   * und die Regel-Verwaltung prüft es erneut. Sollte trotzdem ein alter
   * Datensatz so aussehen, trifft die Regel niemanden – bewusst still statt mit
   * einem Fehler, der den auslösenden Vorgang gefährdet.
   */
  if (roleId === null) {
    return [];
  }

  return [...new Set(await directory.listUserIdsWithRole(roleId))];
}
