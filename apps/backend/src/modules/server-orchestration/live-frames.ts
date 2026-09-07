/**
 * **PROVISORIUM** – Frames und Close-Codes des Server-Live-Kanals, die der
 * Vertrag noch nicht kennt (Audit W2-5).
 *
 * `packages/contracts/src/server-live.ts` beschreibt bisher nur `subscribe`,
 * `unsubscribe`, `consoleCommand` (Browser → Backend) und das Ereignis-Frame
 * (Backend → Browser). W2-5 braucht darüber hinaus vier Dinge:
 *
 * - `ping`/`pong`, damit ein Reverse Proxy die stille Verbindung nicht nach
 *   seinem Idle-Timeout schließt (`event-flow-03`),
 * - `resync`, damit der Browser nach einem Wiederanlauf den Ist-Stand bekommt
 *   statt auf das nächste Ereignis zu warten (`event-flow-03`),
 * - `error`, damit ein abgelehnter Konsolenbefehl sichtbar wird statt still zu
 *   verschwinden (`contracts-validation-04`),
 * - die Close-Codes, die `live-route.ts` schon vergibt (4401/4403).
 *
 * Warum nicht in `@palantir/contracts`: CLAUDE.md §6 verlangt für eine
 * Contracts-Änderung einen eigenen, zuerst zu mergenden PR; der Contracts-PR
 * dieser Runde (#238) ist bereits durch. Diese Datei ist deshalb die
 * ausdrücklich als vorläufig markierte Zwischenstufe. **Beim nächsten
 * Contracts-PR gehören alle Angaben hier in `server-live.ts` und diese Datei
 * verschwindet.** Das Gegenstück im Frontend
 * (`apps/frontend/src/lib/live/serverChannel.ts`) trägt denselben Hinweis –
 * beide müssen bis dahin von Hand gleich gehalten werden.
 */

import { type LiveTopic, type ServerStatus } from '@palantir/contracts';

/** Handshake ohne angemeldetes Konto. Bereits vor W2-5 vergeben. */
export const LIVE_CLOSE_CODE_UNAUTHORIZED = 4401;

/** Angemeldet, aber (noch) nicht freigeschaltet bzw. Sitzung entzogen. */
export const LIVE_CLOSE_CODE_FORBIDDEN = 4403;

/**
 * Abstand der wiederkehrenden Abo-Prüfung am offenen Kanal.
 *
 * Derselbe Takt wie die Sitzungsprüfung des Chat-Kanals (60 s): häufig genug,
 * dass ein entferntes Mitglied den Kanal nicht minutenlang weiter mithört, und
 * selten genug, dass die Prüfung (ein Server- und ein Mitglieder-Lesezugriff je
 * Abo) nicht ins Gewicht fällt.
 */
export const SUBSCRIPTION_CHECK_INTERVAL_MS = 60_000;

/**
 * Obergrenze für eine eingehende Nachricht auf `/live`, in Byte.
 *
 * Das größte gültige Frame ist ein Konsolenbefehl: 512 Zeichen laut
 * `consoleCommandSchema`, dazu Rahmen und Thema. 8 KiB lassen dafür reichlich
 * Luft (auch für Mehrbyte-Zeichen) und schneiden trotzdem alles ab, was nur
 * dazu da ist, Arbeitsspeicher zu binden – vor dem JSON-Parsen, nicht danach
 * (`security-matrix-05` nennt das fehlende `maxPayload` gesondert; hier geht es
 * nur um diesen einen Kanal).
 */
export const LIVE_MAX_FRAME_BYTES = 8 * 1024;

/** Lebenszeichen des Browsers. */
export interface ServerLivePingFrame {
  kind: 'ping';
}

/** Antwort darauf. */
export interface ServerLivePongFrame {
  kind: 'pong';
  /** ISO-8601-Zeitstempel des Versands. */
  sentAt: string;
}

/**
 * Ist-Stand direkt nach einem `subscribe`.
 *
 * Der Browser meldet nach jedem Wiederanlauf seine Abos erneut an; bisher
 * bestätigte das Backend nichts und lieferte auch nichts. Wechselte der Server
 * während der Lücke von `starting` nach `running`, blieb die Anzeige auf dem
 * alten Stand, bis zufällig ein weiteres Ereignis kam (`event-flow-03`).
 */
export interface ServerLiveResyncFrame {
  kind: 'resync';
  topic: LiveTopic;
  data: {
    status: ServerStatus;
    statusMessage: string | null;
  };
  /** ISO-8601-Zeitstempel des Versands. */
  sentAt: string;
}

/**
 * Abgelehntes Frame des Browsers.
 *
 * Nur dort, wo das Ausbleiben einer Wirkung sonst unerklärlich wäre – heute
 * ausschließlich beim Konsolenbefehl. Unbekannte oder beschädigte Frames werden
 * weiterhin **kommentarlos** verworfen: Eine Rückmeldung gäbe nur Auskunft über
 * das erwartete Format (dieselbe Haltung wie im Inbox-Kanal).
 */
export interface ServerLiveErrorFrame {
  kind: 'error';
  /** Thema, auf das sich die Ablehnung bezieht; `null`, wenn unlesbar. */
  topic: LiveTopic | null;
  /** Code aus dem Katalog (`packages/contracts/src/errors.ts`), kein Freitext. */
  code: 'VALIDATION_FAILED' | 'PERMISSION_DENIED';
  message: string;
  /** ISO-8601-Zeitstempel des Versands. */
  sentAt: string;
}

/** Alles, was `/live` zusätzlich zum Ereignis-Frame an den Browser schickt. */
export type ServerLiveExtraFrame =
  ServerLivePongFrame | ServerLiveResyncFrame | ServerLiveErrorFrame;
