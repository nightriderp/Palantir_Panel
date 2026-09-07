/**
 * Globaler Fastify-Fehler-Handler (Arbeitspaket N6, Gefundener Punkt 97).
 *
 * Sicherheitsnetz für alles, was die Routen **nicht** bewusst abgefangen haben.
 * Die fachlichen Fehler jeder Route werden weiterhin dort übersetzt (z. B.
 * `replyWithError` in den Modulen) – dieser Handler greift nur, wenn ein Fehler
 * bis hierher durchfällt. Ohne ihn serialisiert Fastifys Standard-Handler solche
 * Fehler als `{ statusCode, error, message }` – nicht im Response-Envelope aus
 * Pflichtenheft §5.1 und mit einem Code außerhalb des `ERROR_CATALOG`; ein roher
 * DB- oder Laufzeitfehler könnte dabei Implementierungsdetails nach außen tragen
 * (Pflichtenheft §7).
 *
 * Zuordnung:
 *  - `ZodError`                      → `VALIDATION_FAILED` (400)
 *  - `AppError` (eigene Fehlerklasse) → dessen Code samt HTTP-Status
 *  - Fastify-Fehler mit `statusCode < 500` → dieser Status, Katalog-Code nach
 *                                      Statusklasse, Meldung aus dem Katalog
 *  - alles Übrige                    → `INTERNAL_ERROR` (500), nichtssagend nach
 *                                      außen; der echte Fehler bleibt im Log.
 *
 * Dazu der Not-Found-Handler: Fastify beantwortet unbekannte Routen über einen
 * eigenen Hook, den `setErrorHandler` nie sieht – ohne ihn verlässt die einzige
 * Antwort des Backends das Envelope-Format (Audit W2-9, `backend-core-02`).
 */

import { type ErrorCode, fail, httpStatusForErrorCode } from '@palantir/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { type AppError, isAppError } from './lib/app-error.js';

/**
 * Katalog-Code zu einem HTTP-Status, den Fastify selbst gesetzt hat.
 *
 * Fastify wirft für kaputtes JSON, unbekannte Inhaltstypen oder eine zu große
 * Nutzlast eigene Fehler (`FST_ERR_*`, `@fastify/multipart`), die alle einen
 * `statusCode` tragen. Bisher erkannte der Handler weder Zod noch Katalog-Code
 * und antwortete pauschal mit 500 – ein Aufrufer mit kaputtem Body bekam also
 * „Serverdefekt" gemeldet, und jeder anonyme Versuch erzeugte einen
 * error-Logeintrag samt Stacktrace (Audit W2-9, `backend-core-01`).
 *
 * Abgebildet wird über die **Statusklasse**, nicht über den `FST_*`-Namen: Die
 * Namen sind Fastify-Interna und ändern sich mit dem Framework, der Status
 * gehört zum HTTP-Vertrag. Für Status ohne passenden Katalog-Eintrag (404, 405,
 * 415, ...) bleibt `VALIDATION_FAILED` als „an dieser Anfrage stimmt etwas
 * nicht"; der Status selbst wird davon **nicht** überschrieben.
 */
function catalogCodeForClientStatus(statusCode: number): ErrorCode {
  switch (statusCode) {
    case 401:
      return 'AUTH_REQUIRED';
    case 403:
      return 'PERMISSION_DENIED';
    case 413:
      // Gegenstück zum Upload-Limit des Datei-Managers: `datei.toBuffer()`
      // wirft `FST_REQ_FILE_TOO_LARGE`, bevor der `truncated`-Check der Route
      // greift.
      return 'FILE_TOO_LARGE';
    case 429:
      return 'AUTH_RATE_LIMITED';
    default:
      return 'VALIDATION_FAILED';
  }
}

/**
 * Liest den HTTP-Status eines Fastify-Fehlers, sofern es ein Aufruferfehler ist.
 *
 * `null` für alles ab 500: Ein Serverfehler bleibt ein Serverfehler und wird
 * nichtssagend beantwortet, egal woher er kommt.
 */
function clientStatusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return null;
  }

  const { statusCode } = error as { statusCode: unknown };

  if (typeof statusCode !== 'number' || statusCode < 400 || statusCode >= 500) {
    return null;
  }

  return statusCode;
}

/** Verdichtet die Zod-Fehler zu einer lesbaren Meldung – ohne den Rohbaum auszuliefern. */
function describeValidationError(error: ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

/**
 * Fachliche Fehler behalten ihre eigene Meldung – aber nur sie.
 *
 * `INTERNAL_ERROR` zählt hier nicht als fachlicher Code: Er ist ausschließlich
 * das Ergebnis dieses Handlers, kein am Aufrufort geworfener Fehler. Trägt ein
 * `AppError` ihn trotzdem, wird er wie ein unerwarteter Fehler behandelt.
 */
function businessErrorOf(error: unknown): AppError | null {
  return isAppError(error) && error.code !== 'INTERNAL_ERROR' ? error : null;
}

/**
 * Registriert den globalen Fehler-Handler auf der Fastify-Instanz.
 *
 * Bewusst als eigene Funktion, damit `buildServer` schlank bleibt und der
 * Handler in Tests einzeln geprüft werden kann.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  /*
   * Unbekannte Route: Fastifys Standardantwort ist `{"message":"Route
   * GET:/x not found","error":"Not Found","statusCode":404}` – kein Envelope,
   * und ein Frontend, das `error.code` auswertet, liest `undefined`.
   *
   * Der Status bleibt bewusst 404 (unveränderte HTTP-Semantik), obwohl der
   * Katalog für `VALIDATION_FAILED` 400 führt: Ein allgemeiner `NOT_FOUND`-Code
   * fehlt im Katalog noch – alle vorhandenen 404er benennen einen konkreten
   * Gegenstand (`SERVER_NOT_FOUND`, `USER_NOT_FOUND`, ...) und wären für eine
   * unbekannte Route irreführend. Sobald `packages/contracts` einen
   * gegenstandslosen `NOT_FOUND` führt, gehört er hierher.
   */
  app.setNotFoundHandler(async (_request, reply) => {
    // Ohne den angefragten Pfad in der Meldung: Er käme aus der Anfrage und
    // würde ungefiltert zurückgespiegelt, ohne etwas zu erklären, das der
    // Aufrufer nicht selbst geschickt hat.
    await reply.status(404).send(fail('VALIDATION_FAILED', 'Diese Route existiert nicht.'));
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      await reply
        .status(httpStatusForErrorCode('VALIDATION_FAILED'))
        .send(fail('VALIDATION_FAILED', describeValidationError(error)));

      return;
    }

    const fachlich = businessErrorOf(error);

    if (fachlich) {
      // Fachlicher Fehler, der ausnahmsweise nicht in der Route abgefangen
      // wurde. Auf Warn-Ebene festgehalten – kein Serverdefekt, aber ein Hinweis
      // auf eine Route ohne eigene Übersetzung.
      request.log.warn(
        { err: error, code: fachlich.code },
        'Fachlicher Fehler erst vom globalen Handler abgefangen',
      );
      await reply
        .status(httpStatusForErrorCode(fachlich.code))
        .send(fail(fachlich.code, fachlich.message));

      return;
    }

    const clientStatus = clientStatusOf(error);

    if (clientStatus !== null) {
      /*
       * Fehler des Frameworks über einen Aufruferfehler (kaputtes JSON, falscher
       * Inhaltstyp, zu große Nutzlast). Der Status ist Fastifys eigener, die
       * Meldung kommt aus dem Katalog: Der Originaltext nennt teils Positionen
       * im Rohkörper oder Interna des Parsers und gehört ins Log, nicht in die
       * Antwort (Pflichtenheft §7).
       *
       * Warn statt error: Ein Aufrufer mit kaputtem Body ist kein Serverdefekt –
       * bisher erzeugte jeder anonyme Versuch einen Alarm samt Stacktrace.
       */
      const code = catalogCodeForClientStatus(clientStatus);

      request.log.warn({ err: error, statusCode: clientStatus, code }, 'Fehlerhafte Anfrage');
      await reply.status(clientStatus).send(fail(code));

      return;
    }

    // Unerwarteter Fehler: vollständig ins Server-Log (inkl. Stacktrace über
    // `err`), aber nichtssagend nach außen – keine Interna an den Aufrufer
    // (Pflichtenheft §7). Hierher gehört ausdrücklich auch ein fremder Fehler
    // mit einem `code`-Feld, das zufällig einem Katalog-Namen gleicht: Der
    // Durchgriff hängt an `AppError`, nicht am Namen (`backend-core-03`).
    request.log.error({ err: error }, 'Unerwarteter Fehler – als INTERNAL_ERROR beantwortet');
    await reply.status(httpStatusForErrorCode('INTERNAL_ERROR')).send(fail('INTERNAL_ERROR'));
  });
}
