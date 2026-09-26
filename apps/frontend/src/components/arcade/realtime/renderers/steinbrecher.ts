import { REALTIME_GAMES } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Breakout.
 *
 * Der Zustandstyp liegt im Paket, wird aber nicht von dort exportiert (das
 * Register führt alle Spiele als `RealtimeGame<any>`). Hier steht deshalb eine
 * schmale Spiegelung der Felder, die gezeichnet werden – die Logik selbst bleibt
 * die einzige Quelle der Wahrheit.
 */

interface Brick {
  c: number;
  r: number;
  hp: number;
  max: number;
}

interface State {
  tick: number;
  over: boolean;
  score: number;
  lives: number;
  level: number;
  paddleX: number;
  stuck: boolean;
  balls: { x: number; y: number; dx: number; dy: number }[];
  bricks: Brick[];
  capsules: { x: number; y: number; kind: number }[];
  wideTicks: number;
  slowTicks: number;
  bannerTicks: number;
  bricksBroken: number;
  bounces: number;
  powerups: number;
  livesLost: number;
}

interface Snap {
  broken: number;
  bounces: number;
  powerups: number;
  lost: number;
  level: number;
  stuck: boolean;
  over: boolean;
}

const logic = REALTIME_GAMES['steinbrecher'];
if (!logic) throw new Error('steinbrecher fehlt');

const W = 360;
const H = 480;
const PADDLE_Y = 440;
const PADDLE_H = 10;
const BALL_R = 5;
const BRICK_W = 28;
const BRICK_H = 14;
const LEFT = 12;
const TOP = 60;
const STEEL = 9;
const LEVEL_NAMES = ['Regenbogen', 'Pyramide', 'Zinnen', 'Grinsegesicht', 'Tresor'];

/** Farbton je Reihe – ein Regenbogen von Rosa (Akzentfarbe) bis Türkis. */
const ROW_HUES = [350, 12, 32, 48, 90, 160, 190, 215, 260, 300];
const CAPSULES = [
  { label: 'B', color: '#38bdf8' },
  { label: 'M', color: '#a78bfa' },
  { label: 'L', color: '#34d399' },
  { label: '♥', color: '#fb7185' },
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}

/**
 * Reine Zier: Splitter zerbrochener Steine und die Spur des Balls. Liegt
 * außerhalb des Spielzustands, weil sie nichts entscheidet – ein neuer
 * Spielstart (Schritt kleiner als zuletzt) räumt sie ab.
 */
const fx = {
  lastTick: -1,
  lastTime: 0,
  hp: [] as number[],
  particles: [] as Particle[],
  trail: [] as { x: number; y: number }[],
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

function updateFx(state: State, time: number): void {
  if (state.tick < fx.lastTick || fx.hp.length !== state.bricks.length) {
    fx.hp = state.bricks.map((b) => b.hp);
    fx.particles = [];
    fx.trail = [];
  }
  // Splitter für jeden Stein, der seit dem letzten Bild verschwunden ist.
  state.bricks.forEach((brick, i) => {
    const before = fx.hp[i] ?? 0;
    if (before > 0 && brick.hp === 0) {
      const hue = ROW_HUES[brick.r % ROW_HUES.length] ?? 0;
      const cx = LEFT + brick.c * BRICK_W + BRICK_W / 2;
      const cy = TOP + brick.r * BRICK_H + BRICK_H / 2;
      for (let k = 0; k < 10; k += 1) {
        const a = (k / 10) * Math.PI * 2 + i;
        const s = 0.6 + ((k * 37 + i * 11) % 10) / 8;
        fx.particles.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s - 0.6,
          life: 1,
          hue,
        });
      }
    }
    fx.hp[i] = brick.hp;
  });
  const dt = Math.min(Math.max(time - fx.lastTime, 0), 50) / 16;
  fx.lastTime = time;
  for (const p of fx.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.08 * dt;
    p.life -= 0.03 * dt;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);
  if (state.tick !== fx.lastTick) {
    const ball = state.balls[0];
    if (ball && !state.stuck) fx.trail.push({ x: ball.x, y: ball.y });
    if (fx.trail.length > 8 || state.stuck) fx.trail.shift();
    if (state.stuck) fx.trail = [];
  }
  fx.lastTick = state.tick;
}

function drawBackground(ctx: CanvasRenderingContext2D, time: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1d0a1c');
  bg.addColorStop(0.6, '#120a24');
  bg.addColorStop(1, '#07060f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // Dezentes Rautenmuster, das langsam atmet.
  ctx.strokeStyle = `rgba(251,113,133,${0.04 + 0.02 * Math.sin(time / 1400)})`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -H; x < W; x += 24) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H, H);
    ctx.moveTo(x + H, 0);
    ctx.lineTo(x, H);
  }
  ctx.stroke();
}

function drawBrick(ctx: CanvasRenderingContext2D, brick: Brick, time: number): void {
  const x = LEFT + brick.c * BRICK_W + 1;
  const y = TOP + brick.r * BRICK_H + 1;
  const w = BRICK_W - 2;
  const h = BRICK_H - 2;
  if (brick.max === STEEL) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#e2e8f0');
    g.addColorStop(0.5, '#64748b');
    g.addColorStop(1, '#334155');
    ctx.fillStyle = g;
    roundRect(ctx, x, y, w, h, 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(15,23,42,0.7)';
    for (const [rx, ry] of [
      [x + 3, y + 3],
      [x + w - 3, y + 3],
      [x + 3, y + h - 3],
      [x + w - 3, y + h - 3],
    ] as const) {
      ctx.beginPath();
      ctx.arc(rx, ry, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const hue = ROW_HUES[brick.r % ROW_HUES.length] ?? 0;
  const light = brick.max === 3 ? 62 : brick.max === 2 ? 58 : 54;
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, `hsl(${hue} 95% ${light + 18}%)`);
  g.addColorStop(1, `hsl(${hue} 85% ${light - 12}%)`);
  ctx.shadowColor = `hsl(${hue} 95% 60% / 0.55)`;
  ctx.shadowBlur = 6;
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, 3);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Glanzlinie oben
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x + 3, y + 2, w - 6, 1.5);
  if (brick.max >= 2) {
    // Mehrfach-Steine tragen goldene Nieten, eine je verbleibendem Treffer.
    ctx.fillStyle = `rgba(255,236,170,${0.75 + 0.25 * Math.sin(time / 300 + brick.c)})`;
    for (let k = 0; k < brick.hp; k += 1) {
      ctx.beginPath();
      ctx.arc(x + w / 2 + (k - (brick.hp - 1) / 2) * 6, y + h / 2 + 1, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (brick.hp < brick.max) {
    // Risse zeigen, dass der Stein schon etwas abbekommen hat.
    ctx.strokeStyle = 'rgba(20,6,18,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 1);
    ctx.lineTo(x + 9, y + 6);
    ctx.lineTo(x + 7, y + h);
    ctx.moveTo(x + w - 6, y + 1);
    ctx.lineTo(x + w - 10, y + 7);
    ctx.stroke();
  }
}

function drawPaddle(ctx: CanvasRenderingContext2D, state: State, time: number): void {
  const w = state.wideTicks > 0 ? 96 : 60;
  const x = state.paddleX - w / 2;
  const blink = state.wideTicks > 0 && state.wideTicks < 120 && Math.floor(time / 120) % 2 === 0;
  const g = ctx.createLinearGradient(x, PADDLE_Y, x, PADDLE_Y + PADDLE_H);
  g.addColorStop(0, blink ? '#fecdd3' : '#fda4af');
  g.addColorStop(1, '#e11d48');
  ctx.shadowColor = '#fb7185';
  ctx.shadowBlur = 14;
  ctx.fillStyle = g;
  roundRect(ctx, x, PADDLE_Y, w, PADDLE_H, 5);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(x + 6, PADDLE_Y + 2, w - 12, 2);
  // Kleine Düsen an den Enden
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(x + 1, PADDLE_Y + 3, 3, 4);
  ctx.fillRect(x + w - 4, PADDLE_Y + 3, 3, 4);
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, slow: boolean): void {
  const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, BALL_R + 1);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, slow ? '#6ee7b7' : '#fecdd3');
  ctx.shadowColor = slow ? '#34d399' : '#fb7185';
  ctx.shadowBlur = 12;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHud(ctx: CanvasRenderingContext2D, state: State): void {
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, W, 34);
  ctx.font = 'bold 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fecdd3';
  ctx.fillText(String(state.score).padStart(6, '0'), 12, 17);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fda4af';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(`Level ${state.level + 1}`, W / 2, 17);
  // Leben als kleine Bälle
  for (let i = 0; i < Math.min(state.lives, 9); i += 1) {
    drawBall(ctx, W - 14 - i * 14, 17, false);
  }
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
  ctx.strokeStyle = 'rgba(10,4,16,0.85)';
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

export const renderer: RealtimeRenderer<State> = {
  id: 'steinbrecher',
  logic,
  view: { width: W, height: H },
  touch: 'horizontal',
  instructions:
    'Pfeil links/rechts (oder A/D) bewegt den Schläger, Leertaste schießt den Ball ab. Fang die Extras: B = breiter Schläger, M = Mehrfachball, L = langsamer Ball, ♥ = Extraleben.',

  keyInput(key, phase) {
    return defaultKeyInput(key, phase, true);
  },

  render(ctx, state, time) {
    updateFx(state, time);
    drawBackground(ctx, time);

    for (const brick of state.bricks) if (brick.hp > 0) drawBrick(ctx, brick, time);

    for (const p of fx.particles) {
      ctx.fillStyle = `hsl(${p.hue} 95% 65% / ${p.life})`;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }

    for (const capsule of state.capsules) {
      const info = CAPSULES[capsule.kind] ?? CAPSULES[0];
      if (!info) continue;
      ctx.shadowColor = info.color;
      ctx.shadowBlur = 10;
      ctx.fillStyle = info.color;
      roundRect(ctx, capsule.x - 12, capsule.y - 6, 24, 12, 6);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0b0614';
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.label, capsule.x, capsule.y + 0.5);
    }

    fx.trail.forEach((pos, i) => {
      ctx.fillStyle = `rgba(251,113,133,${(i + 1) / (fx.trail.length * 4)})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, BALL_R * ((i + 2) / (fx.trail.length + 2)), 0, Math.PI * 2);
      ctx.fill();
    });

    drawPaddle(ctx, state, time);
    for (const ball of state.balls) drawBall(ctx, ball.x, ball.y, state.slowTicks > 0);

    drawHud(ctx, state);

    if (state.over) {
      ctx.fillStyle = 'rgba(8,4,14,0.6)';
      ctx.fillRect(0, 0, W, H);
      centerText(ctx, 'Game Over', H / 2 - 16, 34, '#fb7185');
      centerText(ctx, `${state.score} Punkte`, H / 2 + 22, 18, '#fecdd3');
      return;
    }
    if (state.bannerTicks > 0) {
      const name = LEVEL_NAMES[state.level % LEVEL_NAMES.length] ?? '';
      const round = Math.floor(state.level / LEVEL_NAMES.length);
      centerText(ctx, `Level ${state.level + 1}`, 290, 28, '#fda4af');
      centerText(ctx, round > 0 ? `${name} · Runde ${round + 1}` : name, 322, 15, '#fecdd3');
    }
    if (state.stuck && Math.floor(time / 500) % 2 === 0) {
      centerText(ctx, 'Leertaste oder Aktion: Abschuss', 400, 13, '#fecdd3');
    }
  },

  snapshot(state): Snap {
    return {
      broken: state.bricksBroken,
      bounces: state.bounces,
      powerups: state.powerups,
      lost: state.livesLost,
      level: state.level,
      stuck: state.stuck,
      over: state.over,
    };
  },

  sounds(prev, next) {
    const a = prev as Snap;
    const b = next as Snap;
    const out: SfxName[] = [];
    if (b.over && !a.over) return ['lose'];
    if (b.level > a.level) out.push('win');
    else if (b.lost > a.lost) out.push('error');
    if (b.powerups > a.powerups) out.push('powerup');
    if (b.broken > a.broken) out.push('hit');
    else if (b.bounces > a.bounces) out.push('bounce');
    if (a.stuck && !b.stuck) out.push('shoot');
    return out;
  },
};
