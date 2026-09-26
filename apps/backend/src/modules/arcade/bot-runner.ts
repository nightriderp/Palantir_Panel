/**
 * Bot-Läufer der Online-Räume (Neubau 26.09.2026).
 *
 * Zieht ein Computergegner als Nächstes, plant der Läufer nach einer kurzen
 * Pause (`delayMs`, ~0,9 s – damit Menschen den Zug sehen) genau **einen**
 * Bot-Zug auf dem frisch geladenen Raum. Meldet der Schritt, dass danach
 * wieder ein Bot dran ist, plant er den nächsten. Eine Sperre je Raum im
 * Speicher verhindert, dass zwei Auslöser (Zug eines Menschen und der
 * Minutentakt) denselben Raum doppelt planen.
 *
 * Der Läufer kennt weder Datenbank noch Regeln – er ruft nur `step(roomId)`.
 * Ein Fehler darin wird geloggt, nicht weitergeworfen: Ein kaputter Raum darf
 * den Prozess nicht beenden.
 */

export const ARCADE_BOT_DELAY_MS = 900;

export interface ArcadeBotRunnerLogger {
  error(details: Record<string, unknown>, message: string): void;
}

export interface ArcadeBotRunnerOptions {
  /** Ein Bot-Zug im Raum; `true`, wenn danach wieder ein Bot zieht. */
  step(roomId: string): Promise<boolean>;
  readonly delayMs?: number;
  readonly logger?: ArcadeBotRunnerLogger;
}

export interface ArcadeBotRunner {
  /** Plant den nächsten Bot-Zug, falls für den Raum nicht schon einer geplant ist. */
  schedule(roomId: string): void;
  /** Ist für den Raum ein Zug geplant oder in Arbeit? */
  isScheduled(roomId: string): boolean;
  /** Bricht alle geplanten Züge ab (Herunterfahren). */
  stop(): void;
}

export function createArcadeBotRunner(options: ArcadeBotRunnerOptions): ArcadeBotRunner {
  const delayMs = options.delayMs ?? ARCADE_BOT_DELAY_MS;
  const pending = new Map<string, ReturnType<typeof setTimeout> | null>();
  let stopped = false;

  function schedule(roomId: string): void {
    if (stopped || pending.has(roomId)) return;

    const timer = setTimeout(() => {
      // Ab hier „in Arbeit": Die Sperre bleibt, der Zeitgeber ist verbraucht.
      pending.set(roomId, null);

      void (async (): Promise<void> => {
        let more = false;

        try {
          more = await options.step(roomId);
        } catch (error) {
          options.logger?.error({ err: error, roomId }, 'Arcade: Bot-Zug fehlgeschlagen.');
        } finally {
          pending.delete(roomId);
        }

        if (more) schedule(roomId);
      })();
    }, delayMs);

    // Ein geplanter Bot-Zug darf das Beenden des Prozesses nicht aufhalten.
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    pending.set(roomId, timer);
  }

  return {
    schedule,
    isScheduled(roomId) {
      return pending.has(roomId);
    },
    stop() {
      stopped = true;

      for (const timer of pending.values()) {
        if (timer !== null) clearTimeout(timer);
      }

      pending.clear();
    },
  };
}
