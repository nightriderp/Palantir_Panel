import { ARCADE_PALETTE } from '../engine/palette';
import {
  type ArcadeGame,
  type ControlPhase,
  type GameControl,
  type GamePhase,
} from '../engine/types';

/**
 * „Ballwechsel" – eigenständiges Spiel in der Tradition der Schläger-Spiele
 * (Lastenheft §3.9, kein Originaltitel).
 *
 * Dein Schläger liegt unten und bewegt sich waagerecht; oben wehrt ein Gegner
 * ab. Jeder eigene Treffer zählt, jeder verpasste Ball des Gegners bringt einen
 * Bonus. Vorbei ist es, wenn der Ball an dir unten vorbeikommt. Das waagerechte
 * Steuern ist bewusst für das Smartphone gewählt (Mobile-First, Lastenheft §4).
 */

interface BallwechselState {
  readonly w: number;
  readonly h: number;
  readonly paddleW: number;
  readonly paddleH: number;
  readonly radius: number;
  playerX: number;
  aiX: number;
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  speed: number;
  moveDir: -1 | 0 | 1;
  score: number;
  phase: GamePhase;
  random: () => number;
}

const W = 480;
const H = 480;
const PADDLE_W = 96;
const PADDLE_H = 14;
const RADIUS = 9;
const PLAYER_Y = H - 30;
const AI_Y = 30;
const PLAYER_SPEED = 0.62; // px/ms
const AI_SPEED = 0.34; // px/ms – langsamer als der Ball, damit er verlieren kann
const BASE_SPEED = 0.3; // px/ms
const MAX_SPEED = 0.62;

function launch(state: BallwechselState, downward: boolean): void {
  state.ballX = state.w / 2;
  state.ballY = state.h / 2;
  state.speed = BASE_SPEED;
  const angle = (state.random() * 0.6 - 0.3) * Math.PI; // ±54° um die Senkrechte
  state.vx = Math.sin(angle) * state.speed;
  state.vy = (downward ? 1 : -1) * Math.cos(angle) * state.speed;
}

function normalizeSpeed(state: BallwechselState): void {
  const magnitude = Math.hypot(state.vx, state.vy) || 1;
  state.vx = (state.vx / magnitude) * state.speed;
  state.vy = (state.vy / magnitude) * state.speed;
}

export const ballwechsel: ArcadeGame<BallwechselState> = {
  id: 'ballwechsel',
  instructions: 'Pfeil links/rechts oder die Wischtasten: halte den Ball unten im Spiel.',
  touch: 'horizontal',
  view: { width: W, height: H },

  create(random = Math.random) {
    const state: BallwechselState = {
      w: W,
      h: H,
      paddleW: PADDLE_W,
      paddleH: PADDLE_H,
      radius: RADIUS,
      playerX: W / 2,
      aiX: W / 2,
      ballX: W / 2,
      ballY: H / 2,
      vx: 0,
      vy: 0,
      speed: BASE_SPEED,
      moveDir: 0,
      score: 0,
      phase: 'ready',
      random,
    };
    launch(state, true);
    return state;
  },

  step(state, dtMs) {
    if (state.phase !== 'running') return state;
    // Große Zeitsprünge begrenzen, damit der Ball nicht durch den Schläger springt.
    const dt = Math.min(dtMs, 32);

    const half = state.paddleW / 2;
    state.playerX = Math.max(
      half,
      Math.min(state.w - half, state.playerX + state.moveDir * PLAYER_SPEED * dt),
    );

    // Gegner folgt dem Ball mit begrenztem Tempo.
    const aiTarget = state.ballX;
    const aiDelta = aiTarget - state.aiX;
    const aiMove = Math.max(-AI_SPEED * dt, Math.min(AI_SPEED * dt, aiDelta));
    state.aiX = Math.max(half, Math.min(state.w - half, state.aiX + aiMove));

    state.ballX += state.vx * dt;
    state.ballY += state.vy * dt;

    // Seitenwände.
    if (state.ballX - state.radius < 0) {
      state.ballX = state.radius;
      state.vx = Math.abs(state.vx);
    } else if (state.ballX + state.radius > state.w) {
      state.ballX = state.w - state.radius;
      state.vx = -Math.abs(state.vx);
    }

    // Eigener Schläger (Ball fällt).
    if (
      state.vy > 0 &&
      state.ballY + state.radius >= PLAYER_Y &&
      state.ballY + state.radius <= PLAYER_Y + state.paddleH + 12 &&
      Math.abs(state.ballX - state.playerX) <= half + state.radius
    ) {
      state.ballY = PLAYER_Y - state.radius;
      state.vy = -Math.abs(state.vy);
      state.vx += ((state.ballX - state.playerX) / half) * 0.18;
      state.score += 1;
      state.speed = Math.min(MAX_SPEED, state.speed + 0.012);
      normalizeSpeed(state);
    }

    // Gegner-Schläger (Ball steigt).
    if (
      state.vy < 0 &&
      state.ballY - state.radius <= AI_Y + state.paddleH &&
      state.ballY - state.radius >= AI_Y - 12 &&
      Math.abs(state.ballX - state.aiX) <= half + state.radius
    ) {
      state.ballY = AI_Y + state.paddleH + state.radius;
      state.vy = Math.abs(state.vy);
      state.vx += ((state.ballX - state.aiX) / half) * 0.12;
      normalizeSpeed(state);
    }

    // Gegner verfehlt oben: Bonus, weiter geht's.
    if (state.ballY + state.radius < 0) {
      state.score += 10;
      launch(state, true);
    }

    // Am eigenen Schläger vorbei: vorbei.
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
    return state;
  },

  phase: (state) => state.phase,
  score: (state) => state.score,

  render(ctx, state, view) {
    ctx.fillStyle = ARCADE_PALETTE.field;
    ctx.fillRect(0, 0, view.width, view.height);

    // Mittellinie.
    ctx.strokeStyle = ARCADE_PALETTE.grid;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(0, view.height / 2);
    ctx.lineTo(view.width, view.height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const half = state.paddleW / 2;
    // Gegner.
    ctx.fillStyle = ARCADE_PALETTE.danger;
    ctx.fillRect(state.aiX - half, AI_Y, state.paddleW, state.paddleH);
    // Spieler.
    ctx.fillStyle = ARCADE_PALETTE.brand;
    ctx.fillRect(state.playerX - half, PLAYER_Y, state.paddleW, state.paddleH);

    // Ball.
    ctx.fillStyle = ARCADE_PALETTE.accent;
    ctx.beginPath();
    ctx.arc(state.ballX, state.ballY, state.radius, 0, Math.PI * 2);
    ctx.fill();
  },
};
