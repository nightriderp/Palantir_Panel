/**
 * Benennungsschema für WebSocket-Events (Pflichtenheft §5.3 und §14).
 *
 * Schema: `<domäne>.<vorgang>`
 *   - beide Segmente in lowerCamelCase, genau ein Punkt als Trenner
 *   - Domäne im Singular (`server`, `backup`, `user`, `message`, `resource`)
 *   - Vorgang als abgeschlossenes Ereignis, meist Partizip (`started`, `failed`,
 *     `triggered`, `registered`, `reported`); Zustandsbeschreibungen wie `low`
 *     nur dort, wo kein Vorgang, sondern ein erreichter Schwellwert gemeldet wird
 *
 * Neue Events werden ausschließlich nach diesem Muster ergänzt (Entwicklungsregeln §5)
 * und zusätzlich im Katalog in Pflichtenheft §14 nachgetragen (Entwicklungsregeln §8).
 * Diese Liste enthält bewusst nur die im Pflichtenheft bereits genannten Namen.
 */

/** Formregel des Schemas auf Typ-Ebene. */
export type EventNameScheme = `${string}.${string}`;

export const WEBSOCKET_EVENTS = [
  'server.started',
  'server.stopped',
  'server.crashed',
  // Live-Kanal Browser <-> Backend (F3, siehe `server-live.ts`). Anders als die
  // Meldungen darüber lösen diese Ereignisse keine Benachrichtigung aus – sie
  // halten nur eine offene Ansicht aktuell.
  'server.statusChanged',
  'server.statsUpdated',
  'server.consoleLineAppended',
  'serverClone.progressed',
  'backup.progressed',
  'backupRestore.progressed',
  'backup.failed',
  'autoShutdown.triggered',
  'resource.low',
  'user.registered',
  'message.reported',
  /**
   * Ein Konto hat den Betreiber um mehr Kontingent oder um Kapazität gebeten
   * (Mockup-Abgleich 12.3.1).
   *
   * Bis hierher entstand die Anfrage still in der Datenbank: Sie stand auf der
   * Admin-Seite, bis jemand sie aufrief. Wer fragt, wartet aber auf eine
   * Antwort – und wer entscheidet, kann nicht raten, dass etwas offen ist.
   */
  'quotaRequest.created',

  /**
   * Ein Konto wünscht sich ein Spiel, das es im Panel nicht gibt
   * (Betreiber, 19.09.2026).
   *
   * Dieselbe Begründung wie oben: Der Wunsch entstünde sonst still in der
   * Datenbank, und wer fragt, wartet auf eine Antwort.
   */
  'gameRequest.created',

  /**
   * Ein Konto hat ein Abzeichen freigeschaltet (Betreiber-Wunsch 21.09.2026).
   *
   * Die Meldung geht ausschließlich an den, der es geschafft hat – sie ist ein
   * Glückwunsch, keine Nachricht an die Runde. Wer sie nicht will, schaltet
   * die Vorgaberegel ab; deshalb läuft sie über die Benachrichtigungen und
   * nicht als fest verdrahteter Hinweis in der Oberfläche.
   */
  'achievement.unlocked',

  // -- Server-Orchestrierung (B3, Pflichtenheft §9 und §13) -------------------

  /** Server-Datensatz angelegt und Container auf dem Homeserver erzeugt. */
  'server.created',
  /** Server samt Container, DNS-Eintrag und Portzuweisung entfernt. */
  'server.deleted',
  /** Neustart abgeschlossen – der Server ist wieder erreichbar. */
  'server.restarted',
  /**
   * Server ist in den Zustand `error` gelaufen: Start endgültig gescheitert
   * oder Crash-Loop-Schutz hat abgeschaltet (Pflichtenheft §9). Bewusst
   * getrennt von `server.crashed` – ein einzelner Absturz wird automatisch
   * behoben, dieses Ereignis verlangt, dass jemand hinsieht.
   */
  'server.failed',
  /** Klonen abgeschlossen; der geklonte Server ist angelegt. */
  'server.cloned',
  /**
   * Besitzer eines Servers gewechselt (Pflichtenheft §7). Wie `server.created`
   * Listen-Ereignis des Live-Kanals **und** Meldungsanlass: Der alte Besitzer
   * verliert den Server aus seiner Übersicht, der neue bekommt ihn und soll es
   * erfahren. Wer den Wechsel veranlasst hat, steht im Audit-Log.
   */
  'server.ownerTransferred',
  // Den Zustandswechsel meldet bereits `server.statusChanged` weiter oben, den
  // Fortschritt beim Klonen `serverClone.progressed` – beide aus F3.

  // -- Notification-Engine (B6, Pflichtenheft §14) ---------------------------

  /**
   * Systemweite Ankündigung durch einen Admin veröffentlicht, z. B. ein
   * Wartungshinweis (Lastenheft §3.6). Ein Auslöser wie jeder andere: Die
   * Regeln entscheiden über Inbox und externen Kanal.
   */
  'announcement.published',
  /**
   * Neue Meldung in der Inbox eines Kontos. Reines Live-Ereignis des
   * Browser-Kanals (§5.3, `notifications.ts`) – es hält eine offene Inbox
   * aktuell und ist selbst **kein** Anlass für eine `NotificationRule`,
   * sonst löste jede Zustellung die nächste aus.
   */
  'notification.created',

  // -- Chat & Moderation (B7, Pflichtenheft §15, siehe `chat.ts`) -------------
  // Reine Live-Ereignisse des Chat-Kanals: Sie halten eine offene Ansicht
  // aktuell und sind – wie die Live-Ereignisse der Server-Ansicht – bewusst
  // kein Anlass für eine `NotificationRule`. Anlass für eine Benachrichtigung
  // ist allein `message.reported` weiter oben.

  /** Neue Nachricht in einer Konversation, an der der Empfänger teilnimmt. */
  'message.sent',
  /** Nachricht entfernt – vom Absender selbst oder als Folge einer Meldung. */
  'message.deleted',
  /** Konversation ist für den Empfänger neu sichtbar (erste DM, neuer Server-Chat). */
  'conversation.created',
  /**
   * Ein Konto hat eine Konversation als gelesen markiert (Gefundener Punkt 95).
   * Reines Live-Ereignis des Chat-Kanals: Es wird ausschließlich an die
   * Verbindungen desselben Kontos zugestellt und hält dessen Ungelesen-Zähler
   * geräteübergreifend konsistent – kein Anlass für eine `NotificationRule`.
   */
  'conversation.read',
] as const satisfies readonly EventNameScheme[];

/** Alle aktuell definierten Event-Namen. */
export type WebSocketEventName = (typeof WEBSOCKET_EVENTS)[number];

export function isWebSocketEventName(value: string): value is WebSocketEventName {
  return (WEBSOCKET_EVENTS as readonly string[]).includes(value);
}
