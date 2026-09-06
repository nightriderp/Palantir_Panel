/**
 * Geordnetes Beenden und Prozess-Schutz des Backends (Audit W0-5,
 * Fundpunkte 126 und 127, backend-core-08).
 *
 * Zwei Dinge stehen hier, beide ohne Fastify und ohne echten `process`, damit
 * sie prüfbar sind:
 *
 * 1. **Der Shutdown-Ablauf.** Ein Signal schließt die Anwendung geordnet –
 *    aber mit Frist: Hängt eine Verbindung (stockender Upload, offener
 *    WebSocket), wartet `app.close()` sonst ewig, und Docker beendet den
 *    Prozess nach seiner Schonfrist hart, mitten in laufenden
 *    Datenbank-Schreibvorgängen. Ein zweites Signal beendet sofort: Wer
 *    zweimal Strg+C drückt, will nicht auf die Frist warten.
 * 2. **Die Prozess-Wächter.** Node beendet den Prozess bei der ersten
 *    unbehandelten Promise-Ablehnung. Der Wächter loggt sie mit Kontext und
 *    lässt den Prozess weiterlaufen – ein einzelner verirrter Hintergrundlauf
 *    ist kein Grund, alle Spieler-Server unbeaufsichtigt zu lassen. Eine
 *    unbehandelte *Ausnahme* dagegen hinterlässt einen unbekannten Zustand;
 *    hier wird geloggt und geordnet (mit Frist) beendet, damit der Prozess
 *    sauber neu startet.
 */

import { fireAndForget } from './fire-and-forget.js';

export interface ShutdownLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface ShutdownControllerOptions {
  /** Schließt die Anwendung geordnet – im Betrieb `app.close()`. */
  readonly close: () => Promise<void>;
  readonly log: ShutdownLogger;
  /** Beendet den Prozess – im Betrieb `process.exit`, in Tests eine Attrappe. */
  readonly exit: (code: number) => void;
  /** Frist für das geordnete Schließen; danach wird hart beendet. */
  readonly timeoutMs?: number;
}

export interface ShutdownController {
  /**
   * Stößt das Beenden an.
   *
   * Der erste Aufruf schließt geordnet und beendet mit `exitCode` (Vorgabe 0).
   * Jeder weitere Aufruf – ein zweites Signal, eine Ausnahme während des
   * Schließens – beendet sofort mit 1. Das Promise lehnt nie ab: Jeder
   * Fehlerpfad endet im Log und in `exit`.
   */
  shutdown(reason: string, exitCode?: number): Promise<void>;
  /** `true`, sobald das Beenden angestoßen wurde. */
  readonly closing: boolean;
}

/**
 * Zehn Sekunden: Unter Dockers Standard-Schonfrist (`stop_timeout`, ebenfalls
 * 10 s) bleibt kein Spielraum – der Wert soll deshalb im Compose-File größer
 * gewählt sein, wenn diese Frist voll gebraucht wird. Lang genug, dass offene
 * Antworten und Datenbank-Schreibvorgänge regulär enden.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export function createShutdownController(options: ShutdownControllerOptions): ShutdownController {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  let closing = false;

  async function shutdown(reason: string, exitCode = 0): Promise<void> {
    if (closing) {
      options.log.warn(
        { reason },
        'Beenden erneut angefordert, während das geordnete Schließen läuft – der Prozess wird sofort beendet',
      );
      options.exit(1);

      return;
    }

    closing = true;
    options.log.info({ reason, timeoutMs }, 'Backend wird beendet');

    let timer: ReturnType<typeof setTimeout> | undefined;
    const frist = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
      // Der Zeitgeber soll den Prozess nicht am Leben halten, falls `close()`
      // schneller fertig ist und die Ereignisschleife sonst leer wäre.
      timer.unref();
    });

    try {
      const ausgang = await Promise.race([options.close().then(() => 'closed' as const), frist]);

      if (ausgang === 'timeout') {
        options.log.error(
          { reason, timeoutMs },
          'Geordnetes Schließen hat die Frist überschritten – der Prozess wird hart beendet',
        );
        options.exit(1);

        return;
      }

      options.log.info({ reason }, 'Backend beendet');
      options.exit(exitCode);
    } catch (error: unknown) {
      options.log.error(
        { reason, error: error instanceof Error ? error.message : String(error) },
        'Geordnetes Schließen ist fehlgeschlagen – der Prozess wird beendet',
      );
      options.exit(1);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  return {
    shutdown,
    get closing(): boolean {
      return closing;
    },
  };
}

/**
 * Das Nötigste vom `process`-Objekt – in Tests ein `EventEmitter`.
 *
 * Die Signaturen entsprechen den Listener-Typen aus `@types/node`, damit
 * `process` selbst hier ohne Umweg hineinpasst.
 */
export interface ProcessGuardTarget {
  on(
    event: 'unhandledRejection',
    listener: (reason: unknown, promise: Promise<unknown>) => void,
  ): unknown;
  on(event: 'uncaughtException', listener: (error: Error, origin: string) => void): unknown;
}

export interface ProcessGuardOptions {
  readonly log: ShutdownLogger;
  /** Der Shutdown-Weg aus {@link createShutdownController}. */
  readonly shutdown: (reason: string, exitCode?: number) => Promise<void>;
  /** Vorgabe `process`; Tests reichen einen `EventEmitter` herein. */
  readonly target?: ProcessGuardTarget;
}

/**
 * Registriert die beiden Prozess-Wächter.
 *
 * - `unhandledRejection`: loggen, weiterlaufen. Jede `void`-Stelle im Backend
 *   ist über `fireAndForget()` abgesichert; dieser Wächter ist das Netz
 *   darunter für alles, was daran vorbeigeht (Bibliotheken, künftiger Code).
 * - `uncaughtException`: loggen, geordnet beenden. Nach einer synchronen
 *   Ausnahme außerhalb jedes Handlers ist der Zustand des Prozesses nicht mehr
 *   verlässlich; weiterzulaufen wäre Raten.
 */
export function installProcessGuards(options: ProcessGuardOptions): void {
  const target: ProcessGuardTarget = options.target ?? process;

  target.on('unhandledRejection', (reason: unknown) => {
    options.log.error(
      {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      },
      'Unbehandelte Promise-Ablehnung – der Prozess läuft weiter',
    );
  });

  target.on('uncaughtException', (error: Error, origin: string) => {
    options.log.error(
      { error: error.message, stack: error.stack, origin },
      'Unbehandelte Ausnahme – das Backend wird geordnet beendet',
    );
    fireAndForget(
      options.shutdown('uncaughtException', 1),
      options.log,
      'Beenden nach unbehandelter Ausnahme',
    );
  });
}
