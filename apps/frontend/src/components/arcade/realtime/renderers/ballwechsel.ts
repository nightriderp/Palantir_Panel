import { REALTIME_GAMES } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Pong: Neon-Halle im Hochformat, der eigene Schläger
 * unten in Himmelblau (Akzentfarbe), der Computer oben in Orange.
 *
 * Spiegelung der gezeichneten Felder – siehe Kommentar in `steinbrecher.ts`.
 */

interface State {
  tick: number;
  phase: 'ready' | 'serve' | 'play' | 'break' | 'over';
  round: number;
  playerPoints: number;
  cpuPoints: number;
  roundsWon: number;
  score: number;
  playerX: number;
  cpuX: number;
  ballX: number;
  ballY: number;
  wait: number;
  hits: number;
  walls: number;
}

interface Snap {
  hits: number;
  walls: number;
  player: number;
  cpu: number;
  rounds: number;
  over: boolean;
}

const logic = REALTIME_GAMES['ballwechsel'];
if (!logic) throw new Error('ballwechsel fehlt');

const W = 320;
const H = 480;
const PADDLE_W = 56;
const PADDLE_H = 10;
const PLAYER_Y = 446;
const CPU_Y = 24;
const BALL_R = 5;
const TARGET = 7;

/** Namen der Gegner je Runde – danach „Stufe n". */
const OPPONENTS = [
  'Rostlaube',
  'Blechkamerad',
  'Schaltkreis',
  'Turbohirn',
  'Quantenkopf',
  'Der Endgegner',
];

const fx = {
  lastTick: -1,
  trail: [] as { x: number; y: number }[],
  flash: 0,
  flashColor: '#38bdf8',
  lastHits: 0,
  lastTime: 0,
};

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function opponentName(round: number): string {
  return OPPONENTS[round - 1] ?? `Stufe ${round}`;
}

function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  color: string,
): void {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(3,7,18,0.85)';
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

function drawPaddle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  top: string,
  bottom: string,
  glow: string,
): void {
  const g = ctx.createLinearGradient(0, y, 0, y + PADDLE_H);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.shadowColor = glow;
  ctx.shadowBlur = 16;
  ctx.fillStyle = g;
  roundRect(ctx, x - PADDLE_W / 2, y, PADDLE_W, PADDLE_H, 5);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(x - PADDLE_W / 2 + 6, y + 2, PADDLE_W - 12, 2);
}

export const renderer: RealtimeRenderer<State> = {
  id: 'ballwechsel',
  logic,
  view: { width: W, height: H },
  touch: 'horizontal',
  instructions:
    'Pfeil links/rechts (oder A/D) bewegt deinen Schläger unten. Wer zuerst sieben Punkte hat, gewinnt die Runde – jeder Sieg bringt einen stärkeren Gegner.',

  keyInput(key, phase) {
    return defaultKeyInput(key, phase, true);
  },

  render(ctx, state, time) {
    if (state.tick < fx.lastTick) {
      fx.trail = [];
      fx.lastHits = state.hits;
    }
    if (state.tick !== fx.lastTick) {
      if (state.phase === 'play') fx.trail.push({ x: state.ballX, y: state.ballY });
      else fx.trail = [];
      if (fx.trail.length > 10) fx.trail.shift();
    }
    if (state.hits > fx.lastHits) {
      fx.flash = 1;
      fx.flashColor = state.ballY > H / 2 ? '#38bdf8' : '#fb923c';
    }
    fx.lastHits = state.hits;
    fx.lastTick = state.tick;
    const dt = Math.min(Math.max(time - fx.lastTime, 0), 50);
    fx.lastTime = time;
    fx.flash = Math.max(0, fx.flash - dt / 250);

    // Feld
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1c0f08');
    bg.addColorStop(0.5, '#07101f');
    bg.addColorStop(1, '#031a2b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Bodenraster mit leichtem Puls
    ctx.strokeStyle = `rgba(56,189,248,${0.06 + 0.03 * Math.sin(time / 900)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 32) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += 32) {
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    // Große Punktziffern im Hintergrund
    ctx.font = '900 110px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(251,146,60,0.10)';
    ctx.fillText(String(state.cpuPoints), W / 2, H / 4);
    ctx.fillStyle = 'rgba(56,189,248,0.12)';
    ctx.fillText(String(state.playerPoints), W / 2, (H * 3) / 4);

    // Mittellinie
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = 'rgba(226,232,240,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Seitenbanden
    for (const x of [1, W - 1]) {
      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Aufblitzen beim Treffer
    if (fx.flash > 0) {
      ctx.fillStyle = fx.flashColor;
      ctx.globalAlpha = fx.flash * 0.12;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    drawPaddle(ctx, state.cpuX, CPU_Y, '#fed7aa', '#ea580c', '#fb923c');
    drawPaddle(ctx, state.playerX, PLAYER_Y, '#bae6fd', '#0284c7', '#38bdf8');

    // Ballspur
    fx.trail.forEach((p, i) => {
      ctx.fillStyle = `rgba(186,230,253,${(i + 1) / (fx.trail.length * 3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, BALL_R * ((i + 3) / (fx.trail.length + 3)), 0, Math.PI * 2);
      ctx.fill();
    });
    if (state.phase === 'play' || state.phase === 'serve' || state.phase === 'ready') {
      const pulse = state.phase === 'play' ? 0 : Math.sin(time / 150) * 1.5;
      const g = ctx.createRadialGradient(
        state.ballX - 1.5,
        state.ballY - 1.5,
        0.5,
        state.ballX,
        state.ballY,
        BALL_R + 2,
      );
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#7dd3fc');
      ctx.shadowColor = '#e0f2fe';
      ctx.shadowBlur = 14;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(state.ballX, state.ballY, BALL_R + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Kopfzeile: Punkte und Gegner
    ctx.font = 'bold 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fdba74';
    ctx.fillText(`Runde ${state.round} · ${opponentName(state.round)}`, 8, 10);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#bae6fd';
    ctx.fillText(String(state.score).padStart(6, '0'), W - 8, 10);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(186,230,253,0.8)';
    ctx.fillText(`Bis ${TARGET} · Siege ${state.roundsWon}`, 8, H - 12);

    if (state.phase === 'ready') {
      centerText(ctx, 'Pong', H / 2 - 60, 40, '#38bdf8');
      if (Math.floor(time / 500) % 2 === 0)
        centerText(ctx, 'Taste drücken zum Start', H / 2 + 40, 15, '#e0f2fe');
    } else if (state.phase === 'serve' && state.wait > 0) {
      const count = Math.ceil(state.wait / 20);
      centerText(ctx, String(count), H / 2 + 40, 26, '#e0f2fe');
    } else if (state.phase === 'break') {
      centerText(ctx, 'Runde gewonnen!', H / 2 - 40, 28, '#38bdf8');
      centerText(ctx, `+1000 · Nächster Gegner:`, H / 2 + 4, 14, '#e0f2fe');
      centerText(ctx, opponentName(state.round + 1), H / 2 + 28, 18, '#fb923c');
    } else if (state.phase === 'over') {
      ctx.fillStyle = 'rgba(3,7,18,0.6)';
      ctx.fillRect(0, 0, W, H);
      centerText(ctx, 'Game Over', H / 2 - 20, 34, '#fb923c');
      centerText(
        ctx,
        `${state.score} Punkte · ${state.roundsWon} Runden`,
        H / 2 + 20,
        15,
        '#e0f2fe',
      );
    }
  },

  snapshot(state): Snap {
    return {
      hits: state.hits,
      walls: state.walls,
      player: state.playerPoints,
      cpu: state.cpuPoints,
      rounds: state.roundsWon,
      over: state.phase === 'over',
    };
  },

  sounds(prev, next) {
    const a = prev as Snap;
    const b = next as Snap;
    if (b.over && !a.over) return ['lose'];
    const out: SfxName[] = [];
    if (b.rounds > a.rounds) out.push('win');
    else if (b.player > a.player) out.push('score');
    if (b.cpu > a.cpu) out.push('error');
    if (b.hits > a.hits) out.push('bounce');
    else if (b.walls > a.walls) out.push('tick');
    return out;
  },
};
