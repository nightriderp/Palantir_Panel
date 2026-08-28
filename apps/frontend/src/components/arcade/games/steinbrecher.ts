import { ARCADE_PALETTE } from '../engine/palette';
import {
  type ArcadeGame,
  type ControlPhase,
  type GameControl,
  type GamePhase,
} from '../engine/types';

/**
 * „Steinbrecher" – eigenständiges Spiel in der Tradition der Ausbrecher-Spiele
 * (Lastenheft §3.9, kein Originaltitel, keine Original-Level).
 *
 * Ein Ball springt gegen eine Mauer aus Blöcken. Fange ihn mit dem Schläger auf
 * und räume Reihe um Reihe ab. Ist die Mauer weg, kommt eine neue – etwas
 * schneller. Vorbei ist es, wenn der Ball unten durchfällt.
 */

interface Brick {
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
  color: string;
}

interface SteinbrecherState {
  readonly w: number;
  readonly h: number;
  readonly paddleW: number;
  readonly paddleH: number;
  readonly radius: number;
  playerX: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  speed: number;
  bricks: Brick[];
  moveDir: -1 | 0 | 1;
  launched: boolean;
  score: number;
  phase: GamePhase;
  random: () => number;
}

const W = 480;
const H = 480;
const PADDLE_W = 96;
const PADDLE_H = 14;
const RADIUS = 8;
const PADDLE_Y = H - 28;
const COLS = 8;
const ROWS = 6;
const TOP = 56;
const BRICK_H = 22;
const GAP = 4;
const PLAYER_SPEED = 0.64;
const BASE_SPEED = 0.34;
const MAX_SPEED = 0.6;

const ROW_COLORS = [
  ARCADE_PALETTE.danger,
  ARCADE_PALETTE.warning,
  ARCADE_PALETTE.warning,
  ARCADE_PALETTE.accent,
  ARCADE_PALETTE.accent,
  ARCADE_PALETTE.brand,
];

function buildWall(): Brick[] {
  const bricks: Brick[] = [];
  const brickW = (W - GAP * (COLS + 1)) / COLS;
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      bricks.push({
        x: GAP + col * (brickW + GAP),
        y: TOP + row * (BRICK_H + GAP),
        w: brickW,
        h: BRICK_H,
        alive: true,
        color: ROW_COLORS[row] ?? ARCADE_PALETTE.brand,
      });
    }
  }
  return bricks;
}

function resetBall(state: SteinbrecherState): void {
  state.ballX = state.playerX;
  state.ballY = PADDLE_Y - state.radius - 1;
  state.vx = 0;
  state.vy = 0;
  state.launched = false;
}

function launchBall(state: SteinbrecherState): void {
  const angle = (state.random() * 0.5 - 0.25) * Math.PI;
  state.vx = Math.sin(angle) * state.speed;
  state.vy = -Math.abs(Math.cos(angle) * state.speed);
  state.launched = true;
}

export const steinbrecher: ArcadeGame<SteinbrecherState> = {
  id: 'steinbrecher',
  instructions: 'Pfeil links/rechts bewegt den Schläger. Fange den Ball, räume die Mauer ab.',
  touch: 'horizontal',
  view: { width: W, height: H },

  create(random = Math.random) {
    const state: SteinbrecherState = {
      w: W,
      h: H,
      paddleW: PADDLE_W,
      paddleH: PADDLE_H,
      radius: RADIUS,
      playerX: W / 2,
      ballX: W / 2,
      ballY: PADDLE_Y - RADIUS - 1,
      vx: 0,
      vy: 0,
      speed: BASE_SPEED,
      bricks: buildWall(),
      moveDir: 0,
      launched: false,
      score: 0,
      phase: 'ready',
      random,
    };
    return state;
  },

  step(state, dtMs) {
    if (state.phase !== 'running') return state;
    const dt = Math.min(dtMs, 32);
    const half = state.paddleW / 2;

    state.playerX = Math.max(
      half,
      Math.min(state.w - half, state.playerX + state.moveDir * PLAYER_SPEED * dt),
    );

    if (!state.launched) {
      state.ballX = state.playerX;
      return state;
    }

    state.ballX += state.vx * dt;
    state.ballY += state.vy * dt;

    if (state.ballX - state.radius < 0) {
      state.ballX = state.radius;
      state.vx = Math.abs(state.vx);
    } else if (state.ballX + state.radius > state.w) {
      state.ballX = state.w - state.radius;
      state.vx = -Math.abs(state.vx);
    }
    if (state.ballY - state.radius < 0) {
      state.ballY = state.radius;
      state.vy = Math.abs(state.vy);
    }

    // Schläger.
    if (
      state.vy > 0 &&
      state.ballY + state.radius >= PADDLE_Y &&
      state.ballY + state.radius <= PADDLE_Y + state.paddleH + 12 &&
      Math.abs(state.ballX - state.playerX) <= half + state.radius
    ) {
      state.ballY = PADDLE_Y - state.radius;
      state.vy = -Math.abs(state.vy);
      state.vx += ((state.ballX - state.playerX) / half) * 0.2;
      const mag = Math.hypot(state.vx, state.vy) || 1;
      state.vx = (state.vx / mag) * state.speed;
      state.vy = (state.vy / mag) * state.speed;
    }

    // Blöcke.
    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      if (
        state.ballX + state.radius < brick.x ||
        state.ballX - state.radius > brick.x + brick.w ||
        state.ballY + state.radius < brick.y ||
        state.ballY - state.radius > brick.y + brick.h
      ) {
        continue;
      }
      brick.alive = false;
      state.score += 10;

      // Reflexionsachse nach geringerer Überlappung wählen.
      const overlapX = Math.min(
        state.ballX + state.radius - brick.x,
        brick.x + brick.w - (state.ballX - state.radius),
      );
      const overlapY = Math.min(
        state.ballY + state.radius - brick.y,
        brick.y + brick.h - (state.ballY - state.radius),
      );
      if (overlapX < overlapY) {
        state.vx = -state.vx;
      } else {
        state.vy = -state.vy;
      }
      break;
    }

    // Mauer abgeräumt: neue, schneller.
    if (state.bricks.every((brick) => !brick.alive)) {
      state.speed = Math.min(MAX_SPEED, state.speed + 0.04);
      state.bricks = buildWall();
      resetBall(state);
    }

    // Unten durch: vorbei.
    if (state.ballY - state.radius > state.h) {
      state.phase = 'over';
    }

    return state;
  },

  control(state, control: GameControl, phase: ControlPhase) {
    if (state.phase === 'over') return state;
    if (phase === 'press' && state.phase === 'ready') state.phase = 'running';

    if (control === 'left') {
      state.moveDir = phase === 'press' ? -1 : state.moveDir === -1 ? 0 : state.moveDir;
    } else if (control === 'right') {
      state.moveDir = phase === 'press' ? 1 : state.moveDir === 1 ? 0 : state.moveDir;
    }

    // Erster Tastendruck schießt den Ball ab – die Touch-Steuerung kennt nur
    // Links/Rechts, deshalb bewusst kein eigener Abschuss-Knopf.
    if (phase === 'press' && !state.launched && state.phase === 'running') {
      launchBall(state);
    }
    return state;
  },

  phase: (state) => state.phase,
  score: (state) => state.score,

  render(ctx, state, view) {
    ctx.fillStyle = ARCADE_PALETTE.field;
    ctx.fillRect(0, 0, view.width, view.height);

    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = brick.color;
      ctx.fillRect(brick.x, brick.y, brick.w, brick.h);
    }

    const half = state.paddleW / 2;
    ctx.fillStyle = ARCADE_PALETTE.brand;
    ctx.fillRect(state.playerX - half, PADDLE_Y, state.paddleW, state.paddleH);

    ctx.fillStyle = ARCADE_PALETTE.ink;
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, state.radius, 0, Math.PI * 2);
    ctx.fill();

    if (!state.launched && state.phase === 'running') {
      ctx.fillStyle = ARCADE_PALETTE.muted;
      ctx.font = '16px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Tippen zum Abschuss', view.width / 2, view.height - 60);
    }
  },
};
