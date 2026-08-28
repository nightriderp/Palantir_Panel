import { type ChatServerEventFrame, isChatEventName } from '@palantir/contracts';

/**
 * Reine Bausteine des Chat-Live-Kanals (Pflichtenheft §5.3, Arbeitspaket B7).
 *
 * Adresse und Frame-Auswertung stehen bewusst getrennt vom React-Hook: So sind
 * beide ohne WebSocket prüfbar (CLAUDE.md §4) – dasselbe Vorgehen wie bei
 * `notificationChannel.ts` (F6) und `backoff.ts` (F3).
 *
 * **Kein `subscribe`, kein `pong`.** Anders als der Inbox-Kanal schickt der
 * Chat-Kanal nur `event`-Frames: Die Verbindung gehört einem Konto, und das
 * Backend stellt darüber die Ereignisse **aller** Konversationen zu, an denen
 * das Konto teilnimmt (siehe `live.ts` in B7). Der Browser sendet hierüber
 * nichts – gesendet wird über REST.
 */

/**
 * Close-Code des Backends für „nicht angemeldet".
 *
 * Dieselbe Zahl wie beim Inbox-Kanal (B6) und beim Agent-Kanal (B3); im
 * Chat-Backend als Argument von `socket.close(4401, …)` in `routes.ts`. Ein
 * eigener Code aus dem privaten Bereich, damit sich „nicht angemeldet" von
 * „Backend gerade weg" unterscheiden lässt – im zweiten Fall wird erneut
 * verbunden, im ersten nicht. (Dass diese Zahl an mehreren Stellen erneut
 * hingeschrieben wird, ist als „Gefundener Punkt" 91 notiert.)
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/** Abstand zwischen zwei Lebenszeichen, damit Reverse Proxies nicht schließen. */
export const PING_INTERVAL_MS = 30_000;

/**
 * Adresse des Chat-Kanals.
 *
 * `configured` ist `NEXT_PUBLIC_LIVE_WS_URL` – die Adresse des Server-Kanals
 * (`…/live`). Der Chat-Kanal hängt als eigener Pfad darunter (`…/live/chat`
 * bzw. `…/api/chat/live`), deshalb wird sie nur ergänzt und kein zweiter
 * Umgebungswert eingeführt (analog `notificationChannelUrl` in F6).
 */
export function chatChannelUrl(configured: string | undefined, apiBaseUrl: string): string {
  if (configured) {
    return `${configured.replace(/\/+$/, '')}/chat`;
  }

  return `${apiBaseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/api/chat/live`;
}

/**
 * Frame des Backends aus einer empfangenen Nachricht lesen; `null`, wenn sie
 * nicht zu diesem Kanal gehört oder beschädigt ist.
 *
 * Fremde oder unvollständige Nachrichten werden verworfen statt beantwortet –
 * ein Fehler-Frame gäbe nur Auskunft über das erwartete Format (dieselbe
 * Haltung wie im Backend, `live.ts` in B7).
 */
export function parseChatFrame(raw: string): ChatServerEventFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { kind?: unknown; event?: unknown; data?: unknown };

  if (candidate.kind !== 'event') return null;
  if (typeof candidate.event !== 'string' || !isChatEventName(candidate.event)) {
    return null;
  }
  if (typeof candidate.data !== 'object' || candidate.data === null) return null;

  return parsed as ChatServerEventFrame;
}
