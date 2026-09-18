import pino, { type Logger } from 'pino';
import type { ConnectionLogger } from './connection/agent-connection.js';

/**
 * Strukturiertes Protokoll des Agents (Review 2026-09-16, Befund 5.2).
 *
 * Bis hierher schrieb der Agent mit `console.*` – lesbar, aber ohne Stufe,
 * ohne Zeitstempel im Datensatz und ohne Schwärzung. Das Backend protokolliert
 * seit dem ersten Tag mit pino (über Fastify); der Agent zieht nach, mit
 * derselben Bibliothek und demselben Zeilenformat, damit `docker logs` auf VPS
 * und Node gleich zu lesen sind und dieselben Werkzeuge greifen.
 *
 * `LOG_LEVEL` kommt aus der zentralen `.env` (Abschnitt „[BEIDE]“) und stand im
 * Schema des Agents schon länger – ausgewertet wurde es erst jetzt. Gelesen
 * wird es hier direkt aus `process.env` und nicht über `config/env.ts`: Das
 * Protokoll wird von Modulen gebraucht, die ohne die volle Agent-Umgebung
 * laufen (Tests der Verbindung, des Zeitgebers) – und `env.ts` verlangt sie.
 *
 * Geschwärzt wird alles, was wie ein Geheimnis heißt: Das Pre-Shared-Token des
 * Agents darf in keiner Zeile stehen, auch nicht in einem Fehlerkontext, der
 * versehentlich die Verbindungsoptionen mitgibt.
 */
const STUFEN = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
const stufe = process.env.LOG_LEVEL;

export const log: Logger = pino({
  level: stufe !== undefined && STUFEN.has(stufe) ? stufe : 'info',
  base: { service: 'agent' },
  redact: {
    paths: ['token', '*.token', 'AGENT_TOKEN', '*.AGENT_TOKEN', 'authorization', '*.authorization'],
    censor: '[geschwärzt]',
  },
});

/** Unterprotokoll für einen Bereich – `bereich` steht in jeder Zeile. */
export function bereich(name: string): Logger {
  return log.child({ bereich: name });
}

/**
 * Brücke zur schmalen Schnittstelle der Verbindung: Dort steht die Meldung
 * vorn und der Kontext dahinter, bei pino umgekehrt.
 */
export function alsConnectionLogger(logger: Logger): ConnectionLogger {
  return {
    debug: (message, details) => logger.debug(details ?? {}, message),
    info: (message, details) => logger.info(details ?? {}, message),
    warn: (message, details) => logger.warn(details ?? {}, message),
    error: (message, details) => logger.error(details ?? {}, message),
  };
}

/** Fehler als Kontextfeld – Meldung und, wenn vorhanden, Stack. */
export function fehlerFeld(fehler: unknown): { fehler: string; stack?: string } {
  if (fehler instanceof Error) {
    return fehler.stack === undefined
      ? { fehler: fehler.message }
      : { fehler: fehler.message, stack: fehler.stack };
  }

  return { fehler: String(fehler) };
}
