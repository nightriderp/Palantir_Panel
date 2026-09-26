/**
 * Breakout („Steinbrecher") – Ball, Schläger und eine Mauer, Level um Level.
 *
 * Fester Takt von 16 ms. Gerechnet wird mit Gleitkommazahlen, aber nur mit
 * Grundrechenarten und `Math.sqrt`: Die sind nach IEEE 754 exakt festgelegt,
 * `Math.sin`/`Math.hypot` dagegen dürfen je Engine im letzten Bit abweichen –
 * und das Backend (Node) muss dieselbe Partie nachrechnen, die ein Firefox
 * gespielt hat. Winkel entstehen deshalb als normierte Vektoren.
 *
 * Der Ball bewegt sich achsenweise in kleinen Teilschritten. So prallt er an
 * einem Stein immer an der Seite ab, über die er gekommen ist, und kann bei
 * hohem Tempo nicht durch einen Stein tunneln.
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
import { createRng, nextInt, nextRandom, type RngState } from '../rng.js';

export const BREAKOUT_W = 360;
export const BREAKOUT_H = 480;
export const BREAKOUT_PADDLE_Y = 440;
export const BREAKOUT_PADDLE_H = 10;
export const BREAKOUT_BALL_R = 5;
export const BREAKOUT_COLS = 12;
export const BREAKOUT_BRICK_W = 28;
export const BREAKOUT_BRICK_H = 14;
export const BREAKOUT_LEFT = 12;
export const BREAKOUT_TOP = 60;

const PADDLE_W = 60;
const PADDLE_W_WIDE = 96;
const PADDLE_SPEED = 6.5;
const MAX_BALLS = 6;
const MAX_LIVES = 9;
const START_LIVES = 3;
const CAPSULE_SPEED = 1.6;
const CAPSULE_CHANCE = 0.14;
const WIDE_TICKS = 900;
const SLOW_TICKS = 720;
/** Kleinster senkrechter Anteil der Flugrichtung – sonst pendelt der Ball ewig waagerecht. */
const MIN_DY = 0.3;
/** Steilster Abprallwinkel am Schlägerrand: Richtung (±1,6 | −1), also gut 58°. */
const PADDLE_SPREAD = 1.6;

/** Extras, die aus zerstörten Steinen fallen. */
export const CAPSULE_WIDE = 0;
export const CAPSULE_MULTI = 1;
export const CAPSULE_SLOW = 2;
export const CAPSULE_LIFE = 3;

/** Hartstein: unzerstörbar, zählt nicht zur Mauer. */
export const STEEL = 9;

/**
 * Eigene Level. `.` leer, `1`–`3` Trefferpunkte, `S` Hartstein. Nach dem
 * fünften beginnt die Folge von vorn, jede Runde schneller.
 */
export const BREAKOUT_LEVELS: readonly (readonly string[])[] = [
  // Regenbogen
  ['222222222222', '111111111111', '111111111111', '111111111111', '111111111111', '111111111111'],
  // Pyramide
  [
    '.....33.....',
    '....2222....',
    '...111111...',
    '..22222222..',
    '.1111111111.',
    '222222222222',
    '111111111111',
  ],
  // Zinnen
  [
    '3.3.3.3.3.3.',
    '.2.2.2.2.2.2',
    '222222222222',
    '1111SSSS1111',
    '111111111111',
    '............',
    '22........22',
  ],
  // Grinsegesicht
  [
    '...222222...',
    '..21111112..',
    '.2131111312.',
    '.2111111112.',
    '.2131111312.',
    '.2113333112.',
    '..21111112..',
    '...222222...',
  ],
  // Tresor
  [
    '333333333333',
    '3S22222222S3',
    '3.21111112.3',
    '3.21SSSS12.3',
    '3.21111112.3',
    '3S22222222S3',
    '333333333333',
  ],
];

export interface BreakoutBrick {
  c: number;
  r: number;
  /** Verbleibende Treffer; 0 = weg. Hartsteine haben `max === STEEL`. */
  hp: number;
  max: number;
}

export interface BreakoutBall {
  x: number;
  y: number;
  /** Einheitsvektor der Flugrichtung; das Tempo ist für alle Bälle gleich. */
  dx: number;
  dy: number;
}

export interface BreakoutCapsule {
  x: number;
  y: number;
  kind: number;
}

export interface BreakoutState {
  version: 1;
  rng: RngState;
  tick: number;
  over: boolean;
  score: number;
  lives: number;
  /** Laufende Levelnummer ab 0; `level % 5` wählt das Layout. */
  level: number;
  paddleX: number;
  left: boolean;
  right: boolean;
  /** Ball liegt auf dem Schläger und wartet auf ACTION. */
  stuck: boolean;
  balls: BreakoutBall[];
  bricks: BreakoutBrick[];
  capsules: BreakoutCapsule[];
  wideTicks: number;
  slowTicks: number;
  /** Schlägertreffer seit dem letzten Ballverlust – jeder macht den Ball etwas schneller. */
  paddleHits: number;
  /** Ab hier nur für Anzeige und Geräusche. */
  bannerTicks: number;
  bricksBroken: number;
  bounces: number;
  powerups: number;
  livesLost: number;
}

function buildBricks(level: number): BreakoutBrick[] {
  const layout = BREAKOUT_LEVELS[level % BREAKOUT_LEVELS.length] ?? [];
  const bricks: BreakoutBrick[] = [];
  layout.forEach((row, r) => {
    for (let c = 0; c < BREAKOUT_COLS; c += 1) {
      const ch = row[c] ?? '.';
      if (ch === 'S') bricks.push({ c, r, hp: 1, max: STEEL });
      else if (ch >= '1' && ch <= '3') {
        const hp = Number(ch);
        bricks.push({ c, r, hp, max: hp });
      }
    }
  });
  return bricks;
}

export function paddleWidth(state: BreakoutState): number {
  return state.wideTicks > 0 ? PADDLE_W_WIDE : PADDLE_W;
}

/** Balltempo in Pixeln je Schritt. */
export function ballSpeed(state: BreakoutState): number {
  const loop = Math.floor(state.level / BREAKOUT_LEVELS.length);
  const base = Math.min(3.2 + 0.2 * (state.level % BREAKOUT_LEVELS.length) + 0.7 * loop, 6.5);
  const boost = Math.min(state.paddleHits * 0.03, 1.8);
  const speed = base + boost;
  return state.slowTicks > 0 ? speed * 0.65 : speed;
}

function normalize(ball: BreakoutBall, dx: number, dy: number): void {
  const len = Math.sqrt(dx * dx + dy * dy);
  ball.dx = dx / len;
  ball.dy = dy / len;
}

/** Verhindert fast waagerechte Flugbahnen nach Abprallern. */
function keepSteep(ball: BreakoutBall): void {
  if (Math.abs(ball.dy) >= MIN_DY) return;
  const sy = ball.dy < 0 ? -1 : 1;
  const sx = ball.dx < 0 ? -1 : 1;
  ball.dy = sy * MIN_DY;
  ball.dx = sx * Math.sqrt(1 - MIN_DY * MIN_DY);
}

function brickRect(brick: BreakoutBrick): { x: number; y: number } {
  return {
    x: BREAKOUT_LEFT + brick.c * BREAKOUT_BRICK_W,
    y: BREAKOUT_TOP + brick.r * BREAKOUT_BRICK_H,
  };
}

function overlappingBrick(state: BreakoutState, ball: BreakoutBall): BreakoutBrick | null {
  const r = BREAKOUT_BALL_R;
  for (const brick of state.bricks) {
    if (brick.hp <= 0) continue;
    const { x, y } = brickRect(brick);
    if (
      ball.x + r > x &&
      ball.x - r < x + BREAKOUT_BRICK_W &&
      ball.y + r > y &&
      ball.y - r < y + BREAKOUT_BRICK_H
    ) {
      return brick;
    }
  }
  return null;
}

function hitBrick(state: BreakoutState, brick: BreakoutBrick): void {
  state.bounces += 1;
  if (brick.max === STEEL) return;
  const loop = Math.floor(state.level / BREAKOUT_LEVELS.length);
  brick.hp -= 1;
  if (brick.hp > 0) {
    state.score += 5 * (1 + loop);
    return;
  }
  state.score += 10 * brick.max * (1 + loop);
  state.bricksBroken += 1;
  if (nextRandom(state.rng) < CAPSULE_CHANCE) {
    // Extraleben seltener als der Rest – sonst wird die Partie endlos.
    const roll = nextInt(state.rng, 10);
    const kind =
      roll < 3 ? CAPSULE_WIDE : roll < 6 ? CAPSULE_MULTI : roll < 9 ? CAPSULE_SLOW : CAPSULE_LIFE;
    const { x, y } = brickRect(brick);
    state.capsules.push({ x: x + BREAKOUT_BRICK_W / 2, y: y + BREAKOUT_BRICK_H / 2, kind });
  }
}

function placeOnPaddle(state: BreakoutState): void {
  state.stuck = true;
  state.balls = [
    {
      x: state.paddleX,
      y: BREAKOUT_PADDLE_Y - BREAKOUT_BALL_R - 1,
      dx: 0,
      dy: -1,
    },
  ];
}

function launch(state: BreakoutState): void {
  const ball = state.balls[0];
  if (!state.stuck || !ball) return;
  state.stuck = false;
  const offset = (nextRandom(state.rng) - 0.5) * 0.6;
  normalize(ball, offset * PADDLE_SPREAD, -1);
}

function applyCapsule(state: BreakoutState, kind: number): void {
  state.powerups += 1;
  state.score += 50;
  if (kind === CAPSULE_WIDE) state.wideTicks = WIDE_TICKS;
  else if (kind === CAPSULE_SLOW) state.slowTicks = SLOW_TICKS;
  else if (kind === CAPSULE_LIFE) state.lives = Math.min(MAX_LIVES, state.lives + 1);
  else if (kind === CAPSULE_MULTI) {
    if (state.stuck) launch(state);
    const spawned: BreakoutBall[] = [];
    for (const ball of state.balls) {
      for (const turn of [-0.5, 0.5]) {
        if (state.balls.length + spawned.length >= MAX_BALLS) break;
        const copy: BreakoutBall = { x: ball.x, y: ball.y, dx: 0, dy: -1 };
        normalize(copy, ball.dx + turn, ball.dy);
        keepSteep(copy);
        spawned.push(copy);
      }
    }
    state.balls.push(...spawned);
  }
}

function moveBall(state: BreakoutState, ball: BreakoutBall, dist: number): void {
  const r = BREAKOUT_BALL_R;
  // Waagerecht
  ball.x += ball.dx * dist;
  if (ball.x - r < 0) {
    ball.x = r;
    ball.dx = Math.abs(ball.dx);
    state.bounces += 1;
  } else if (ball.x + r > BREAKOUT_W) {
    ball.x = BREAKOUT_W - r;
    ball.dx = -Math.abs(ball.dx);
    state.bounces += 1;
  } else {
    const brick = overlappingBrick(state, ball);
    if (brick) {
      ball.x -= ball.dx * dist;
      ball.dx = -ball.dx;
      hitBrick(state, brick);
    }
  }
  // Senkrecht
  const prevBottom = ball.y + r;
  ball.y += ball.dy * dist;
  if (ball.y - r < 0) {
    ball.y = r;
    ball.dy = Math.abs(ball.dy);
    state.bounces += 1;
  } else {
    const brick = overlappingBrick(state, ball);
    if (brick) {
      ball.y -= ball.dy * dist;
      ball.dy = -ball.dy;
      hitBrick(state, brick);
      keepSteep(ball);
    }
  }
  // Schläger: nur von oben, und nur wenn der Ball die Oberkante gerade erreicht.
  const half = paddleWidth(state) / 2;
  if (
    ball.dy > 0 &&
    prevBottom <= BREAKOUT_PADDLE_Y + 2 &&
    ball.y + r >= BREAKOUT_PADDLE_Y &&
    ball.x >= state.paddleX - half - r &&
    ball.x <= state.paddleX + half + r
  ) {
    ball.y = BREAKOUT_PADDLE_Y - r;
    const rel = (ball.x - state.paddleX) / (half + r);
    const offset = rel < -1 ? -1 : rel > 1 ? 1 : rel;
    normalize(ball, offset * PADDLE_SPREAD, -1);
    state.paddleHits += 1;
    state.bounces += 1;
  }
}

function loseLife(state: BreakoutState): void {
  state.lives -= 1;
  state.livesLost += 1;
  state.capsules = [];
  state.wideTicks = 0;
  state.slowTicks = 0;
  state.paddleHits = 0;
  if (state.lives <= 0) {
    state.lives = 0;
    state.over = true;
    state.balls = [];
    return;
  }
  placeOnPaddle(state);
}

function nextLevel(state: BreakoutState): void {
  state.level += 1;
  state.score += 250 * state.level;
  state.bricks = buildBricks(state.level);
  state.capsules = [];
  state.wideTicks = 0;
  state.slowTicks = 0;
  state.paddleHits = 0;
  state.bannerTicks = 120;
  placeOnPaddle(state);
}

function handleInput(state: BreakoutState, input: ArcadeInput): void {
  if (input === ARCADE_INPUT_LEFT) state.left = true;
  else if (input === ARCADE_INPUT_RIGHT) state.right = true;
  else if (input === ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE) state.left = false;
  else if (input === ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE) state.right = false;
  else if (input === ARCADE_INPUT_ACTION || input === ARCADE_INPUT_UP) launch(state);
}

export const game: RealtimeGame<BreakoutState> = {
  kind: 'realtime',
  id: 'steinbrecher',
  version: 1,

  create(seed) {
    const state: BreakoutState = {
      version: 1,
      rng: createRng(seed),
      tick: 0,
      over: false,
      score: 0,
      lives: START_LIVES,
      level: 0,
      paddleX: BREAKOUT_W / 2,
      left: false,
      right: false,
      stuck: true,
      balls: [],
      bricks: buildBricks(0),
      capsules: [],
      wideTicks: 0,
      slowTicks: 0,
      paddleHits: 0,
      bannerTicks: 120,
      bricksBroken: 0,
      bounces: 0,
      powerups: 0,
      livesLost: 0,
    };
    placeOnPaddle(state);
    return state;
  },

  step(state, input) {
    if (state.over) return state;
    state.tick += 1;
    handleInput(state, input);
    if (state.bannerTicks > 0) state.bannerTicks -= 1;

    // Schläger
    const dir = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    const half = paddleWidth(state) / 2;
    state.paddleX += dir * PADDLE_SPEED;
    if (state.paddleX < half) state.paddleX = half;
    if (state.paddleX > BREAKOUT_W - half) state.paddleX = BREAKOUT_W - half;

    if (state.stuck) {
      const ball = state.balls[0];
      if (ball) ball.x = state.paddleX;
      return state;
    }

    if (state.wideTicks > 0) state.wideTicks -= 1;
    if (state.slowTicks > 0) state.slowTicks -= 1;

    // Bälle in Teilschritten von höchstens 2,5 px
    const speed = ballSpeed(state);
    const parts = Math.ceil(speed / 2.5);
    const dist = speed / parts;
    for (let i = 0; i < parts; i += 1) {
      for (const ball of state.balls) moveBall(state, ball, dist);
    }
    state.balls = state.balls.filter((ball) => ball.y - BREAKOUT_BALL_R <= BREAKOUT_H);

    // Extras fallen
    const halfNow = paddleWidth(state) / 2;
    const kept: BreakoutCapsule[] = [];
    for (const capsule of state.capsules) {
      capsule.y += CAPSULE_SPEED;
      const caught =
        capsule.y + 6 >= BREAKOUT_PADDLE_Y &&
        capsule.y - 6 <= BREAKOUT_PADDLE_Y + BREAKOUT_PADDLE_H &&
        Math.abs(capsule.x - state.paddleX) <= halfNow + 12;
      if (caught) applyCapsule(state, capsule.kind);
      else if (capsule.y - 6 <= BREAKOUT_H) kept.push(capsule);
    }
    state.capsules = kept;

    if (state.bricks.every((brick) => brick.hp <= 0 || brick.max === STEEL)) {
      nextLevel(state);
    } else if (state.balls.length === 0) {
      loseLife(state);
    }
    return state;
  },

  isOver: (state) => state.over,
  score: (state) => state.score,
  tickMs: () => 16,
};
