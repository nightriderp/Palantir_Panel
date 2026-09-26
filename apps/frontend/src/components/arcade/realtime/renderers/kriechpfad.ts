import { REALTIME_GAMES, type RealtimeGame } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Snake: Neon-Schlange auf dunklem Raster.
 *
 * Der Zustandstyp liegt im Paket, wird aber nicht über dessen Einstieg
 * exportiert – deshalb hier eine schmale Spiegelung der Felder, die das
 * Zeichnen liest.
 */
interface SnakeView {
  body: [number, number][];
  dir: number;
  food: [number, number];
  bonus: { x: number; y: number; ttl: number } | null;
  score: number;
  eaten: number;
  bonusEaten: number;
  lastBonusPoints: number;
  ticks: number;
  over: boolean;
  won: boolean;
}

const registered = REALTIME_GAMES['kriechpfad'] as RealtimeGame<SnakeView> | undefined;
if (!registered) throw new Error('kriechpfad fehlt');
const logic: RealtimeGame<SnakeView> = registered;

const COLS = 24;
const ROWS = 20;
const CELL = 20;
const HUD = 40;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL + HUD;
const BONUS_TTL = 60;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface Snapshot {
  eaten: number;
  bonusEaten: number;
  over: boolean;
}

/*
 * Partikel sind reine Zier und gehören nicht in den Spielzustand. Die
 * Zeichenschicht merkt sich, was sie zuletzt gesehen hat, und streut Funken,
 * sobald ein Zähler steigt.
 */
const fx = {
  lastTicks: -1,
  lastEaten: 0,
  lastBonus: 0,
  lastTime: 0,
  particles: [] as Particle[],
  bonusFlash: null as { x: number; y: number; points: number; until: number } | null,
};

function burst(x: number, y: number, color: string, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + (i % 3) * 0.3;
    const speed = 0.05 + (i % 5) * 0.025;
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      color,
    });
  }
}

function cellCenter(x: number, y: number): [number, number] {
  return [x * CELL + CELL / 2, HUD + y * CELL + CELL / 2];
}

function drawBackground(ctx: CanvasRenderingContext2D, time: number): void {
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#07130d');
  bg.addColorStop(1, '#030806');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Rasterpunkte, leicht pulsierend – gibt Orientierung, ohne zu stören.
  const pulse = 0.12 + 0.05 * Math.sin(time / 900);
  ctx.fillStyle = `rgba(74, 222, 128, ${pulse.toFixed(3)})`;
  for (let y = 0; y <= ROWS; y += 1) {
    for (let x = 0; x <= COLS; x += 1) {
      ctx.fillRect(x * CELL - 1, HUD + y * CELL - 1, 2, 2);
    }
  }
  // Leuchtender Rand zeigt die tödliche Wand.
  ctx.save();
  ctx.shadowColor = '#4ade80';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(74, 222, 128, 0.75)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, HUD + 1, WIDTH - 2, ROWS * CELL - 2);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D, state: SnakeView, time: number): void {
  const grad = ctx.createLinearGradient(0, 0, WIDTH, 0);
  grad.addColorStop(0, 'rgba(74, 222, 128, 0.16)');
  grad.addColorStop(1, 'rgba(34, 211, 238, 0.10)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HUD);

  ctx.font = '600 14px ui-sans-serif, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#d1fae5';
  ctx.textAlign = 'left';
  ctx.fillText(`Länge ${state.body.length}`, 14, HUD / 2);

  // Tempo als Balken: je mehr Striche, desto kürzer der Schritt.
  const ms = logic.tickMs(state);
  const stage = Math.round(((135 - ms) / 80) * 10);
  ctx.fillText('Tempo', 120, HUD / 2);
  for (let i = 0; i < 10; i += 1) {
    ctx.fillStyle = i < stage ? `hsl(${140 - i * 12}, 90%, 60%)` : 'rgba(255,255,255,0.12)';
    ctx.fillRect(172 + i * 9, HUD / 2 - 7, 6, 14);
  }

  if (state.bonus) {
    const share = state.bonus.ttl / BONUS_TTL;
    ctx.fillStyle = '#fde68a';
    ctx.textAlign = 'right';
    ctx.fillText('Bonus', WIDTH - 118, HUD / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(WIDTH - 110, HUD / 2 - 5, 96, 10);
    const blink = share < 0.3 && Math.floor(time / 120) % 2 === 0;
    ctx.fillStyle = blink ? '#f87171' : '#facc15';
    ctx.fillRect(WIDTH - 110, HUD / 2 - 5, 96 * share, 10);
  } else {
    ctx.fillStyle = 'rgba(209, 250, 229, 0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`Häppchen ${state.eaten}`, WIDTH - 14, HUD / 2);
  }
}

function drawFood(ctx: CanvasRenderingContext2D, state: SnakeView, time: number): void {
  if (state.food[0] >= 0) {
    const [cx, cy] = cellCenter(state.food[0], state.food[1]);
    const r = 6 + Math.sin(time / 180) * 1.2;
    ctx.save();
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = 16;
    const g = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, r);
    g.addColorStop(0, '#ffe4e6');
    g.addColorStop(0.5, '#fb7185');
    g.addColorStop(1, '#be123c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Kleines Blatt – aus dem Punkt wird ein Häppchen.
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy - r - 1, 3.5, 1.6, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const bonus = state.bonus;
  if (bonus) {
    const [cx, cy] = cellCenter(bonus.x, bonus.y);
    const share = bonus.ttl / BONUS_TTL;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time / 600);
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const r = i % 2 === 0 ? 9 : 4;
      const a = (Math.PI * i) / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Ablaufring schrumpft mit der Restzeit.
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
    ctx.stroke();
  }
}

function drawSnake(ctx: CanvasRenderingContext2D, state: SnakeView, time: number): void {
  const n = state.body.length;
  const dead = state.over && !state.won;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Körper als Glieder von hinten nach vorn, Farbton wandert von Grün zu Türkis.
  for (let i = n - 1; i >= 0; i -= 1) {
    const cell = state.body[i];
    if (!cell) continue;
    const [cx, cy] = cellCenter(cell[0], cell[1]);
    const t = n > 1 ? i / (n - 1) : 0;
    const hue = dead ? 0 : 140 + t * 50 + Math.sin(time / 400 + i * 0.4) * 6;
    const light = dead ? 45 : 58 - t * 12;
    const next = state.body[i - 1];
    ctx.shadowColor = `hsl(${hue}, 90%, 55%)`;
    ctx.shadowBlur = i === 0 ? 16 : 8;
    ctx.strokeStyle = `hsl(${hue}, 85%, ${light}%)`;
    ctx.lineWidth = CELL * (0.78 - t * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    if (next) {
      const [nx, ny] = cellCenter(next[0], next[1]);
      ctx.lineTo(nx, ny);
    } else {
      ctx.lineTo(cx + 0.01, cy);
    }
    ctx.stroke();
    // Schuppenpunkt je Glied – macht Länge und Bewegung lesbar.
    if (i > 0 && i % 2 === 0) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = `hsla(${hue}, 90%, 85%, 0.45)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  const head = state.body[0];
  if (!head) return;
  const [hx, hy] = cellCenter(head[0], head[1]);
  const dirs: Record<number, [number, number]> = { 1: [0, -1], 2: [1, 0], 3: [0, 1], 4: [-1, 0] };
  const [dx, dy] = dirs[state.dir] ?? [1, 0];
  const px = -dy;
  const py = dx;
  // Kopf etwas breiter als der Körper und leicht nach vorn gezogen.
  ctx.save();
  ctx.shadowColor = dead ? '#ef4444' : '#86efac';
  ctx.shadowBlur = 18;
  const hg = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, CELL * 0.62);
  hg.addColorStop(0, dead ? '#fecaca' : '#ecfccb');
  hg.addColorStop(0.5, dead ? '#ef4444' : '#4ade80');
  hg.addColorStop(1, dead ? '#7f1d1d' : '#15803d');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(hx + dx * 2, hy + dy * 2, CELL * 0.6, CELL * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Augen quer zur Laufrichtung, Pupillen nach vorn.
  for (const side of [-1, 1]) {
    const ex = hx + dx * 3 + px * side * 4.5;
    const ey = hy + dy * 3 + py * side * 4.5;
    ctx.fillStyle = '#f0fdf4';
    ctx.beginPath();
    ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
    ctx.fill();
    if (dead) {
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(ex - 2, ey - 2);
      ctx.lineTo(ex + 2, ey + 2);
      ctx.moveTo(ex + 2, ey - 2);
      ctx.lineTo(ex - 2, ey + 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#052e16';
      ctx.beginPath();
      ctx.arc(ex + dx * 1.2, ey + dy * 1.2, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Grinsen – oder ein gelegentliches Züngeln.
  if (!dead && Math.floor(time / 700) % 4 === 0) {
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx + dx * 8, hy + dy * 8);
    ctx.lineTo(hx + dx * 13, hy + dy * 13);
    ctx.lineTo(hx + dx * 15 + px * 2, hy + dy * 15 + py * 2);
    ctx.moveTo(hx + dx * 13, hy + dy * 13);
    ctx.lineTo(hx + dx * 15 - px * 2, hy + dy * 15 - py * 2);
    ctx.stroke();
  }
}

function updateFx(state: SnakeView, time: number): void {
  if (state.ticks < fx.lastTicks) {
    fx.particles = [];
    fx.lastEaten = state.eaten;
    fx.lastBonus = state.bonusEaten;
    fx.bonusFlash = null;
  }
  fx.lastTicks = state.ticks;
  const head = state.body[0];
  if (head && state.eaten > fx.lastEaten) {
    const [cx, cy] = cellCenter(head[0], head[1]);
    burst(cx, cy, '#fb7185', 14);
  }
  if (head && state.bonusEaten > fx.lastBonus) {
    const [cx, cy] = cellCenter(head[0], head[1]);
    burst(cx, cy, '#fde047', 24);
    fx.bonusFlash = { x: cx, y: cy, points: state.lastBonusPoints, until: time + 900 };
  }
  fx.lastEaten = state.eaten;
  fx.lastBonus = state.bonusEaten;

  const dt = Math.min(64, Math.max(0, time - fx.lastTime));
  fx.lastTime = time;
  for (const p of fx.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt / 600;
  }
  fx.particles = fx.particles.filter((p) => p.life > 0);
}

function drawFx(ctx: CanvasRenderingContext2D, time: number): void {
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  const flash = fx.bonusFlash;
  if (flash && time < flash.until) {
    const k = 1 - (flash.until - time) / 900;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = '#fde047';
    ctx.font = '700 16px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`+${flash.points}`, flash.x, flash.y - 14 - k * 20);
    ctx.globalAlpha = 1;
  }
}

export const renderer: RealtimeRenderer<SnakeView> = {
  id: 'kriechpfad',
  logic,
  view: { width: WIDTH, height: HEIGHT },
  touch: 'dpad',
  instructions:
    'Pfeiltasten oder WASD lenken die Schlange. Jedes Häppchen macht sie länger und schneller, goldene Sterne bringen Extrapunkte – aber nur, solange ihr Ring läuft. Wand und eigener Körper beenden die Partie.',
  keyInput: (key, phase) => defaultKeyInput(key, phase),
  render(ctx, state, time) {
    updateFx(state, time);
    drawBackground(ctx, time);
    drawHud(ctx, state, time);
    drawFood(ctx, state, time);
    drawSnake(ctx, state, time);
    drawFx(ctx, time);
    if (state.over) {
      ctx.fillStyle = state.won ? 'rgba(74, 222, 128, 0.18)' : 'rgba(127, 29, 29, 0.28)';
      ctx.fillRect(0, HUD, WIDTH, ROWS * CELL);
      if (state.won) {
        ctx.fillStyle = '#bbf7d0';
        ctx.font = '700 28px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Feld voll – gewonnen!', WIDTH / 2, HUD + (ROWS * CELL) / 2);
      }
    }
  },
  snapshot: (state): Snapshot => ({
    eaten: state.eaten,
    bonusEaten: state.bonusEaten,
    over: state.over,
  }),
  sounds(prev, next) {
    const a = prev as Snapshot | null;
    const b = next as Snapshot;
    if (!a) return [];
    const out: SfxName[] = [];
    if (b.eaten > a.eaten) out.push('eat');
    if (b.bonusEaten > a.bonusEaten) out.push('powerup');
    if (b.over && !a.over) out.push('lose');
    return out;
  },
};
