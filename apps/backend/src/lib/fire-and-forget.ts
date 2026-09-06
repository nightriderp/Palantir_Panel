/**
 * Hintergrundläufe absichern (Audit W0-5, Fundpunkte 126 und 127).
 *
 * Node beendet den Prozess seit Version 15 bei der ersten unbehandelten
 * Promise-Ablehnung. Ein nacktes `void promise` an einer Stelle, die niemand
 * abwartet, bedeutet deshalb nicht „Ergebnis egal", sondern ist eine
 * Absturzstelle: Wirft der Hintergrundlauf, stirbt das ganze Panel – wegen
 * eines doppelten Agent-Ereignisses, eines kurzen Datenbank-Schluckaufs oder
 * eines Servers, der während seines Health-Checks gelöscht wurde.
 *
 * Dieser Helfer ist die einzige zulässige Form eines nicht abgewarteten
 * Promises im Backend: Er fängt die Ablehnung und schreibt sie mit Kontext ins
 * Log. Wer einen Lauf anstößt, den er nicht abwartet, nennt hier den Vorgang –
 * sonst steht später ein Fehler ohne Herkunft im Log.
 */

/** Was der Helfer zum Melden braucht – `app.log`, ein Modul-Logger oder eine Attrappe. */
export interface FireAndForgetLogger {
  error(details: Record<string, unknown>, message: string): void;
}

/**
 * Ein nicht abgewarteter Lauf.
 *
 * `void` ist mit dabei, weil Handler-Schnittstellen wie `AgentSessionHandlers`
 * wahlweise synchron oder als Promise zurückkommen (`Promise<void> | void`).
 */
export type BackgroundTask = PromiseLike<unknown> | void;

/**
 * Stößt einen Lauf an, ohne auf ihn zu warten, und fängt seine Ablehnung.
 *
 * @param task    Der laufende Vorgang (Promise) oder `undefined` bei einem
 *                synchron abgeschlossenen Handler.
 * @param log     Wohin ein Fehlschlag gemeldet wird.
 * @param kontext Der Vorgang in Worten (`'Health-Check nach dem Start'`) oder
 *                ein Objekt mit Feldern, die die Log-Zeile tragen soll
 *                (`{ vorgang, serverId }`).
 */
export function fireAndForget(
  task: BackgroundTask,
  log: FireAndForgetLogger,
  kontext: string | Record<string, unknown>,
): void {
  const details = typeof kontext === 'string' ? { vorgang: kontext } : kontext;

  Promise.resolve(task).catch((error: unknown) => {
    try {
      log.error(
        {
          ...details,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Hintergrundvorgang fehlgeschlagen',
      );
    } catch {
      // Ein Logger, der selbst wirft, darf die Absicherung nicht aushebeln –
      // sonst wäre genau die Ablehnung wieder unbehandelt, die hier gefangen
      // werden soll.
    }
  });
}

/**
 * Rückfall für Stellen ohne strukturierten Logger (Standard-Job-Runner der
 * Module, Datenbank-Pool). Der Betriebszusammenbau in `server.ts` reicht
 * überall, wo es geht, `app.log` herein; dieser Rückfall greift nur, wenn ein
 * Modul ohne Logger zusammengesteckt wird (Tests, Skripte).
 */
export const consoleFireAndForgetLogger: FireAndForgetLogger = {
  error(details, message) {
    console.error(message, details);
  },
};
