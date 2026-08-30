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
 *  - Fehler mit bekanntem Katalog-Code → dieser Code samt HTTP-Status
 *  - alles Übrige                    → `INTERNAL_ERROR` (500), nichtssagend nach
 *                                      außen; der echte Fehler bleibt im Log.
 */

import { type ErrorCode, fail, httpStatusForErrorCode, isErrorCode } from '@palantir/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/**
 * Liest einen gültigen Katalog-Code aus einem Fehler, falls er einen trägt.
 *
 * Die fachlichen Fehlerklassen des Backends (`AdminError`, `RbacError`,
 * `ServerOrchestrationError`, ...) tragen alle ein `code`-Feld aus dem
 * gemeinsamen Katalog. Fällt einer davon ausnahmsweise bis hierher durch, wird
 * er mit seinem eigenen Status beantwortet statt pauschal als 500 – das bleibt
 * eine fachliche Antwort. `INTERNAL_ERROR` selbst zählt hier nicht als
 * „bekannter Code": es ist ausschließlich das Ergebnis dieses Handlers, kein am
 * Aufrufort geworfener Fehler.
 */
function knownErrorCodeOf(error: unknown): ErrorCode | null {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    const { code } = error as { code: string };

    if (code !== 'INTERNAL_ERROR' && isErrorCode(code)) {
      return code;
    }
  }

  return null;
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
 * Registriert den globalen Fehler-Handler auf der Fastify-Instanz.
 *
 * Bewusst als eigene Funktion, damit `buildServer` schlank bleibt und der
 * Handler in Tests einzeln geprüft werden kann.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ZodError) {
      await reply
        .status(httpStatusForErrorCode('VALIDATION_FAILED'))
        .send(fail('VALIDATION_FAILED', describeValidationError(error)));

      return;
    }

    const knownCode = knownErrorCodeOf(error);

    if (knownCode) {
      // Fachlicher Fehler, der ausnahmsweise nicht in der Route abgefangen
      // wurde. Auf Warn-Ebene festgehalten – kein Serverdefekt, aber ein Hinweis
      // auf eine Route ohne eigene Übersetzung.
      request.log.warn(
        { err: error, code: knownCode },
        'Fachlicher Fehler erst vom globalen Handler abgefangen',
      );
      await reply
        .status(httpStatusForErrorCode(knownCode))
        .send(fail(knownCode, error instanceof Error ? error.message : undefined));

      return;
    }

    // Unerwarteter Fehler: vollständig ins Server-Log (inkl. Stacktrace über
    // `err`), aber nichtssagend nach außen – keine Interna an den Aufrufer
    // (Pflichtenheft §7).
    request.log.error({ err: error }, 'Unerwarteter Fehler – als INTERNAL_ERROR beantwortet');
    await reply.status(httpStatusForErrorCode('INTERNAL_ERROR')).send(fail('INTERNAL_ERROR'));
  });
}
