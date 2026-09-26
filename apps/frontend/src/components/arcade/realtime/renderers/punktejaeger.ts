import { REALTIME_GAMES, type RealtimeGame } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Pac-Man: Neon-Labyrinth, eigene Geisterfiguren,
 * Leben/Level/Früchte in der Leiste unten.
 *
 * Der Zustandstyp ist im Paket nicht über dessen Einstieg erreichbar – hier
 * eine schmale Spiegelung. Das Labyrinth steckt im Zustand (`maze`), deshalb
 * muss die Zeichenschicht es nicht kennen.
 */
interface Actor {
  x: number;
  y: number;
  dir: number;
}

interface GhostView extends Actor {
  mode: 'house' | 'leaving' | 'active' | 'eyes' | 'entering';
  frightened: boolean;
}

interface PacView {
  maze: string[];
  dots: number[];
  level: number;
  lives: number;
  score: number;
  pac: Actor & { moving: boolean };
  ghosts: GhostView[];
  phase: 'ready' | 'play' | 'dying' | 'cleared' | 'over';
  phaseTimer: number;
  frightTimer: number;
  pauseTimer: number;
  fruit: { kind: number; ttl: number } | null;
  popup: { x: number; y: number; points: number; ttl: number } | null;
  ticks: number;
  dotsTotal: number;
  powerTotal: number;
  ghostsEaten: number;
  fruitsEaten: number;
  deaths: number;
}

const registered = REALTIME_GAMES['punktejaeger'] as RealtimeGame<PacView> | undefined;
if (!registered) throw new Error('punktejaeger fehlt');
const logic: RealtimeGame<PacView> = registered;

const W = 19;
const H = 21;
const UNIT = 120;
const PX = 22;
const HUD = 40;
const WIDTH = W * PX;
const HEIGHT = H * PX + HUD;
const DYING_TICKS = 100;
const FRUIT_TILE: [number, number] = [9, 11];

/** Eigene Geisterfarben und -namen: Glut, Flirr, Frost, Bammel. */
const GHOST_COLORS = ['#ff4d6d', '#d946ef', '#22d3ee', '#fb923c'];

const DIR_VEC: Record<number, [number, number]> = {
  1: [0, -1],
  2: [1, 0],
  3: [0, 1],
  4: [-1, 0],
};

function toPx(v: number): number {
  return (v / UNIT) * PX;
}

function isWall(maze: string[], x: number, y: number): boolean {
  if (y < 0 || y >= H) return true;
  const c = maze[y]?.[((x % W) + W) % W] ?? '#';
  return c === '#';
}

/*
 * Die Wandkontur ändert sich nie während einer Partie. Sie wird einmal als
 * Path2D gebaut und bei jedem Bild nur noch nachgezogen.
 */
let wallCache: { key: string; outline: Path2D; fill: Path2D; door: Path2D } | null = null;

function wallPaths(maze: string[]): { outline: Path2D; fill: Path2D; door: Path2D } {
  const key = maze.join('|');
  if (wallCache && wallCache.key === key) return wallCache;
  const outline = new Path2D();
  const fill = new Path2D();
  const door = new Path2D();
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const c = maze[y]?.[x];
      if (c === '-') {
        door.moveTo(x * PX + 2, y * PX + PX / 2);
        door.lineTo(x * PX + PX - 2, y * PX + PX / 2);
        continue;
      }
      if (c !== '#') continue;
      const px = x * PX;
      const py = y * PX;
      const openUp = !isWall(maze, x, y - 1) && y > 0;
      const openDown = !isWall(maze, x, y + 1) && y < H - 1;
      // Links/rechts nicht über den Rand hinaus – sonst bekäme der Tunnel eine Wandlinie.
      const openLeft = x > 0 && !isWall(maze, x - 1, y);
      const openRight = x < W - 1 && !isWall(maze, x + 1, y);
      fill.rect(px, py, PX, PX);
      if (openUp) {
        outline.moveTo(px, py);
        outline.lineTo(px + PX, py);
      }
      if (openDown) {
        outline.moveTo(px, py + PX);
        outline.lineTo(px + PX, py + PX);
      }
      if (openLeft) {
        outline.moveTo(px, py);
        outline.lineTo(px, py + PX);
      }
      if (openRight) {
        outline.moveTo(px + PX, py);
        outline.lineTo(px + PX, py + PX);
      }
    }
  }
  wallCache = { key, outline, fill, door };
  return wallCache;
}

function drawMaze(ctx: CanvasRenderingContext2D, state: PacView, time: number): void {
  const { outline, fill, door } = wallPaths(state.maze);
  const cleared = state.phase === 'cleared';
  const flashOn = cleared && Math.floor(time / 180) % 2 === 0;
  ctx.fillStyle = '#0c1033';
  ctx.fill(fill);
  ctx.save();
  ctx.strokeStyle = flashOn ? '#f8fafc' : '#6366f1';
  ctx.shadowColor = flashOn ? '#ffffff' : '#818cf8';
  ctx.shadowBlur = 10;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.stroke(outline);
  ctx.restore();
  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = 3;
  ctx.stroke(door);
}

function drawDots(ctx: CanvasRenderingContext2D, state: PacView, time: number): void {
  ctx.fillStyle = '#fde68a';
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const v = state.dots[y * W + x] ?? 0;
      if (v === 1) {
        ctx.fillRect(x * PX + PX / 2 - 1.5, y * PX + PX / 2 - 1.5, 3, 3);
      }
    }
  }
  const pulse = 5 + Math.sin(time / 160) * 1.5;
  ctx.save();
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#fef08a';
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if ((state.dots[y * W + x] ?? 0) !== 2) continue;
      ctx.beginPath();
      ctx.arc(x * PX + PX / 2, y * PX + PX / 2, pulse, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Eigene Fruchtformen je Level – Kirschen, Beere, Orange, Apfel, Trauben, Melone, Stern, Kristall. */
function drawFruit(
  ctx: CanvasRenderingContext2D,
  kind: number,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.save();
  ctx.shadowBlur = 10;
  const circle = (x: number, y: number, rad: number, color: string) => {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (kind) {
    case 0:
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.4, cy + r * 0.2);
      ctx.quadraticCurveTo(cx, cy - r, cx + r * 0.5, cy - r * 0.9);
      ctx.moveTo(cx + r * 0.4, cy + r * 0.3);
      ctx.quadraticCurveTo(cx + r * 0.4, cy - r * 0.4, cx + r * 0.5, cy - r * 0.9);
      ctx.stroke();
      circle(cx - r * 0.45, cy + r * 0.35, r * 0.45, '#f43f5e');
      circle(cx + r * 0.4, cy + r * 0.45, r * 0.45, '#e11d48');
      break;
    case 1:
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy - r * 0.4);
      ctx.quadraticCurveTo(cx, cy - r * 0.8, cx + r * 0.8, cy - r * 0.4);
      ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.6, cx, cy + r);
      ctx.quadraticCurveTo(cx - r * 0.5, cy + r * 0.6, cx - r * 0.8, cy - r * 0.4);
      ctx.fill();
      circle(cx, cy - r * 0.6, r * 0.25, '#22c55e');
      break;
    case 2:
      circle(cx, cy, r * 0.8, '#fb923c');
      circle(cx + r * 0.2, cy - r * 0.8, r * 0.2, '#16a34a');
      break;
    case 3:
      circle(cx - r * 0.3, cy, r * 0.65, '#dc2626');
      circle(cx + r * 0.3, cy, r * 0.65, '#dc2626');
      circle(cx + r * 0.2, cy - r * 0.8, r * 0.22, '#65a30d');
      break;
    case 4:
      for (const [dx, dy] of [
        [-0.4, -0.4],
        [0.4, -0.4],
        [0, 0],
        [-0.4, 0.35],
        [0.4, 0.35],
        [0, 0.75],
      ] as const) {
        circle(cx + dx * r, cy + dy * r, r * 0.32, '#a855f7');
      }
      break;
    case 5:
      circle(cx, cy, r * 0.85, '#16a34a');
      circle(cx, cy, r * 0.6, '#f87171');
      break;
    case 6:
      ctx.fillStyle = '#fde047';
      ctx.shadowColor = '#fde047';
      ctx.beginPath();
      for (let i = 0; i < 10; i += 1) {
        const rad = i % 2 === 0 ? r : r * 0.45;
        const a = -Math.PI / 2 + (Math.PI * i) / 5;
        ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.fillStyle = '#67e8f9';
      ctx.shadowColor = '#67e8f9';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.75, cy - r * 0.2);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.75, cy - r * 0.2);
      ctx.closePath();
      ctx.fill();
  }
  ctx.restore();
}

function drawPac(ctx: CanvasRenderingContext2D, state: PacView, time: number): void {
  const pac = state.pac;
  const cx = toPx(pac.x);
  const cy = toPx(pac.y);
  const r = PX * 0.46;
  const [dx, dy] = DIR_VEC[pac.dir] ?? [-1, 0];
  const facing = Math.atan2(dy, dx);
  let mouth: number;
  if (state.phase === 'dying') {
    // Der Mund öffnet sich, bis nichts mehr übrig ist.
    const k = 1 - state.phaseTimer / DYING_TICKS;
    mouth = Math.min(Math.PI, 0.25 + k * Math.PI);
  } else if (pac.moving || state.phase === 'ready') {
    mouth = 0.08 + Math.abs(Math.sin(time / 70)) * 0.62;
  } else {
    mouth = 0.4;
  }
  if (mouth >= Math.PI) return;
  ctx.save();
  ctx.shadowColor = '#facc15';
  ctx.shadowBlur = 16;
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 1, cx, cy, r);
  g.addColorStop(0, '#fef9c3');
  g.addColorStop(0.6, '#facc15');
  g.addColorStop(1, '#ca8a04');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, facing + mouth / 2, facing + Math.PI * 2 - mouth / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function ghostBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  time: number,
): void {
  const bottom = cy + r;
  ctx.beginPath();
  ctx.moveTo(cx - r, bottom);
  ctx.lineTo(cx - r, cy);
  ctx.arc(cx, cy, r, Math.PI, 0);
  ctx.lineTo(cx + r, bottom);
  // Welliger Saum, der mit der Zeit wandert.
  const waves = 4;
  const phase = Math.floor(time / 140) % 2;
  for (let i = waves; i >= 0; i -= 1) {
    const x = cx - r + (2 * r * i) / waves;
    const y = bottom - ((i + phase) % 2 === 0 ? 0 : r * 0.28);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawGhosts(ctx: CanvasRenderingContext2D, state: PacView, time: number): void {
  if (state.phase === 'dying' && state.phaseTimer < DYING_TICKS - 20) return;
  const flashing =
    state.frightTimer > 0 && state.frightTimer < 120 && Math.floor(time / 160) % 2 === 0;
  state.ghosts.forEach((g, i) => {
    const cx = toPx(g.x);
    const bob = g.mode === 'house' ? Math.sin(time / 180 + i) * 2 : 0;
    const cy = toPx(g.y) + bob;
    const r = PX * 0.46;
    const [dx, dy] = DIR_VEC[g.dir] ?? [0, 0];
    const eyesOnly = g.mode === 'eyes' || g.mode === 'entering';
    if (!eyesOnly) {
      const color = g.frightened ? (flashing ? '#f8fafc' : '#3b4bdb') : (GHOST_COLORS[i] ?? '#fff');
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.25, color);
      grad.addColorStop(1, color);
      ctx.fillStyle = grad;
      ghostBody(ctx, cx, cy - 1, r, time);
      ctx.fill();
      ctx.restore();
    }
    if (g.frightened && !eyesOnly) {
      // Verängstigt: kleine Knopfaugen und ein zittriger Mund.
      ctx.fillStyle = flashing ? '#ef4444' : '#fde68a';
      ctx.fillRect(cx - 4, cy - 4, 2.5, 2.5);
      ctx.fillRect(cx + 1.5, cy - 4, 2.5, 2.5);
      ctx.strokeStyle = flashing ? '#ef4444' : '#fde68a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let k = 0; k <= 6; k += 1) {
        ctx.lineTo(cx - 5 + (10 * k) / 6, cy + 3 + (k % 2 === 0 ? 0 : -2));
      }
      ctx.stroke();
      return;
    }
    for (const side of [-1, 1]) {
      const ex = cx + side * r * 0.38;
      const ey = cy - r * 0.2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(ex, ey, r * 0.28, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1e1b4b';
      ctx.beginPath();
      ctx.arc(ex + dx * r * 0.13, ey + dy * r * 0.15, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawHud(ctx: CanvasRenderingContext2D, state: PacView): void {
  const top = H * PX;
  const grad = ctx.createLinearGradient(0, top, 0, HEIGHT);
  grad.addColorStop(0, 'rgba(250, 204, 21, 0.12)');
  grad.addColorStop(1, 'rgba(250, 204, 21, 0.02)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, top, WIDTH, HUD);
  // Reserveleben als kleine Pac-Symbole.
  for (let i = 0; i < Math.min(5, state.lives - 1); i += 1) {
    const cx = 18 + i * 22;
    const cy = top + HUD / 2;
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 8, Math.PI + 0.5, Math.PI * 3 - 0.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#fef9c3';
  ctx.font = '700 14px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Level ${state.level}`, WIDTH / 2, top + HUD / 2);
  // Früchte der letzten Level rechts, neueste außen.
  const kinds: number[] = [];
  for (let l = Math.max(1, state.level - 4); l <= state.level; l += 1)
    kinds.push(Math.min(l, 8) - 1);
  kinds.forEach((kind, i) =>
    drawFruit(ctx, kind, WIDTH - 18 - (kinds.length - 1 - i) * 22, top + HUD / 2, 8),
  );
}

function drawText(ctx: CanvasRenderingContext2D, state: PacView, time: number): void {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (state.phase === 'ready') {
    ctx.save();
    ctx.fillStyle = '#fde047';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 12;
    ctx.font = '800 18px ui-sans-serif, system-ui, sans-serif';
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(time / 150);
    ctx.fillText('Bereit!', FRUIT_TILE[0] * PX + PX / 2, FRUIT_TILE[1] * PX + PX / 2);
    ctx.restore();
  }
  if (state.phase === 'over') {
    ctx.fillStyle = 'rgba(3, 5, 20, 0.6)';
    ctx.fillRect(0, 0, WIDTH, H * PX);
    ctx.fillStyle = '#f87171';
    ctx.font = '800 24px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('Spiel vorbei', WIDTH / 2, (H * PX) / 2);
  }
  const popup = state.popup;
  if (popup) {
    ctx.fillStyle = '#67e8f9';
    ctx.font = '800 13px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(popup.points), toPx(popup.x), toPx(popup.y) - 4);
  }
}

interface Snapshot {
  dots: number;
  power: number;
  ghosts: number;
  fruits: number;
  deaths: number;
  level: number;
  lives: number;
  over: boolean;
}

export const renderer: RealtimeRenderer<PacView> = {
  id: 'punktejaeger',
  logic,
  view: { width: WIDTH, height: HEIGHT },
  touch: 'dpad',
  instructions:
    'Pfeiltasten oder WASD steuern – die nächste Abbiegung darfst du schon vorher drücken. Friss alle Punkte, schnapp dir eine Kraftpille und jage dann die Geister. Drei Leben, jedes Level wird schneller.',
  keyInput: (key, phase) => defaultKeyInput(key, phase),
  render(ctx, state, time) {
    ctx.fillStyle = '#03040f';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawMaze(ctx, state, time);
    drawDots(ctx, state, time);
    if (state.fruit) {
      const blink = state.fruit.ttl < 120 && Math.floor(time / 150) % 2 === 0;
      if (!blink) {
        drawFruit(
          ctx,
          state.fruit.kind,
          FRUIT_TILE[0] * PX + PX / 2,
          FRUIT_TILE[1] * PX + PX / 2,
          8,
        );
      }
    }
    drawGhosts(ctx, state, time);
    // Während der Pause nach einem gefressenen Geist stehen nur die Punkte da.
    if (!(state.phase === 'play' && state.pauseTimer > 0)) drawPac(ctx, state, time);
    drawText(ctx, state, time);
    drawHud(ctx, state);
  },
  snapshot: (state): Snapshot => ({
    dots: state.dotsTotal,
    power: state.powerTotal,
    ghosts: state.ghostsEaten,
    fruits: state.fruitsEaten,
    deaths: state.deaths,
    level: state.level,
    lives: state.lives,
    over: state.phase === 'over',
  }),
  sounds(prev, next) {
    const a = prev as Snapshot | null;
    const b = next as Snapshot;
    if (!a) return [];
    const out: SfxName[] = [];
    if (b.deaths > a.deaths) out.push('lose');
    if (b.ghosts > a.ghosts) out.push('capture');
    if (b.power > a.power) out.push('powerup');
    else if (b.dots > a.dots) out.push('eat');
    if (b.fruits > a.fruits) out.push('coin');
    if (b.level > a.level) out.push('win');
    if (b.lives > a.lives) out.push('score');
    return out;
  },
};
