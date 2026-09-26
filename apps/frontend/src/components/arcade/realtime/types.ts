import { type ArcadeGameId } from '@palantir/contracts';
import { type ArcadeInput, type RealtimeGame } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';

/**
 * Zeichenschicht eines Echtzeit-Spiels.
 *
 * Die Logik liegt in `@palantir/arcade` (läuft auch im Backend beim
 * Nachrechnen). Hier steht nur, was der Browser dazu braucht: wie gezeichnet
 * wird, welche Tasten welche Eingabe sind und welche Geräusche wann klingen.
 */

/** Bildschirmtasten auf dem Smartphone. */
export type RealtimeTouchScheme =
  /** Links/Rechts (+ Aktion) – Schläger, Invaders. */
  | 'horizontal'
  /** Vier Richtungen – Snake, Pac-Man, 2048. */
  | 'dpad'
  /** Links/Rechts, Runter, Drehen, Harter Fall – Tetris. */
  | 'stack'
  /** Nur eine große Aktionstaste – Flappy Bird. */
  | 'tap'
  /** Keine Tasten, gespielt wird durch Tippen aufs Feld – Minesweeper, Simon. */
  | 'pointer';

export interface RealtimeView {
  /** Logische Breite/Höhe des Canvas in Pixeln (wird per CSS skaliert). */
  readonly width: number;
  readonly height: number;
}

/** Ein Tipp/Klick aufs Spielfeld, in logischen Canvas-Koordinaten. */
export interface RealtimePointer {
  x: number;
  y: number;
  /** 0 = links/Tippen, 2 = rechts/langes Drücken (Minesweeper: Fahne). */
  button: 0 | 2;
}

export interface RealtimeRenderer<S> {
  readonly id: ArcadeGameId;
  /** Die Logik aus `@palantir/arcade`. */
  readonly logic: RealtimeGame<S>;
  readonly view: RealtimeView;
  readonly touch: RealtimeTouchScheme;
  /** Kurze Steuerungsanleitung (deutsch). */
  readonly instructions: string;

  /**
   * Taste → Eingabe. `phase` ist gedrückt oder losgelassen; Wiederholungen
   * durch gehaltene Tasten filtert der Wirt. `null` = Taste gehört nicht zum
   * Spiel. Die Grundbelegung (Pfeile, WASD, Leertaste) liefert
   * `defaultKeyInput` aus `./keys`.
   */
  keyInput(key: string, phase: 'press' | 'release', state: S): ArcadeInput | null;

  /** Tipp aufs Feld → Eingabe (nur für `touch: 'pointer'` oder Zusatzbedienung). */
  pointerInput?(pointer: RealtimePointer, state: S): ArcadeInput | null;

  /**
   * Zeichnet den Zustand. `time` ist eine fortlaufende Zeit in ms für reine
   * Zier-Animationen (Blinken, Glitzern) – nie für Spiellogik.
   */
  render(ctx: CanvasRenderingContext2D, state: S, time: number): void;

  /**
   * Vergleicht zwei Momentaufnahmen und nennt Geräusche, die dazwischen fällig
   * wurden (z. B. Punktestand gestiegen → 'eat'). `prev` ist ein kleiner
   * Auszug, den `snapshot` liefert – der Wirt ruft beides nach jedem Schritt.
   */
  snapshot?(state: S): unknown;
  sounds?(prev: unknown, next: unknown): SfxName[];
}

/** Irgendeine Zeichenschicht – für Register und Wirt. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Zustand je Spiel privat, der Wirt behandelt ihn undurchsichtig.
export type AnyRealtimeRenderer = RealtimeRenderer<any>;
