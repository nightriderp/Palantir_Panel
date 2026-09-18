/**
 * Empfängerauflösung: Ereignis + Empfängerkreis → Konto-Ids.
 *
 * Zwei der vier Kreise aus Lastenheft §3.6 stecken bereits in der Nutzlast des
 * Ereignisses (`resourceOwner`, `serverMembers`) und brauchen keinen
 * Datenbankzugriff. Nur `role` und `allUsers` fragen das
 * {@link RecipientDirectory}. Diese Trennung steht hier als reine Funktion,
 * damit sie ohne Datenbank prüfbar bleibt (Entwicklungsregeln §4).
 */

import type { NotificationEvent, NotificationRecipientScope } from '@palantir/contracts';
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

  // Beim Besitzerwechsel steht der alte Besitzer neben den Mitgliedern in der
  // Nutzlast (B3) – `serverMembers` erreicht damit beide Seiten,
  // `resourceOwner` nur den neuen Besitzer.
  switch (input.event) {
    case 'server.created':
    case 'server.started':
    case 'server.stopped':
    case 'server.restarted':
    case 'server.crashed':
    case 'server.failed':
    case 'server.cloned':
    case 'server.deleted':
    case 'server.ownerTransferred':
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
     * Diese vier Ereignisse haben keinen Besitzer: Eine neue Registrierung, eine
     * gemeldete Nachricht, eine systemweite Ankündigung und eine Anfrage an den
     * Betreiber gehören keiner Ressource eines einzelnen Nutzers. Regeln darauf
     * nutzen `role` oder `allUsers`.
     *
     * Bei der Anfrage ist das besonders zu betonen: Der Antragsteller steht
     * zwar in der Nutzlast, aber er ist nicht der Empfänger – er hat sie
     * gestellt. Sie an ihn zuzustellen hieße, ihm seine eigene Bitte in die
     * Inbox zu legen.
     */
    case 'user.registered':
    case 'message.reported':
    case 'announcement.published':
    case 'quotaRequest.created':
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

  /*
   * Der Besitzer zaehlt zu jedem Rollen-Kreis dazu (Fundpunkt 296).
   *
   * `User.isOwner` liegt ausserhalb des Rollensystems und garantiert immer alle
   * Rechte (Pflichtenheft §6). Ein Besitzer traegt deshalb typischerweise gar
   * keine Rolle - auf dieser Instanz die Rolle „Gast". Die Vorgaberegeln der
   * Ersteinrichtung richten sich aber an die Rolle „Admin", und so erreichte
   * eine neue Registrierung niemanden: Die einzige Person, die freischalten
   * kann, stand nicht in der Empfaengerliste. Gemeldet vom Betreiber am
   * 16.09.2026 („ich kriege keine Benachrichtigung, wenn jemand eine Anfrage
   * schickt"); die Datenbank bestaetigte es - Regel vorhanden, Rolle „Admin"
   * ohne ein einziges Mitglied.
   *
   * Bewusst fuer JEDE Rollen-Regel, nicht nur fuer die der Verwaltung: Der
   * Besitzer darf alles, was eine Rolle duerfen koennte. Wem das zu viel ist,
   * bestellt das Ereignis in seinen persoenlichen Einstellungen ab - dieser Weg
   * steht ihm offen, der umgekehrte (nie erfahren, dass etwas offen ist) nicht.
   */
  const [mitRolle, besitzer] = await Promise.all([
    directory.listUserIdsWithRole(roleId),
    directory.listOwnerUserIds(),
  ]);

  return [...new Set([...mitRolle, ...besitzer])];
}
