import { type NotificationServerFrame, isNotificationLiveEventName } from '@palantir/contracts';

/**
 * Reine Bausteine des Live-Kanals der Inbox (Pflichtenheft §5.3).
 *
 * Adresse und Frame-Auswertung stehen bewusst getrennt vom Hook: So sind beide
 * ohne WebSocket und ohne React prüfbar (CLAUDE.md §4) – dasselbe Vorgehen wie
 * bei `backoff.ts` und `consoleBuffer.ts` aus F3.
 */

/**
 * Close-Code des Backends für „nicht angemeldet".
 *
 * Dokumentiert in `notifications.ts` in `@palantir/contracts`; die Zahl steht
 * dort bisher nur im Kommentar und nicht als Konstante, deshalb hier noch
 * einmal (vermerkt unter „Gefundene Punkte" in WORK_STATUS.md). Ein eigener
 * Code aus dem privaten Bereich, damit sich „nicht angemeldet" von „Backend
 * gerade weg" unterscheiden lässt – im zweiten Fall wird erneut verbunden, im
 * ersten nicht.
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/** Abstand zwischen zwei Lebenszeichen, damit Reverse Proxies nicht schließen. */
export const PING_INTERVAL_MS = 30_000;

/**
 * Adresse des Inbox-Kanals.
 *
 * `configured` ist `NEXT_PUBLIC_LIVE_WS_URL` – die Adresse des Server-Kanals
 * (`…/live`). Der Inbox-Kanal hängt als eigener Pfad darunter, deshalb wird sie
 * nur ergänzt und nicht ein zweiter Umgebungswert eingeführt.
 */
export function notificationChannelUrl(configured: string | undefined, apiBaseUrl: string): string {
  if (configured) {
    return `${configured.replace(/\/+$/, '')}/notifications`;
  }

  return `${apiBaseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/live/notifications`;
}

/**
 * Frame des Backends aus einer empfangenen Nachricht lesen; `null`, wenn sie
 * nicht zu diesem Kanal gehört.
 *
 * Fremde oder beschädigte Nachrichten werden verworfen statt beantwortet – ein
 * Fehler-Frame gäbe nur Auskunft über das erwartete Format (dieselbe Haltung
 * wie im Backend, `live.ts` in B6).
 */
export function parseNotificationFrame(raw: string): NotificationServerFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as { kind?: unknown; event?: unknown; data?: unknown };

  if (candidate.kind === 'pong') {
    return parsed as NotificationServerFrame;
  }

  if (candidate.kind === 'subscribed') {
    const data = candidate.data as { unreadCount?: unknown } | undefined;
    return typeof data?.unreadCount === 'number' ? (parsed as NotificationServerFrame) : null;
  }

  if (candidate.kind !== 'event') return null;
  if (typeof candidate.event !== 'string' || !isNotificationLiveEventName(candidate.event)) {
    return null;
  }

  const data = candidate.data as { notification?: unknown; unreadCount?: unknown } | undefined;
  if (typeof data?.unreadCount !== 'number') return null;
  if (typeof data.notification !== 'object' || data.notification === null) return null;

  return parsed as NotificationServerFrame;
}
