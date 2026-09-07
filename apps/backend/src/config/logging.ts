/**
 * Aufbereitung der Log-Zeilen des Fastify-Loggers (Audit W3-9;
 * security-matrix-09, backend-auth-08).
 *
 * Zwei Dinge sollen nicht ins Log geraten:
 *
 * 1. **Query-Parameter.** Der OAuth-Rücklauf `/auth/:provider/callback` trägt
 *    den Autorisierungscode und den `state` in der URL, bei Steam zusätzlich
 *    die signierte OpenID-Assertion samt SteamID. Fastify protokolliert zu
 *    jedem Request eine Zeile „incoming request" mit `req.url` – **inklusive**
 *    Query. Der Code ist kurzlebig, aber bis zum Einlösen gültig; wer die Logs
 *    lesen darf, sieht ihn. Auch der Steam-Web-API-Key, den die Steam-API nur
 *    im Query annimmt (backend-auth-08), fällt darunter.
 * 2. **`Authorization`-Header.** Der Agent meldet sich mit einem Bearer-Token
 *    an; ein Log-Aufruf, der Header mitgibt, würde es mitschreiben.
 *
 * Beides braucht **beide** Mittel, und zwar aus einem technischen Grund:
 * `redact` von pino greift auf dem Ergebnis der Serializer, und der
 * Standard-Serializer von Fastify gibt gar kein Feld `query` aus – die Query
 * steckt als Zeichenkette in `url`. Ein Pfad `req.query` allein liefe also ins
 * Leere. Deshalb schneidet {@link serializeRequestForLog} die Query aus der
 * URL heraus, und {@link LOG_REDACT_PATHS} ist das Netz für alle übrigen
 * Log-Aufrufe, die einen rohen Request, Header oder ein Query-Objekt mitgeben.
 *
 * Reine Werte und Funktionen ohne Fastify- und Umgebungs-Bezug, damit die
 * Schwärzung ohne laufenden Server prüfbar ist (CLAUDE.md §4).
 */

/** Ersatzwert geschwärzter Felder. Deutsch wie die übrigen Log-Meldungen. */
export const LOG_CENSOR = '[geschwaerzt]';

/**
 * Pfade, die pino vor dem Schreiben schwärzt.
 *
 * Absichtlich mehrfach aufgeführt: `redact` wirkt je nach oberstem Schlüssel
 * der Log-Zeile, und die Aufrufer im Bestand geben mal `{ req }`, mal den
 * rohen Node-Request (`{ req: request.raw }`, dann liegen die Header unter
 * `req.raw.headers`) und mal einzelne Objekte mit.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.query',
  'req.raw.query',
  'request.query',
  'query',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.raw.headers.authorization',
  'req.raw.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

/**
 * Ein Request, so weit ihn die Log-Zeile braucht.
 *
 * Strukturell und durchgehend optional beschrieben: Der Serializer bekommt in
 * der Regel den Fastify-Request, bei Fehlerpfaden aber auch den rohen
 * Node-Request – dem fehlen `ip` und `host`.
 */
interface LoggableRequest {
  readonly method?: unknown;
  readonly url?: unknown;
  readonly host?: unknown;
  readonly ip?: unknown;
  readonly headers?: Record<string, unknown>;
  readonly socket?: { readonly remotePort?: unknown } | null;
}

function textOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Serializer für `req` – dieselben Felder wie bei Fastify, nur ohne die Werte
 * der Query.
 *
 * Statt der Werte trägt die Zeile die **Namen** der Parameter (`queryKeys`).
 * Damit bleibt nachvollziehbar, in welcher Form ein Aufruf ankam – etwa ob der
 * OAuth-Rücklauf `code` oder `error` trug –, ohne den Inhalt festzuhalten.
 */
export function serializeRequestForLog(request: unknown): Record<string, unknown> {
  const req = (typeof request === 'object' && request !== null ? request : {}) as LoggableRequest;
  const url = textOrUndefined(req.url);
  const trenner = url?.indexOf('?') ?? -1;
  const headers = req.headers ?? {};
  const socket = req.socket ?? undefined;

  const serialized: Record<string, unknown> = {
    method: textOrUndefined(req.method),
    url: trenner >= 0 && url !== undefined ? url.slice(0, trenner) : url,
    version: textOrUndefined(headers['accept-version']),
    host: textOrUndefined(req.host) ?? textOrUndefined(headers.host),
    remoteAddress: textOrUndefined(req.ip),
    remotePort: typeof socket?.remotePort === 'number' ? socket.remotePort : undefined,
  };

  if (trenner >= 0 && url !== undefined) {
    // `URLSearchParams` versteht die rohe Query samt Mehrfachwerten; die
    // Reihenfolge bleibt die des Aufrufs. Doppelte Namen erscheinen einmal.
    const namen = [...new URLSearchParams(url.slice(trenner + 1)).keys()];

    serialized.queryKeys = [...new Set(namen)];
  }

  return serialized;
}

/**
 * Optionen für den Fastify-Logger.
 *
 * `level` kommt vom Aufrufer (`LOG_LEVEL` aus der zentralen `.env`), damit
 * dieses Modul ohne die Umgebungsprüfung auskommt und im Test direkt gegen
 * einen Speicher-Strom laufen kann.
 */
export function buildLoggerOptions(level: string): {
  level: string;
  redact: { paths: string[]; censor: string };
  serializers: { req: (request: unknown) => Record<string, unknown> };
} {
  return {
    level,
    redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_CENSOR },
    serializers: { req: serializeRequestForLog },
  };
}
