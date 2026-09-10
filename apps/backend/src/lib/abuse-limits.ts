/**
 * Missbrauchsgrenzen für **angemeldete** Konten (Audit W2-3,
 * `security-matrix-05`; Pflichtenheft §7 und §18 „Rate-Limiting gegen Spam").
 *
 * **Warum überhaupt.** Bis hierher endete jede Bremse beim Login: Der
 * Zähler aus `modules/auth/rate-limit.ts` lief ausschließlich gegen die IP
 * eines Anmelde- oder Registrierungsversuchs. Wer erst einmal angemeldet und
 * freigeschaltet war, konnte Chat-Nachrichten, Meldungen, Konsolenbefehle,
 * Kontingent-Anfragen und Arcade-Punkte in Schleife absetzen – jede davon mit
 * Datenbankschreiben und Live-Fan-out im Rücken. Für ein Community-Panel mit
 * Griefer-Risiko war das die größte verbleibende DoS-Fläche.
 *
 * **Derselbe Zähler, andere Identität.** Der gleitende Zähler wird nicht neu
 * gebaut, sondern wiederverwendet: {@link createRateLimiter} kennt weder HTTP
 * noch Datenbank, ihm ist gleich, ob im Schlüssel eine IP oder eine Konto-Id
 * steht. Neu ist hier nur der Anschluss an Fastify – ein `preHandler`, der die
 * Konto-Id aus der Sitzung als Identität nimmt. **Je Konto, nicht je IP:** Ein
 * Konto hinter wechselnden Adressen (Mobilfunk, VPN) soll sich nicht
 * freikaufen können, und mehrere Nutzer hinter einer NAT-Adresse sollen sich
 * nicht gegenseitig aussperren.
 *
 * **Warum in `lib/` und nicht im Auth-Modul.** Die Grenzen gelten quer über
 * B3, B7, F8 und die Kontingent-Anfragen. Ein Import aus `modules/auth/index.js`
 * zöge dort jeweils Datenbank und Umgebungsvariablen mit herein; die
 * Zählerdatei selbst ist dagegen ein Blatt ohne eigene Importe. Diese eine
 * Kante hierher ist deshalb billiger als eine Kopie des Zählers.
 *
 * **Warum Konstanten und keine Umgebungsvariablen.** Sechs weitere Schalter in
 * der `.env` wären sechs Möglichkeiten, den Schutz versehentlich abzuschalten,
 * und keine davon hat einen Betriebsfall (CLAUDE.md §8: „lieber feste,
 * begründete Grenzen"). Die Zahlen stehen in {@link ABUSE_LIMITS} mit ihrer
 * Begründung.
 *
 * **Im Arbeitsspeicher, eine Instanz.** Wie beim Login-Zähler: Palantir läuft
 * als eine Backend-Instanz auf einer VPS (Pflichtenheft §1). Ein Neustart setzt
 * die Zähler zurück – das ist hinnehmbar, weil sie Missbrauch bremsen und
 * nicht abrechnen.
 */

import { fail, httpStatusForErrorCode } from '@palantir/contracts';
import type { FastifyRequest, preHandlerHookHandler } from 'fastify';
import {
  type RateLimitDecision,
  createRateLimiter,
  rateLimitKey,
} from '../modules/auth/rate-limit.js';

/**
 * Fehlercode einer überschrittenen Grenze.
 *
 * Seit dem Contracts-Nachzug W2-C2 ein eigener Code (429) statt des geliehenen
 * `AUTH_RATE_LIMITED`. Der zählt Anmelde- und Registrierungsversuche je **IP**;
 * die Oberfläche darf ihn als „warte, bevor du dich erneut anmeldest" lesen.
 * Hier ist der Aufrufer bereits angemeldet und stößt an eine Grenze seines
 * **Kontos** – ihm das Anmeldeformular zu zeigen, wäre die falsche Auskunft.
 */
export const ABUSE_LIMIT_ERROR_CODE = 'RATE_LIMITED' as const;

/** Ein Fenster samt zulässiger Anzahl darin. */
export interface AbuseLimit {
  readonly windowSeconds: number;
  readonly maxAttempts: number;
}

/**
 * Die Grenzen je Vorgang – eine Stelle, an der sie alle sichtbar sind.
 *
 * Bemessen am gutwilligen Extremfall, nicht am Durchschnitt: Jede Zahl soll ein
 * hektisch bedienendes Konto ungeschoren lassen und trotzdem die Schleife
 * stoppen.
 *
 * - `chat.message` – 30/min: Drei Sekunden Abstand im Mittel; schneller tippt
 *   niemand sinnvoll. Bremst den teuersten Pfad (Schreiben + Live-Fan-out an
 *   alle Mitglieder eines Server-Chats).
 * - `chat.report` – 10/h: Melden ist eine Ausnahmehandlung. Wer zehn Meldungen
 *   in einer Stunde absetzt, füllt die Moderationsansicht, statt sie zu nutzen
 *   (`security-matrix-05`, Szenario b).
 * - `server.console` – 60/min: Ein Befehl je Sekunde. Deckt auch das
 *   Durchklicken vorbereiteter Befehle ab; darüber hinaus wäre es
 *   Fernsteuerung des Agents im Takt (`security-matrix-05`, Szenario d).
 * - `quota.request` – 3/Tag: Eine Kontingent-Anfrage wird von Hand beschieden.
 *   Mehr als drei am Tag sind keine Anfrage mehr, sondern eine Warteschlange
 *   für den Administrator.
 * - `arcade.score` – 20/min: Eine Runde dauert Sekunden, nicht Millisekunden.
 *   Hält `arcade_scores` davon ab, im Takt der Schleife zu wachsen
 *   (`backend-community-14`).
 */
export const ABUSE_LIMITS = {
  'chat.message': { windowSeconds: 60, maxAttempts: 30 },
  'chat.report': { windowSeconds: 60 * 60, maxAttempts: 10 },
  'server.console': { windowSeconds: 60, maxAttempts: 60 },
  'quota.request': { windowSeconds: 24 * 60 * 60, maxAttempts: 3 },
  'arcade.score': { windowSeconds: 60, maxAttempts: 20 },
} as const satisfies Record<string, AbuseLimit>;

/** Vorgang, für den eine Grenze gilt. */
export type AbuseLimitScope = keyof typeof ABUSE_LIMITS;

/**
 * Wie viele gezählte Versuche zwischen zwei Aufräumläufen liegen.
 *
 * `consume()` beschneidet immer nur den eigenen Schlüssel; die Einträge von
 * Konten, die nicht wiederkommen, blieben sonst bis zum Neustart liegen. Ein
 * Lauf über alle Schlüssel ist billig, aber nicht umsonst – deshalb nicht bei
 * jedem Aufruf.
 */
const SWEEP_EVERY_ATTEMPTS = 500;

/** Zähler je Konto für genau einen Vorgang. */
export interface AccountRateLimiter {
  /** Zählt einen Versuch des Kontos und entscheidet, ob er ausgeführt werden darf. */
  consume(userId: string, nowMs?: number): RateLimitDecision;
  /** Setzt den Zähler eines Kontos zurück – für Tests und Sonderfälle. */
  reset(userId: string): void;
}

/**
 * Baut den Zähler eines Vorgangs.
 *
 * Der Vorgang steht mit im Schlüssel: Wer sein Melde-Kontingent ausgeschöpft
 * hat, darf weiter Nachrichten schreiben.
 */
export function createAccountRateLimiter(
  scope: AbuseLimitScope,
  limit: AbuseLimit = ABUSE_LIMITS[scope],
): AccountRateLimiter {
  const limiter = createRateLimiter({
    windowSeconds: limit.windowSeconds,
    maxAttempts: limit.maxAttempts,
  });

  let seitAufraeumen = 0;

  return {
    consume(userId, nowMs = Date.now()) {
      seitAufraeumen += 1;

      if (seitAufraeumen >= SWEEP_EVERY_ATTEMPTS) {
        seitAufraeumen = 0;
        limiter.sweep(nowMs);
      }

      return limiter.consume(rateLimitKey(scope, userId), nowMs);
    },

    reset(userId) {
      limiter.reset(rateLimitKey(scope, userId));
    },
  };
}

export interface AccountRateLimitOptions {
  /** Vorgang – bestimmt Fenster, Anzahl und den Schlüsselraum. */
  readonly scope: AbuseLimitScope;
  /**
   * Bereits vorhandener Zähler, wenn ein zweiter Weg denselben Vorgang bremsen
   * soll (Fundpunkt 202: Konsolenbefehl über REST **und** über den Live-Kanal).
   * Ohne Angabe entsteht ein eigener.
   */
  readonly limiter?: AccountRateLimiter;
  /**
   * Konto-Id des Aufrufers aus der Sitzung (B1); `null`, wenn niemand
   * angemeldet ist.
   *
   * Jedes Modul löst das anders auf (`request.authUser`, `request.viewerUserId`,
   * eine eigene Funktion in den Routen-Optionen) – deshalb hereingereicht statt
   * hier geraten.
   */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * `preHandler` für eine Schreibroute: zählt den Aufruf gegen das Konto und
 * antwortet bei Überschreitung mit dem Envelope aus Pflichtenheft §5.1.
 *
 * **Einmal je Route bauen**, nicht je Request – der Zähler steckt im Ergebnis.
 *
 * **Gezählt wird der Versuch, nicht der Erfolg.** Der Guard läuft vor dem
 * Handler; ein Aufruf, der danach fachlich scheitert, ist trotzdem verbraucht.
 * Das ist Absicht: Genau die scheiternden Aufrufe in Schleife sind der
 * Missbrauch, gegen den die Grenze steht.
 *
 * **Ohne Sitzung passiert hier nichts.** Ein anonymer Aufruf hat keine
 * Identität, gegen die sich zählen ließe; er wird von der Route selbst mit
 * `AUTH_REQUIRED` abgewiesen. Diesen Guard hinter `requireApproved()` oder
 * `requirePermission()` hängen, dann fällt er gar nicht erst an.
 */
export function accountRateLimit(options: AccountRateLimitOptions): preHandlerHookHandler {
  const limiter = options.limiter ?? createAccountRateLimiter(options.scope);

  return async function abuseLimitGuard(request, reply): Promise<void> {
    const userId = options.resolveUserId(request);

    if (userId === null) {
      return;
    }

    const decision = limiter.consume(userId);

    if (decision.allowed) {
      return;
    }

    await reply
      .status(httpStatusForErrorCode(ABUSE_LIMIT_ERROR_CODE))
      // Standard-Kopfzeile für 429 – der Browser (und ein Skript) erfährt
      // damit ohne Rumpf, wann der nächste Versuch Sinn hat.
      .header('retry-after', String(decision.retryAfterSeconds))
      .send(
        fail(
          ABUSE_LIMIT_ERROR_CODE,
          `Zu viele Anfragen. Bitte in ${String(decision.retryAfterSeconds)} Sekunden erneut versuchen.`,
        ),
      );
  };
}
