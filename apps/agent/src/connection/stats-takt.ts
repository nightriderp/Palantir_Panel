/**
 * Takt der Live-Messwerte (Leistungsbericht 19.09.2026, Punkt 5).
 *
 * **Das Problem.** Für jeden laufenden Container hält der Agent einen eigenen
 * Statistikstrom offen, und Docker schiebt darüber ungefähr sekündlich einen
 * Satz Werte. Jede Zeile wird kodiert, geht über die Leitung, durch den
 * Live-Kanal des Backends und in die Oberfläche. Bei fünf Servern ist das
 * belanglos, bei fünfzig eine Dauerlast – und zwar eine, die nichts bringt:
 * Niemand liest fünfzig Kacheln im Sekundentakt.
 *
 * **Die Regel.** Je Container gilt ein Mindestabstand zwischen zwei
 * Meldungen. Er wächst mit der Zahl der laufenden Container:
 *
 * ```
 * Abstand = min(maxIntervalMs, max(minIntervalMs, laufende × proContainerMs))
 * ```
 *
 * Mit den Vorgabewerten heißt das: Bis zehn Server bleibt es beim
 * Sekundentakt, also genau beim heutigen Verhalten. Bei zwanzig Servern
 * kommen die Werte alle zwei Sekunden, ab fünfzig alle fünf.
 *
 * **Warum verworfen und nicht gesammelt.** Ein Messwert ist eine Momentaufnahme;
 * der nächste ersetzt ihn vollständig. Ihn zurückzuhalten, um ihn später zu
 * senden, brächte der Anzeige nichts – sie zeigte dann nur einen älteren
 * Stand. Verworfen wird deshalb der Zwischenwert, nie der letzte: Der nächste
 * Strom-Tick liegt immer schon im Anmarsch.
 *
 * Statuswechsel, Abstürze und Logzeilen laufen nicht durch diese Drossel. Sie
 * sind Ereignisse, keine Momentaufnahmen, und jedes einzelne zählt.
 */

export interface StatsTaktOptionen {
  /** Kürzester Abstand zwischen zwei Meldungen desselben Containers. */
  readonly minIntervalMs?: number;
  /** Längster Abstand, auch wenn sehr viele Container laufen. */
  readonly maxIntervalMs?: number;
  /** Zuschlag je laufendem Container. */
  readonly proContainerMs?: number;
  readonly now?: () => number;
}

export const STATS_TAKT_MIN_MS = 1_000;
export const STATS_TAKT_MAX_MS = 5_000;
export const STATS_TAKT_PRO_CONTAINER_MS = 100;

export class StatsTakt {
  readonly #minIntervalMs: number;
  readonly #maxIntervalMs: number;
  readonly #proContainerMs: number;
  readonly #now: () => number;
  /** Zeitpunkt der letzten durchgelassenen Meldung je Container. */
  readonly #zuletzt = new Map<string, number>();

  constructor(optionen: StatsTaktOptionen = {}) {
    this.#minIntervalMs = optionen.minIntervalMs ?? STATS_TAKT_MIN_MS;
    this.#maxIntervalMs = Math.max(
      optionen.maxIntervalMs ?? STATS_TAKT_MAX_MS,
      optionen.minIntervalMs ?? STATS_TAKT_MIN_MS,
    );
    this.#proContainerMs = optionen.proContainerMs ?? STATS_TAKT_PRO_CONTAINER_MS;
    this.#now = optionen.now ?? (() => Date.now());
  }

  /** Abstand, der bei dieser Zahl laufender Container gilt. */
  abstandMs(laufendeContainer: number): number {
    const gewuenscht = Math.max(laufendeContainer, 0) * this.#proContainerMs;

    return Math.min(this.#maxIntervalMs, Math.max(this.#minIntervalMs, gewuenscht));
  }

  /**
   * Darf dieser Messwert durch?
   *
   * Der erste eines Containers immer – sonst stünde die Kachel nach dem Start
   * bis zu einen Takt lang auf „—".
   */
  darfSenden(containerId: string, laufendeContainer: number): boolean {
    const jetzt = this.#now();
    const vorher = this.#zuletzt.get(containerId);

    if (vorher !== undefined && jetzt - vorher < this.abstandMs(laufendeContainer)) {
      return false;
    }

    this.#zuletzt.set(containerId, jetzt);

    return true;
  }

  /** Container ist weg (gestoppt, gelöscht) – Eintrag mitnehmen. */
  vergiss(containerId: string): void {
    this.#zuletzt.delete(containerId);
  }

  /** Alles vergessen; beim Abmelden vom Ereignisstrom. */
  leeren(): void {
    this.#zuletzt.clear();
  }
}
