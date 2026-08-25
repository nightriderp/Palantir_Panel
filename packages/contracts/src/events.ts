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
  'backup.failed',
  'autoShutdown.triggered',
  'resource.low',
  'user.registered',
  'message.reported',
] as const satisfies readonly EventNameScheme[];

/** Alle aktuell definierten Event-Namen. */
export type WebSocketEventName = (typeof WEBSOCKET_EVENTS)[number];

export function isWebSocketEventName(value: string): value is WebSocketEventName {
  return (WEBSOCKET_EVENTS as readonly string[]).includes(value);
}
