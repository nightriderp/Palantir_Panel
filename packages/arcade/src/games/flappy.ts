/**
 * Flappy Bird – ein Vogel, Röhren, eine Taste.
 *
 * Fester Takt von 16 ms, Schwerkraft und Flügelschlag als einfache
 * Geschwindigkeitsänderung je Schritt. Die Lücken kommen aus dem Startwert,
 * springen aber höchstens um ein Stück, das man mit ein paar Flügelschlägen
 * noch schafft – reiner Zufall würde gelegentlich unspielbare Folgen liefern.
 *
 * Nach dem Aufprall fällt der Vogel noch bis auf den Boden, erst dann ist die
 * Partie vorbei. Das ist ein paar Schritte Nachspann für die Zeichnung und
 * ändert am Punktestand nichts mehr.
 */

import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_UP,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { createRng, nextRandom, type RngState } from '../rng.js';

export const FLAPPY_W = 288;
export const FLAPPY_H = 512;
export const FLAPPY_GROUND_Y = 432;
export const FLAPPY_BIRD_X = 72;
export const FLAPPY_BIRD_R = 11;
export const FLAPPY_PIPE_W = 52;

const GRAVITY = 0.26;
const FLAP = -5;
const MAX_FALL = 7.5;
const PIPE_SPACING = 168;
const GAP_START = 120;
const GAP_MIN = 96;
const MARGIN = 60;
const MAX_SHIFT = 150;
/** Etwas kleiner als gezeichnet – ein Streifschuss am Federkleid soll nicht zählen. */
const HIT_R = 9.5;

export type FlappyPhase = 'ready' | 'play' | 'dead' | 'over';

export interface FlappyPipe {
  x: number;
  /** Mitte der Lücke. */
  gapY: number;
  gap: number;
  passed: boolean;
}

export interface FlappyState {
  version: 1;
  rng: RngState;
  tick: number;
  phase: FlappyPhase;
  score: number;
  y: number;
  vy: number;
  pipes: FlappyPipe[];
  /** Zurückgelegte Strecke – für die Parallaxe der Zeichnung. */
  dist: number;
  /** Zähler nur für Geräusche. */
  flaps: number;
}

function pipeSpeed(state: FlappyState): number {
  return 2 + Math.min(state.score, 40) * 0.01;
}

function currentGap(state: FlappyState): number {
  return Math.max(GAP_MIN, GAP_START - Math.floor(state.score / 5) * 2);
}

function spawnPipe(state: FlappyState, x: number): void {
  const gap = currentGap(state);
  const lo = MARGIN + gap / 2;
  const hi = FLAPPY_GROUND_Y - MARGIN - gap / 2;
  const last = state.pipes[state.pipes.length - 1];
  const prev = last ? last.gapY : (lo + hi) / 2;
  let gapY = prev + (nextRandom(state.rng) * 2 - 1) * MAX_SHIFT;
  if (gapY < lo) gapY = lo;
  if (gapY > hi) gapY = hi;
  state.pipes.push({ x, gapY: Math.round(gapY), gap, passed: false });
}

function circleHitsRect(
  cx: number,
  cy: number,
  r: number,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const nx = cx < x ? x : cx > x + w ? x + w : cx;
  const ny = cy < y ? y : cy > y + h ? y + h : cy;
  const ddx = cx - nx;
  const ddy = cy - ny;
  return ddx * ddx + ddy * ddy < r * r;
}

function collides(state: FlappyState): boolean {
  if (state.y + FLAPPY_BIRD_R >= FLAPPY_GROUND_Y) return true;
  for (const pipe of state.pipes) {
    const top = pipe.gapY - pipe.gap / 2;
    const bottom = pipe.gapY + pipe.gap / 2;
    // Die obere Röhre reicht bis weit über den Rand, man kann sie nicht überfliegen.
    if (circleHitsRect(FLAPPY_BIRD_X, state.y, HIT_R, pipe.x, -1000, FLAPPY_PIPE_W, top + 1000))
      return true;
    if (
      circleHitsRect(
        FLAPPY_BIRD_X,
        state.y,
        HIT_R,
        pipe.x,
        bottom,
        FLAPPY_PIPE_W,
        FLAPPY_GROUND_Y - bottom,
      )
    ) {
      return true;
    }
  }
  return false;
}

function isFlap(input: ArcadeInput): boolean {
  return input === ARCADE_INPUT_ACTION || input === ARCADE_INPUT_UP;
}

export const game: RealtimeGame<FlappyState> = {
  kind: 'realtime',
  id: 'flappy',
  version: 1,

  create(seed) {
    return {
      version: 1,
      rng: createRng(seed),
      tick: 0,
      phase: 'ready',
      score: 0,
      y: FLAPPY_H / 2 - 40,
      vy: 0,
      pipes: [],
      dist: 0,
      flaps: 0,
    };
  },

  step(state, input) {
    if (state.phase === 'over') return state;
    state.tick += 1;

    if (state.phase === 'ready') {
      if (!isFlap(input)) return state;
      state.phase = 'play';
      spawnPipe(state, FLAPPY_W + 60);
    }

    if (state.phase === 'dead') {
      state.vy = Math.min(state.vy + GRAVITY * 1.5, MAX_FALL * 1.4);
      state.y += state.vy;
      if (state.y + FLAPPY_BIRD_R >= FLAPPY_GROUND_Y) {
        state.y = FLAPPY_GROUND_Y - FLAPPY_BIRD_R;
        state.phase = 'over';
      }
      return state;
    }

    if (isFlap(input)) {
      state.vy = FLAP;
      state.flaps += 1;
    } else {
      state.vy = Math.min(state.vy + GRAVITY, MAX_FALL);
    }
    state.y += state.vy;
    if (state.y < -40) {
      state.y = -40;
      state.vy = 0;
    }

    const speed = pipeSpeed(state);
    state.dist += speed;
    for (const pipe of state.pipes) {
      pipe.x -= speed;
      if (!pipe.passed && pipe.x + FLAPPY_PIPE_W < FLAPPY_BIRD_X - FLAPPY_BIRD_R) {
        pipe.passed = true;
        state.score += 1;
      }
    }
    state.pipes = state.pipes.filter((pipe) => pipe.x + FLAPPY_PIPE_W > -4);
    const last = state.pipes[state.pipes.length - 1];
    if (!last || last.x <= FLAPPY_W + 60 - PIPE_SPACING) {
      spawnPipe(state, (last ? last.x : FLAPPY_W) + PIPE_SPACING);
    }

    if (collides(state)) {
      state.phase = 'dead';
      if (state.vy < 0) state.vy = 0;
      if (state.y + FLAPPY_BIRD_R >= FLAPPY_GROUND_Y) {
        state.y = FLAPPY_GROUND_Y - FLAPPY_BIRD_R;
        state.phase = 'over';
      }
    }
    return state;
  },

  isOver: (state) => state.phase === 'over',
  score: (state) => state.score,
  tickMs: () => 16,
};
