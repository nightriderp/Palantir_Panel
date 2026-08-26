import {
  type ApiErrorBody,
  type ErrorCode,
  defaultMessageForErrorCode,
  isErrorCode,
} from '@palantir/contracts';

/**
 * Übersetzung von API-Fehlern in Anzeigetexte (Pflichtenheft §5.1).
 *
 * Grundregel: **anhand des Fehlercodes übersetzen, nie anhand des Freitexts.**
 * Der `message`-Anteil des Envelope ist für Log und Fehlersuche gedacht und kann
 * technische Details enthalten; die Oberfläche zeigt ausschließlich die hier
 * bzw. im Katalog hinterlegten deutschen Sätze (Lastenheft §4).
 */

/** Meldung, wenn die API gar nicht erst erreichbar war. */
export const NETWORK_ERROR_MESSAGE =
  'Der Server ist gerade nicht erreichbar. Bitte versuche es in einem Moment erneut.';

/** Meldung für einen Fehlercode, den dieses Frontend noch nicht kennt. */
export const UNKNOWN_ERROR_MESSAGE =
  'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es erneut.';

/**
 * Fehler eines API-Aufrufs – entweder mit Code aus dem Katalog oder ohne
 * (Netzwerkabbruch, kaputte Antwort).
 */
export class AuthRequestError extends Error {
  /** Code aus `ERROR_CATALOG`; `null` bei Netzwerk- oder Formatfehlern. */
  readonly code: ErrorCode | null;

  constructor(message: string, code: ErrorCode | null) {
    super(message);
    this.name = 'AuthRequestError';
    this.code = code;
  }
}

/**
 * Anzeigetext zu einem Fehlercode.
 *
 * Die Fallback-Meldungen im Katalog sind bereits deutsch und für die Oberfläche
 * formuliert – sie werden hier bewusst wiederverwendet, statt einen zweiten,
 * mitwachsenden Satz an Übersetzungen zu pflegen. Ein Code, den dieses Frontend
 * noch nicht kennt (weil das Backend neuer ist), landet auf einer allgemeinen
 * Meldung statt auf einer leeren Zeile.
 */
export function messageForErrorCode(code: string): string {
  return isErrorCode(code) ? defaultMessageForErrorCode(code) : UNKNOWN_ERROR_MESSAGE;
}

/** Anzeigetext zum Fehlerteil eines Response-Envelope. */
export function messageForApiError(error: ApiErrorBody): string {
  return messageForErrorCode(error.code);
}

/** Anzeigetext zu einem beliebigen geworfenen Fehler. */
export function messageForThrown(error: unknown): string {
  if (error instanceof AuthRequestError) {
    return error.code === null ? error.message : messageForErrorCode(error.code);
  }
  return UNKNOWN_ERROR_MESSAGE;
}

/**
 * Fehler, nach denen die Anmeldung von vorn beginnen muss.
 *
 * Nur beim abgelaufenen Zwischen-Token: der Nutzer kann keinen neuen Code
 * eingeben, weil das Backend den ersten Schritt vergessen hat. Ein *falscher*
 * Code lässt den zweiten Schritt dagegen offen (Pflichtenheft §7).
 */
export function shouldRestartLogin(code: ErrorCode | null): boolean {
  return code === 'AUTH_TWO_FACTOR_EXPIRED';
}

/**
 * Fehler, bei denen ein sofortiger neuer Versuch nichts bringt.
 *
 * Die Formulare sperren dann ihre Absende-Schaltfläche nicht dauerhaft, weisen
 * aber darauf hin, dass Warten (Rate-Limit) bzw. ein Administrator (Sperre)
 * nötig ist.
 */
export function isBlockingError(code: ErrorCode | null): boolean {
  return code === 'AUTH_ACCOUNT_BANNED' || code === 'AUTH_RATE_LIMITED';
}
