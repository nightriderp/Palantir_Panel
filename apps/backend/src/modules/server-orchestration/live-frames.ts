/**
 * Betriebsgrößen des Server-Live-Kanals, die **nur** das Backend angehen.
 *
 * Die Frames und Close-Codes des Kanals selbst stehen im Vertrag
 * (`packages/contracts/src/server-live.ts`) – bis dahin lagen sie hier und im
 * Frontend doppelt und mussten von Hand gleich gehalten werden (Audit W2-5).
 * Übrig bleiben zwei Zahlen, die kein Client kennt: Wie oft die Abos am offenen
 * Kanal nachgeprüft werden und wie groß ein eingehendes Frame höchstens sein
 * darf.
 *
 * Die Close-Codes werden hier unter ihrem bisherigen Namen aus dem Vertrag
 * weitergereicht, damit die Aufrufer im Backend (`live-route.ts`, `server.ts`)
 * nicht zwei Namen für dieselbe Zahl kennen müssen.
 */

import {
  SERVER_LIVE_CLOSE_CODE_FORBIDDEN,
  SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED,
} from '@palantir/contracts';

/** Handshake ohne angemeldetes Konto (Vertrag: `server-live.ts`). */
export const LIVE_CLOSE_CODE_UNAUTHORIZED = SERVER_LIVE_CLOSE_CODE_UNAUTHORIZED;

/** Angemeldet, aber (noch) nicht freigeschaltet bzw. Sitzung entzogen. */
export const LIVE_CLOSE_CODE_FORBIDDEN = SERVER_LIVE_CLOSE_CODE_FORBIDDEN;

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
