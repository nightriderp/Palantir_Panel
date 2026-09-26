/**
 * Pong („Ballwechsel") gegen den Computer, im Hochformat.
 *
 * Der eigene Schläger liegt unten und fährt waagerecht – so reichen auf dem
 * Smartphone zwei Tasten. Gespielt wird bis sieben. Gewinnt der Spieler die
 * Runde, kommt ein stärkerer Gegner; die erste verlorene Runde beendet die
 * Partie. Punkte: eigener Treffer 10, eigener Punkt 100, Rundensieg 1000.
 *
 * Wie bei Breakout nur Grundrechenarten und `Math.sqrt`, damit Browser und
 * Backend bitgleich rechnen (siehe Kopf von `steinbrecher.ts`).
 */

import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { createRng, nextRandom, type RngState } from '../rng.js';

export const PONG_W = 320;
export const PONG_H = 480;
export const PONG_PADDLE_W = 56;
export const PONG_PADDLE_H = 10;
/** Oberkante des Spielerschlägers. */
export const PONG_PLAYER_Y = 446;
/** Oberkante des Computerschlägers. */
export const PONG_CPU_Y = 24;
export const PONG_BALL_R = 5;
export const PONG_TARGET = 7;

const PLAYER_SPEED = 6;
const MAX_BALL_SPEED = 8.5;
const SERVE_TICKS = 60;
const ROUND_BREAK_TICKS = 150;
const SPREAD = 1.5;

export type PongPhase = 'ready' | 'serve' | 'play' | 'break' | 'over';

export interface PongState {
  version: 1;
  rng: RngState;
  tick: number;
  phase: PongPhase;
  /** Runde ab 1 – bestimmt die Stärke des Gegners. */
  round: number;
  playerPoints: number;
  cpuPoints: number;
  roundsWon: number;
  score: number;
  playerX: number;
  cpuX: number;
  left: boolean;
  right: boolean;
  ballX: number;
  ballY: number;
  dx: number;
  dy: number;
  speed: number;
  /** Restschritte bis zum Aufschlag bzw. bis zur nächsten Runde. */
  wait: number;
  /** +1 Aufschlag nach unten (zum Spieler), −1 nach oben. */
  serveDir: number;
  /** Absichtlicher Versatz, mit dem der Computer den Ball anpeilt (Fehler + Zielen). */
  cpuAim: number;
  /** Zähler nur für Geräusche. */
  hits: number;
  walls: number;
  lastPoint: 'player' | 'cpu' | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function setDir(state: PongState, dx: number, dy: number): void {
  const len = Math.sqrt(dx * dx + dy * dy);
  state.dx = dx / len;
  state.dy = dy / len;
}

/** Wie stark der Computer in Runde `round` ist: 0 = Anfänger. */
function skill(state: PongState): number {
  return state.round - 1;
}

function cpuMaxSpeed(state: PongState): number {
  return Math.min(2.1 + 0.55 * skill(state), 7.5);
}

/** Neuer Zielversatz: große Streuung in frühen Runden, später gezielte Kantenschläge. */
function chooseAim(state: PongState): void {
  const s = skill(state);
  const error = Math.max(3, 24 - 4 * s);
  let aim = (nextRandom(state.rng) - 0.5) * 2 * error;
  if (s >= 2) {
    // Den Ball zur Seite lenken, auf der der Spieler gerade nicht steht.
    const want = state.playerX < PONG_W / 2 ? 1 : -1;
    aim -= want * Math.min(6 + 3 * s, 20);
  }
  state.cpuAim = aim;
}

/** Wo trifft der Ball auf der Höhe des Computerschlägers ein (mit Bande)? */
function predictCpuX(state: PongState): number {
  const targetY = PONG_CPU_Y + PONG_PADDLE_H + PONG_BALL_R;
  if (state.dy >= 0) return state.ballX;
  const t = (state.ballY - targetY) / -state.dy;
  const x = state.ballX + state.dx * t;
  const span = PONG_W - 2 * PONG_BALL_R;
  let m = (x - PONG_BALL_R) % (2 * span);
  if (m < 0) m += 2 * span;
  if (m > span) m = 2 * span - m;
  return PONG_BALL_R + m;
}

function moveCpu(state: PongState): void {
  const s = skill(state);
  const half = PONG_PADDLE_W / 2;
  const reactY = PONG_H * Math.min(0.45 + 0.1 * s, 1);
  let target = PONG_W / 2;
  let maxSpeed = cpuMaxSpeed(state);
  if (state.phase === 'play' && state.dy < 0 && state.ballY < reactY) {
    // Anfänger laufen dem Ball hinterher, ab Runde 3 rechnet der Gegner die Bande voraus.
    const aimAt = s >= 2 ? predictCpuX(state) : state.ballX;
    target = aimAt + state.cpuAim;
  } else {
    maxSpeed *= 0.5;
  }
  const delta = clamp(target - state.cpuX, -maxSpeed, maxSpeed);
  state.cpuX = clamp(state.cpuX + delta, half, PONG_W - half);
}

function centerBall(state: PongState): void {
  state.ballX = PONG_W / 2;
  state.ballY = PONG_H / 2;
  state.dx = 0;
  state.dy = 0;
}

function serve(state: PongState): void {
  state.phase = 'play';
  state.speed = Math.min(3 + 0.2 * skill(state), 5);
  const offset = (nextRandom(state.rng) - 0.5) * 1.2;
  setDir(state, offset, state.serveDir);
  chooseAim(state);
}

function pointScored(state: PongState, byPlayer: boolean): void {
  state.lastPoint = byPlayer ? 'player' : 'cpu';
  if (byPlayer) {
    state.playerPoints += 1;
    state.score += 100;
  } else {
    state.cpuPoints += 1;
  }
  centerBall(state);
  if (state.cpuPoints >= PONG_TARGET) {
    state.phase = 'over';
    return;
  }
  if (state.playerPoints >= PONG_TARGET) {
    state.roundsWon += 1;
    state.score += 1000;
    state.phase = 'break';
    state.wait = ROUND_BREAK_TICKS;
    state.serveDir = 1;
    return;
  }
  // Aufschlag geht an den, der den Punkt verloren hat.
  state.serveDir = byPlayer ? -1 : 1;
  state.phase = 'serve';
  state.wait = SERVE_TICKS;
}

function moveBall(state: PongState): void {
  const parts = Math.ceil(state.speed / 3);
  const dist = state.speed / parts;
  const r = PONG_BALL_R;
  const half = PONG_PADDLE_W / 2;
  for (let i = 0; i < parts; i += 1) {
    const prevY = state.ballY;
    state.ballX += state.dx * dist;
    state.ballY += state.dy * dist;
    if (state.ballX < r) {
      state.ballX = r;
      state.dx = Math.abs(state.dx);
      state.walls += 1;
    } else if (state.ballX > PONG_W - r) {
      state.ballX = PONG_W - r;
      state.dx = -Math.abs(state.dx);
      state.walls += 1;
    }
    // Spielerschläger (unten)
    if (
      state.dy > 0 &&
      prevY + r <= PONG_PLAYER_Y + 2 &&
      state.ballY + r >= PONG_PLAYER_Y &&
      Math.abs(state.ballX - state.playerX) <= half + r
    ) {
      state.ballY = PONG_PLAYER_Y - r;
      const offset = clamp((state.ballX - state.playerX) / (half + r), -1, 1);
      setDir(state, offset * SPREAD, -1);
      state.speed = Math.min(state.speed + 0.2, MAX_BALL_SPEED);
      state.score += 10;
      state.hits += 1;
      chooseAim(state);
      return;
    }
    // Computerschläger (oben)
    const cpuBottom = PONG_CPU_Y + PONG_PADDLE_H;
    if (
      state.dy < 0 &&
      prevY - r >= cpuBottom - 2 &&
      state.ballY - r <= cpuBottom &&
      Math.abs(state.ballX - state.cpuX) <= half + r
    ) {
      state.ballY = cpuBottom + r;
      const offset = clamp((state.ballX - state.cpuX) / (half + r), -1, 1);
      setDir(state, offset * SPREAD, 1);
      state.speed = Math.min(state.speed + 0.2, MAX_BALL_SPEED);
      state.hits += 1;
      return;
    }
    if (state.ballY - r > PONG_H) {
      pointScored(state, false);
      return;
    }
    if (state.ballY + r < 0) {
      pointScored(state, true);
      return;
    }
  }
}

function handleInput(state: PongState, input: ArcadeInput): void {
  if (input === ARCADE_INPUT_LEFT) state.left = true;
  else if (input === ARCADE_INPUT_RIGHT) state.right = true;
  else if (input === ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE) state.left = false;
  else if (input === ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE) state.right = false;
  if (
    state.phase === 'ready' &&
    (input === ARCADE_INPUT_ACTION ||
      input === ARCADE_INPUT_UP ||
      input === ARCADE_INPUT_LEFT ||
      input === ARCADE_INPUT_RIGHT)
  ) {
    state.phase = 'serve';
    state.wait = SERVE_TICKS;
  }
}

export const game: RealtimeGame<PongState> = {
  kind: 'realtime',
  id: 'ballwechsel',
  version: 1,

  create(seed) {
    return {
      version: 1,
      rng: createRng(seed),
      tick: 0,
      phase: 'ready',
      round: 1,
      playerPoints: 0,
      cpuPoints: 0,
      roundsWon: 0,
      score: 0,
      playerX: PONG_W / 2,
      cpuX: PONG_W / 2,
      left: false,
      right: false,
      ballX: PONG_W / 2,
      ballY: PONG_H / 2,
      dx: 0,
      dy: 0,
      speed: 0,
      wait: 0,
      serveDir: 1,
      cpuAim: 0,
      hits: 0,
      walls: 0,
      lastPoint: null,
    };
  },

  step(state, input) {
    if (state.phase === 'over') return state;
    state.tick += 1;
    handleInput(state, input);

    const half = PONG_PADDLE_W / 2;
    const dir = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    state.playerX = clamp(state.playerX + dir * PLAYER_SPEED, half, PONG_W - half);

    if (state.phase === 'serve' || state.phase === 'break') {
      state.wait -= 1;
      if (state.wait <= 0) {
        if (state.phase === 'break') {
          state.round += 1;
          state.playerPoints = 0;
          state.cpuPoints = 0;
        }
        serve(state);
      }
    } else if (state.phase === 'play') {
      moveBall(state);
    }
    moveCpu(state);
    return state;
  },

  isOver: (state) => state.phase === 'over',
  score: (state) => state.score,
  tickMs: () => 16,
};
