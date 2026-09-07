/**
 * Herkunftsprüfung für WebSocket-Handshakes (Audit W2-5, `security-matrix-04`).
 *
 * WebSocket-Handshakes unterliegen **nicht** CORS: Der Browser öffnet
 * `wss://api.<domain>/...` von jeder Seite aus und schickt die Sitzungs-Cookies
 * mit, sofern `SameSite` das zulässt. Damit hing der Schutz der drei
 * Browser-Kanäle (`/live`, `/api/chat/live`, `/live/notifications`) allein an
 * `SameSite=Lax` – und für same-site Seiten (die Spiel-Subdomains) an gar
 * nichts. Der übliche Schutz für WebSockets ist eine Herkunfts-Allowlist; genau
 * die steht hier.
 *
 * Bewusst **kein** globaler Hook: Die REST-Routen laufen bereits über
 * `@fastify/cors` und liegen in derselben Fastify-Instanz. Der Wächter wird
 * deshalb je WebSocket-Route als `onRequest` gesetzt.
 *
 * Der Agent-Kanal (`/agent`) bleibt außen vor: Dort hängt kein Browser, es gibt
 * keine Herkunft, und authentifiziert wird über den Agent-Token.
 */

import { fail } from '@palantir/contracts';
import { type FastifyReply, type FastifyRequest } from 'fastify';

/**
 * Reduziert eine Adresse auf Schema + Host + Port.
 *
 * `null`, wenn der Wert keine Adresse ist – der Aufrufer entscheidet dann, ob
 * das ein Konfigurationsfehler (nicht aussperren) oder eine fremde Herkunft
 * (ablehnen) ist.
 */
function toOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Darf ein Handshake mit dieser Herkunft den Kanal öffnen?
 *
 * - `allowed === undefined`: keine Panel-Adresse konfiguriert – die Prüfung
 *   bleibt aus. Das ist der Entwicklungsfall; im Betrieb setzt `config/env.ts`
 *   `PUBLIC_WEB_URL` immer (notfalls aus `PALANTIR_DOMAIN` abgeleitet).
 * - Fehlende Herkunft gilt als fremd: Ein Browser schickt bei einem
 *   WebSocket-Handshake **immer** einen `Origin`-Kopf. Fehlt er, kommt der
 *   Aufruf nicht aus einem Browser – und dann braucht er auch keine
 *   Cookie-Sitzung.
 * - Eine unbrauchbar konfigurierte Panel-Adresse sperrt niemanden aus: Sonst
 *   stünde bei einem Tippfehler in der `.env` der komplette Live-Betrieb.
 */
export function isAllowedWebSocketOrigin(
  origin: string | undefined,
  allowed: string | undefined,
): boolean {
  if (allowed === undefined) {
    return true;
  }

  const erwartet = toOrigin(allowed);

  if (erwartet === null) {
    return true;
  }

  if (origin === undefined || origin === 'null') {
    return false;
  }

  return toOrigin(origin) === erwartet;
}

/**
 * `onRequest`-Wächter für eine WebSocket-Route.
 *
 * Abgelehnt wird **vor** dem Upgrade mit dem gewohnten Envelope (Pflichtenheft
 * §5.1) und `PERMISSION_DENIED`/403 – nicht mit einem Close-Code nach dem
 * Handshake. Ein Angreifer bekommt so nie einen offenen Socket in die Hand, und
 * der Fall ist im Zugriffsprotokoll des Reverse Proxy als 403 sichtbar statt
 * als scheinbar erfolgreicher 101er.
 */
export function createWebSocketOriginGuard(
  allowed: string | undefined,
): (request: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | undefined> {
  return async function pruefeHerkunft(request, reply) {
    if (isAllowedWebSocketOrigin(request.headers.origin, allowed)) {
      return undefined;
    }

    request.log.warn(
      { origin: request.headers.origin ?? null, pfad: request.url },
      'WebSocket-Handshake mit fremder Herkunft abgelehnt',
    );

    return reply
      .code(403)
      .send(fail('PERMISSION_DENIED', 'Diese Herkunft darf den Live-Kanal nicht öffnen.'));
  };
}
