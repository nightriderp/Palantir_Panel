import { type ArcadeGameId } from '@palantir/contracts';

/**
 * Gemeinsame Bausteine der Minispiel-Maschine (Arbeitspaket F8).
 *
 * Jedes Spiel ist als **reine Logik** über {@link ArcadeGame} beschrieben:
 * Zustand plus Funktionen, die den Zustand fortschreiben, Eingaben anwenden und
 * ihn auf ein Canvas zeichnen. So lässt sich die Spiellogik ohne Browser testen
 * (CLAUDE.md §4); nur das Zeichnen bleibt ungetestet.
 *
 * Alle Spiele sind eigenständig entwickelt – keine geschützten Assets, Marken
 * oder Original-Level (Lastenheft §3.9).
 */

/** Steuerbefehle, die ein Spiel entgegennimmt. */
export type GameControl = 'up' | 'down' | 'left' | 'right' | 'action';

/** Phase eines Steuerbefehls – gedrückt oder losgelassen. */
export type ControlPhase = 'press' | 'release';

/**
 * Welche Bildschirmtasten ein Spiel auf dem Smartphone braucht (Mobile-First,
 * Lastenheft §4). Die Tastatur bildet dieselben Befehle auf die Pfeiltasten und
 * die Leertaste ab.
 */
export type TouchScheme =
  /** Links/Rechts – für Schläger-Spiele. */
  | 'horizontal'
  /** Vier Richtungen – für Pfad- und Labyrinth-Spiele. */
  | 'dpad'
  /** Links/Rechts, Runter (schneller Fall) und eine Aktionstaste (Drehen). */
  | 'stack';

/** Laufender Zustand einer Partie. */
export type GamePhase = 'ready' | 'running' | 'over';

/** Sichtfläche, gegen die ein Spiel zeichnet (logische Pixel, quadratisch skaliert). */
export interface GameView {
  readonly width: number;
  readonly height: number;
}

/**
 * Ein eigenständiges Minispiel als reine Logik.
 *
 * `TState` ist der veränderliche Zustand einer Partie. Die Funktionen dürfen den
 * übergebenen Zustand in-place fortschreiben und zurückgeben – ein Spiel-Loop
 * braucht keine Unveränderlichkeit, und die Tests prüfen den zurückgegebenen
 * Zustand.
 */
export interface ArcadeGame<TState> {
  readonly id: ArcadeGameId;
  /** Kurze Steuerungsanleitung (deutsch), unter dem Spielfeld eingeblendet. */
  readonly instructions: string;
  /** Bildschirmtasten für die Touch-Bedienung. */
  readonly touch: TouchScheme;
  /** Fläche, in der das Spiel rechnet – quadratisch, in logischen Pixeln. */
  readonly view: GameView;

  /** Neuen Ausgangszustand erzeugen. `random` erlaubt deterministische Tests. */
  create(random?: () => number): TState;
  /** Zustand um `dtMs` Millisekunden fortschreiben. */
  step(state: TState, dtMs: number): TState;
  /** Einen Steuerbefehl anwenden. */
  control(state: TState, control: GameControl, phase: ControlPhase): TState;
  /** Aktuelle Phase der Partie. */
  phase(state: TState): GamePhase;
  /** Aktueller Punktestand (ganzzahlig, nicht-negativ). */
  score(state: TState): number;
  /** Zustand auf ein Canvas zeichnen. */
  render(ctx: CanvasRenderingContext2D, state: TState, view: GameView): void;
}
