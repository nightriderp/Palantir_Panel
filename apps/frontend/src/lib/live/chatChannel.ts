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
 * **Provisorium (Finding frontend-lib-10).** Dieselbe Zahl wie beim Inbox-Kanal
 * (B6) und beim Agent-Kanal (B3); das Chat-Backend führt sie als
 * `CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED` in `modules/chat/live.ts` – ebenfalls
 * lokal. Der Vertrag kennt bislang nur `NOTIFICATION_LIVE_CLOSE_CODE_UNAUTHORIZED`
 * für den Inbox-Kanal; ihn hier zu verwenden hieße, den Chat an die Konstante
 * eines fremden Kanals zu binden (ändert sie sich, folgt das Chat-Backend nicht
 * mit). Solange `@palantir/contracts` keine gemeinsame Konstante für alle
 * Live-Kanäle führt, bleibt der Wert deshalb hier stehen – der Test in
 * `chatChannel.test.ts` hält beide Zahlen aneinander, damit ein Auseinanderlaufen
 * auffällt. Ein eigener Code aus dem privaten Bereich, damit sich „nicht
 * angemeldet" von „Backend gerade weg" unterscheiden lässt – im zweiten Fall
 * wird erneut verbunden, im ersten nicht.
 */
export const CLOSE_CODE_UNAUTHORIZED = 4401;

/** Abstand zwischen zwei Lebenszeichen, damit Reverse Proxies nicht schließen. */
export const PING_INTERVAL_MS = 30_000;

/**
 * Pfad, unter dem das Backend den Chat-Kanal registriert
 * (`apps/backend/src/modules/chat/routes.ts`).
 *
 * Anders als der Inbox-Kanal hängt der Chat **nicht** unter `…/live`, sondern
 * liegt bei den übrigen Chat-Routen unter `/api/chat`.
 */
const CHAT_LIVE_PATH = '/api/chat/live';

/**
 * Adresse des Chat-Kanals.
 *
 * `configured` ist `NEXT_PUBLIC_LIVE_WS_URL` – die Adresse des Server-Kanals
 * (`…/live`), also der vollständige Endpunkt, nicht nur der Ursprung. Der
 * Chat-Kanal liegt daneben und **nicht** darunter: Das Backend registriert
 * ausschließlich {@link CHAT_LIVE_PATH}.
 *
 * Zuvor wurde hier `…/live/chat` gebildet – ein Pfad, den es im Backend nie gab
 * (Finding contract-drift-02). Wer die Variable setzte, bekam einen Handshake,
 * der still scheiterte: kein Eintrag im Backend-Log (die Anfrage erreichte keine
 * Route), kein Hinweis im Frontend, dafür endloses Wiederverbinden und eine
 * Ansicht, die dauerhaft „Wird verbunden" zeigte. Deshalb wird ein
 * abschließendes `/live` abgeschnitten und der tatsächliche Pfad angehängt; ein
 * etwaiges Präfix des Reverse Proxy bleibt dabei erhalten. Ein zweiter
 * Umgebungswert wird bewusst nicht eingeführt – der Ursprung ist derselbe.
 */
export function chatChannelUrl(configured: string | undefined, apiBaseUrl: string): string {
  if (configured) {
    const ohneSchraegstrich = configured.replace(/\/+$/, '');

    // Wer die Variable schon auf den Chat-Kanal selbst gesetzt hat, bekommt sie
    // unverändert zurück statt eines doppelt angehängten Pfades.
    if (ohneSchraegstrich.endsWith(CHAT_LIVE_PATH)) return ohneSchraegstrich;

    return `${ohneSchraegstrich.replace(/\/live$/, '')}${CHAT_LIVE_PATH}`;
  }

  return `${apiBaseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}${CHAT_LIVE_PATH}`;
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
