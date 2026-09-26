import {
  ARCADE_INPUT_NONE,
  ArcadeRecorder,
  MAX_ARCADE_INPUTS,
  MAX_ARCADE_TICKS,
  type ArcadeInput,
  type ArcadeRecording,
  type RealtimeGame,
} from '@palantir/arcade';

/**
 * Takt und Eingabe-Warteschlange einer Echtzeit-Partie – ohne DOM.
 *
 * Der Wirt ruft je Bildschirmbild `advance(vergangeneMs)` auf; die Sitzung
 * rechnet daraus, wie viele feste Schritte fällig sind (Akkumulator), und gibt
 * je Schritt höchstens **eine** Eingabe ab. So entsteht genau das Band, das das
 * Backend mit `runArcadeReplay` nachspielt: gleiche Schritte, gleiche
 * Eingaben, gleicher Stand – egal ob der Bildschirm 60 oder 144 Bilder zeigt.
 *
 * Getrennt vom React-Wirt, weil sich genau hier Fehler verstecken, die man
 * beim Spielen nicht sieht (zwei Eingaben in einem Schritt, Aufholen nach
 * einer Pause), und die sind nur ohne Browser verlässlich prüfbar.
 */

export interface RealtimeSessionOptions {
  /** So viele Schritte holt ein Bild höchstens nach (hängender Tab, Ruckler). */
  maxCatchUp?: number;
  /** So viele Eingaben warten höchstens; mehr gehen verloren statt sich zu stauen. */
  maxQueue?: number;
}

export class RealtimeSession<S> {
  state: S;
  /** Anzahl ausgeführter Schritte = Länge des Bandes. */
  tick = 0;
  private accumulator = 0;
  private readonly queue: ArcadeInput[] = [];
  private readonly recorder = new ArcadeRecorder();
  private readonly maxCatchUp: number;
  private readonly maxQueue: number;

  constructor(
    readonly logic: RealtimeGame<S>,
    readonly seed: number,
    options: RealtimeSessionOptions = {},
  ) {
    this.state = logic.create(seed);
    this.maxCatchUp = options.maxCatchUp ?? 5;
    this.maxQueue = options.maxQueue ?? 6;
  }

  get over(): boolean {
    return this.logic.isOver(this.state) || this.tick >= MAX_ARCADE_TICKS;
  }

  get score(): number {
    return this.logic.score(this.state);
  }

  /** Eingabe für einen der nächsten Schritte vormerken. */
  enqueue(input: ArcadeInput | null): void {
    if (input === null || input === ARCADE_INPUT_NONE || this.over) return;
    if (this.queue.length >= this.maxQueue) return;
    this.queue.push(input);
  }

  get pending(): number {
    return this.queue.length;
  }

  /**
   * Zeit vergehen lassen. Gibt die Zahl ausgeführter Schritte zurück.
   *
   * `tickMs() = 0` heißt: kein Zeittakt, ein Schritt nur mit Eingabe (2048,
   * Minesweeper). Wechselt ein Spiel mitten drin zwischen beidem (Simon spielt
   * die Folge im Takt vor und wartet dann auf Eingaben), wird der Takt nach
   * jedem Schritt neu gelesen.
   */
  advance(elapsedMs: number): number {
    let steps = 0;
    this.accumulator += Math.max(0, elapsedMs);
    while (steps < this.maxCatchUp && !this.over) {
      const tickMs = this.logic.tickMs(this.state);
      if (tickMs <= 0) {
        // Eingabegetrieben: angesparte Zeit verfällt, sonst liefe das Spiel
        // nach dem Wechsel zurück in den Takt mit einem Satz nach vorn.
        this.accumulator = 0;
        if (this.queue.length === 0) break;
      } else {
        if (this.accumulator < tickMs) break;
        this.accumulator -= tickMs;
      }
      this.stepOnce();
      steps += 1;
    }
    if (steps >= this.maxCatchUp) {
      // Nach dem Aufholen den Rest verwerfen: lieber ein kurzes Stocken als
      // ein Spiel, das nach einem Ruckler im Zeitraffer weiterläuft.
      const tickMs = this.over ? 0 : this.logic.tickMs(this.state);
      this.accumulator = Math.min(this.accumulator, Math.max(0, tickMs));
    }
    return steps;
  }

  /** Band für die Einsendung. */
  finish(): ArcadeRecording {
    return this.recorder.finish(this.tick);
  }

  private stepOnce(): void {
    let input = this.queue.shift() ?? ARCADE_INPUT_NONE;
    if (input !== ARCADE_INPUT_NONE) {
      if (this.recorder.length >= MAX_ARCADE_INPUTS) input = ARCADE_INPUT_NONE;
      else this.recorder.record(this.tick, input);
    }
    this.state = this.logic.step(this.state, input);
    this.tick += 1;
  }
}
