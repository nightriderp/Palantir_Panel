/**
 * Job-Scheduler des Agents (Arbeitspaket A3).
 *
 * Alles, was der Agent wiederkehrend tut – aktuell die periodische
 * Server-Abfrage (Pflichtenheft §9) – hängt hier drin. Der Scheduler selbst
 * kennt keinen einzigen Job inhaltlich; er sorgt nur für drei Eigenschaften,
 * die sonst jeder Job für sich lösen müsste:
 *
 *  1. **Keine Überlappung.** Der nächste Lauf wird erst nach dem Ende des
 *     vorigen geplant. Ein Job, der länger braucht als sein Intervall, staut
 *     sich damit nicht auf – bei einer Abfrage, die in ein Zeitlimit läuft, wäre
 *     genau das der Normalfall.
 *  2. **Kein Aufwärts-Ende bei Fehlern.** Eine geworfene Ausnahme beendet die
 *     Schleife nicht, sondern geht an `onError` und der Job läuft weiter. Ein
 *     Homeserver, dessen Spielserver gerade nicht antwortet, soll nicht
 *     dauerhaft aufhören zu fragen.
 *  3. **Testbarkeit.** Die Zeitgeber sind injizierbar; die Tests brauchen
 *     dadurch keine echte Wartezeit und keine Vitest-Fake-Timer.
 *
 * Der Scheduler ersetzt **nicht** die Entscheidungen des Backends: Ob ein
 * Server abgeschaltet wird (Auto-Shutdown) und ob nach einem Absturz neu
 * gestartet wird (Crash-Loop-Schutz), entscheidet B3 – siehe
 * `apps/backend/src/modules/server-orchestration/auto-shutdown.ts` und
 * `crash-loop.ts`. Der Agent liefert die Messwerte dazu.
 */

/** Rückgabewert der injizierten `setTimeout`-Ersetzung. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Zeitgeber des Schedulers.
 *
 * In Produktion die globalen Funktionen, im Test eine Attrappe, die die Zeit
 * schrittweise vorstellt.
 */
export interface SchedulerTimers {
  setTimeout(handler: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export const systemTimers: SchedulerTimers = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle);
  },
};

export interface JobSchedulerOptions {
  readonly timers?: SchedulerTimers;
  /** Wird bei jeder Ausnahme eines Jobs aufgerufen; der Job läuft danach weiter. */
  readonly onError?: (jobName: string, error: unknown) => void;
}

/** Steuerung eines einzelnen wiederkehrenden Jobs. */
export interface ScheduledJob {
  readonly name: string;
  readonly intervalMs: number;
  /** Beendet den Job. Ein bereits laufender Durchgang wird nicht abgebrochen. */
  cancel(): void;
  /**
   * Führt den Job sofort aus, unabhängig vom Zeitplan.
   *
   * Läuft gerade ein Durchgang, wird **kein zweiter** gestartet – die Zusage
   * wartet auf den laufenden. Damit gilt die Überlappungsfreiheit auch für
   * Aufrufe von außen.
   */
  runNow(): Promise<void>;
}

interface JobEintrag {
  readonly name: string;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
  timer: TimerHandle | undefined;
  laufend: Promise<void> | undefined;
  abgebrochen: boolean;
}

export class JobScheduler {
  readonly #timers: SchedulerTimers;
  readonly #onError: (jobName: string, error: unknown) => void;
  readonly #jobs = new Map<string, JobEintrag>();

  constructor(options: JobSchedulerOptions = {}) {
    this.#timers = options.timers ?? systemTimers;
    this.#onError =
      options.onError ??
      ((jobName, error) => {
        console.warn('[jobs] Durchgang fehlgeschlagen', { job: jobName, error });
      });
  }

  /**
   * Meldet einen wiederkehrenden Job an.
   *
   * Ein Job mit demselben Namen ersetzt den vorherigen – so lässt sich ein Ziel
   * mit geändertem Intervall neu setzen, ohne vorher aufräumen zu müssen
   * (`SET_SERVER_QUERY` ist genau deshalb idempotent).
   *
   * Der erste Durchgang läuft nach Ablauf des Intervalls, nicht sofort: Beim
   * Start eines Servers hat eine Abfrage in derselben Millisekunde keinen Wert.
   */
  every(name: string, intervalMs: number, run: () => Promise<void>): ScheduledJob {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`Das Intervall von "${name}" muss größer als 0 sein.`);
    }

    this.cancel(name);

    const eintrag: JobEintrag = {
      name,
      intervalMs,
      run,
      timer: undefined,
      laufend: undefined,
      abgebrochen: false,
    };
    this.#jobs.set(name, eintrag);
    this.#plane(eintrag);

    return {
      name,
      intervalMs,
      cancel: () => {
        this.cancel(name);
      },
      runNow: () => this.#fuehreAus(eintrag),
    };
  }

  /** Beendet einen Job. Unbekannte Namen sind wirkungslos. */
  cancel(name: string): void {
    const eintrag = this.#jobs.get(name);
    if (eintrag === undefined) {
      return;
    }

    eintrag.abgebrochen = true;
    if (eintrag.timer !== undefined) {
      this.#timers.clearTimeout(eintrag.timer);
      eintrag.timer = undefined;
    }
    this.#jobs.delete(name);
  }

  /** Beendet alle Jobs – wird beim Herunterfahren des Agents aufgerufen. */
  stopAll(): void {
    for (const name of [...this.#jobs.keys()]) {
      this.cancel(name);
    }
  }

  /** Namen der aktuell angemeldeten Jobs, in Reihenfolge der Anmeldung. */
  get jobNames(): readonly string[] {
    return [...this.#jobs.keys()];
  }

  #plane(eintrag: JobEintrag): void {
    if (eintrag.abgebrochen) {
      return;
    }

    eintrag.timer = this.#timers.setTimeout(() => {
      eintrag.timer = undefined;
      void this.#fuehreAus(eintrag).then(() => {
        // Erst nach dem Ende des Durchgangs neu planen: So kann sich ein
        // langsamer Job nicht selbst überholen.
        this.#plane(eintrag);
      });
    }, eintrag.intervalMs);
  }

  #fuehreAus(eintrag: JobEintrag): Promise<void> {
    if (eintrag.laufend !== undefined) {
      return eintrag.laufend;
    }

    const durchgang = (async () => {
      try {
        await eintrag.run();
      } catch (fehler: unknown) {
        this.#onError(eintrag.name, fehler);
      } finally {
        eintrag.laufend = undefined;
      }
    })();

    eintrag.laufend = durchgang;
    return durchgang;
  }
}
