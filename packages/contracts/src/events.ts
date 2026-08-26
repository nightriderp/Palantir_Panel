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
 * Neue Events werden ausschließlich nach diesem Muster ergänzt (CLAUDE.md §5)
 * und zusätzlich im Katalog in Pflichtenheft §14 nachgetragen (CLAUDE.md §8).
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
  'backup.failed',
  'autoShutdown.triggered',
  'resource.low',
  'user.registered',
  'message.reported',

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
  // Den Zustandswechsel meldet bereits `server.statusChanged` weiter oben, den
  // Fortschritt beim Klonen `serverClone.progressed` – beide aus F3.
] as const satisfies readonly EventNameScheme[];

/** Alle aktuell definierten Event-Namen. */
export type WebSocketEventName = (typeof WEBSOCKET_EVENTS)[number];

export function isWebSocketEventName(value: string): value is WebSocketEventName {
  return (WEBSOCKET_EVENTS as readonly string[]).includes(value);
}
