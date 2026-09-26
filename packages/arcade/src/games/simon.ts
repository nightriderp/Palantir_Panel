/**
 * Simon – eine wachsende Farbfolge nachspielen.
 *
 * Die vier Felder liegen wie eine Raute: oben, rechts, unten, links. Dadurch
 * passen die Pfeiltasten ohne Umdenken, und auf dem Handy tippt man einfach
 * aufs Feld.
 *
 * Anders als 2048 läuft hier ein fester Takt (50 ms), auch in der
 * Eingabephase: Die Zeigephase braucht ihn für das Aufleuchten, die
 * Eingabephase für die Frist je Tipp. Eine Frist, die nur die Uhr des Browsers
 * kennt, könnte das Backend nicht nachrechnen.
 */

import {
  ARCADE_INPUT_CUSTOM,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { type RngState, createRng, nextInt } from '../rng.js';

export const SIMON_PADS = 4;
const TICK_MS = 50;
/** Pause vor dem Vorspielen einer Runde (Schritte). */
const LEAD_TICKS = 18;
/** Frist je Tipp in der Eingabephase: 5 Sekunden. */
const INPUT_TIMEOUT_TICKS = 100;
/** Wie lange ein gedrücktes Feld nachleuchtet (nur Anzeige). */
const PRESS_GLOW_TICKS = 6;
/** Deckel für die Folge – weit jenseits dessen, was ein Mensch sich merkt. */
const MAX_ROUNDS = 500;

export interface SimonState {
  phase: 'show' | 'input' | 'over';
  seq: number[];
  rng: RngState;
  /** Schritte seit Beginn der aktuellen Phase bzw. seit dem letzten Tipp. */
  t: number;
  /** Nächste erwartete Stelle der Folge in der Eingabephase. */
  idx: number;
  /** Geschaffte Runden. */
  rounds: number;
  /** Gerade leuchtendes Feld (Zeigephase oder Nachleuchten), -1 = keins. */
  lit: number;
  /** Anzahl gezeigter Leuchtpunkte – für das Ton-Signal der Zeichenschicht. */
  flashes: number;
  /** Anzahl angenommener Tipps – dito. */
  presses: number;
  /** Zuletzt gedrücktes Feld und wie lange es noch nachleuchtet. */
  pressed: number;
  pressGlow: number;
  /** Feld, das beim Fehler richtig gewesen wäre; -1 bei Zeitablauf ohne Zuordnung. */
  expected: number;
  /** Woran es gescheitert ist. */
  reason: '' | 'falsch' | 'zeit';
}

/** Leuchtdauer und Pause eines Elements – mit jeder Runde etwas kürzer. */
export function simonTiming(rounds: number): { on: number; gap: number } {
  return {
    on: Math.max(5, 12 - Math.floor(rounds / 2)),
    gap: Math.max(3, 6 - Math.floor(rounds / 4)),
  };
}

function inputToPad(input: ArcadeInput): number {
  if (input === ARCADE_INPUT_UP) return 0;
  if (input === ARCADE_INPUT_RIGHT) return 1;
  if (input === ARCADE_INPUT_DOWN) return 2;
  if (input === ARCADE_INPUT_LEFT) return 3;
  const custom = input - ARCADE_INPUT_CUSTOM;
  if (custom >= 0 && custom < SIMON_PADS) return custom;
  return -1;
}

function startShow(state: SimonState): void {
  state.phase = 'show';
  state.t = 0;
  state.idx = 0;
}

function showStep(state: SimonState): void {
  const { on, gap } = simonTiming(state.rounds);
  const period = on + gap;
  state.t += 1;
  const rel = state.t - LEAD_TICKS;
  if (rel < 0) {
    // Der letzte richtige Tipp der Vorrunde darf noch ausleuchten.
    state.lit = state.pressGlow > 0 ? state.pressed : -1;
    return;
  }
  const k = Math.floor(rel / period);
  if (k >= state.seq.length) {
    state.phase = 'input';
    state.t = 0;
    state.idx = 0;
    state.lit = -1;
    return;
  }
  const within = rel % period;
  const lit = within < on ? (state.seq[k] as number) : -1;
  if (lit !== -1 && within === 0) state.flashes += 1;
  state.lit = lit;
}

export const game: RealtimeGame<SimonState> = {
  kind: 'realtime',
  id: 'simon',
  version: 1,
  create(seed) {
    const rng = createRng(seed);
    const first = nextInt(rng, SIMON_PADS);
    return {
      phase: 'show',
      seq: [first],
      rng,
      t: 0,
      idx: 0,
      rounds: 0,
      lit: -1,
      flashes: 0,
      presses: 0,
      pressed: -1,
      pressGlow: 0,
      expected: -1,
      reason: '',
    };
  },
  step(state, input) {
    if (state.phase === 'over') return state;
    if (state.pressGlow > 0) state.pressGlow -= 1;

    if (state.phase === 'show') {
      // Tipps während des Vorspielens zählen nicht – weder als Fehler noch als Treffer.
      showStep(state);
      return state;
    }

    state.t += 1;
    const pad = inputToPad(input);
    if (pad === -1) {
      state.lit = state.pressGlow > 0 ? state.pressed : -1;
      if (state.t > INPUT_TIMEOUT_TICKS) {
        state.phase = 'over';
        state.reason = 'zeit';
        state.expected = state.seq[state.idx] ?? -1;
        state.lit = -1;
      }
      return state;
    }

    state.presses += 1;
    state.pressed = pad;
    state.pressGlow = PRESS_GLOW_TICKS;
    state.lit = pad;
    state.t = 0;
    const want = state.seq[state.idx] as number;
    if (pad !== want) {
      state.phase = 'over';
      state.reason = 'falsch';
      state.expected = want;
      return state;
    }
    state.idx += 1;
    if (state.idx >= state.seq.length) {
      state.rounds += 1;
      if (state.rounds >= MAX_ROUNDS) {
        state.phase = 'over';
        return state;
      }
      state.seq.push(nextInt(state.rng, SIMON_PADS));
      startShow(state);
    }
    return state;
  },
  isOver: (state) => state.phase === 'over',
  score: (state) => state.rounds * 10,
  tickMs: (state) => (state.phase === 'over' ? 0 : TICK_MS),
};
