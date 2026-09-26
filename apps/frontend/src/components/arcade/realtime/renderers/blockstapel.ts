import {
  ARCADE_INPUT_ACTION2,
  ARCADE_INPUT_CUSTOM,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  REALTIME_GAMES,
  type RealtimeGame,
} from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Tetris: Neon-Steine, Schatten der Landeposition,
 * Halten links, Vorschau rechts.
 *
 * Zustandstyp und Steinformen sind im Paket nicht über dessen Einstieg
 * erreichbar – deshalb hier eine schmale Spiegelung. Die Formen müssen zu
 * `SHAPES` in `packages/arcade/src/games/blockstapel.ts` passen.
 */
interface Piece {
  type: number;
  rot: number;
  x: number;
  y: number;
}

interface BlockView {
  board: number[];
  piece: Piece | null;
  queue: number[];
  hold: number;
  holdUsed: boolean;
  score: number;
  lines: number;
  level: number;
  clearRows: number[];
  clearTimer: number;
  over: boolean;
  ticks: number;
  locks: number;
  clears: number;
  lastClear: number;
  hardDrops: number;
  rotations: number;
}

const registered = REALTIME_GAMES['blockstapel'] as RealtimeGame<BlockView> | undefined;
if (!registered) throw new Error('blockstapel fehlt');
const logic: RealtimeGame<BlockView> = registered;

const COLS = 10;
const ROWS = 22;
const HIDDEN = 2;
const CELL = 24;
const BOARD_X = 100;
const BOARD_Y = 12;
const BOARD_W = COLS * CELL;
const BOARD_H = (ROWS - HIDDEN) * CELL;
const WIDTH = 440;
const HEIGHT = BOARD_H + BOARD_Y * 2;
const CLEAR_FRAMES = 18;

/** Eigene Rotation: CCW liegt auf der ersten freien Spiel-Eingabe. */
const ROTATE_CCW = ARCADE_INPUT_CUSTOM;

const SHAPES: readonly { n: number; cells: readonly [number, number][] }[] = [
  { n: 0, cells: [] },
  {
    n: 4,
    cells: [
      [0, 1],
      [1, 1],
      [2, 1],
      [3, 1],
    ],
  },
  {
    n: 2,
    cells: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [1, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
  {
    n: 3,
    cells: [
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  },
];

/** Neonfarben je Steinart (I, O, T, S, Z, J, L) – eigene Palette. */
const COLORS = ['', '#22d3ee', '#facc15', '#c084fc', '#4ade80', '#fb7185', '#60a5fa', '#fb923c'];

function cellsOf(type: number, rot: number): [number, number][] {
  const shape = SHAPES[type];
  if (!shape) return [];
  let cells = shape.cells.map(([x, y]) => [x, y] as [number, number]);
  for (let t = 0; t < ((rot % 4) + 4) % 4; t += 1) {
    cells = cells.map(([x, y]) => [shape.n - 1 - y, x] as [number, number]);
  }
  return cells;
}

function blocked(state: BlockView, piece: Piece): boolean {
  for (const [cx, cy] of cellsOf(piece.type, piece.rot)) {
    const x = piece.x + cx;
    const y = piece.y + cy;
    if (x < 0 || x >= COLS || y >= ROWS) return true;
    if (y >= 0 && (state.board[y * COLS + x] ?? 0) !== 0) return true;
  }
  return false;
}

function ghostY(state: BlockView, piece: Piece): number {
  let y = piece.y;
  while (!blocked(state, { ...piece, y: y + 1 })) y += 1;
  return y;
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  glow = true,
): void {
  ctx.save();
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 0.5;
  }
  const g = ctx.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.18, color);
  g.addColorStop(1, shade(color));
  ctx.fillStyle = g;
  roundRect(ctx, x + 1, y + 1, size - 2, size - 2, size * 0.18);
  ctx.fill();
  ctx.restore();
  // Glanzkante oben links.
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x + 3, y + 3, size - 8, Math.max(1.5, size * 0.1));
}

function shade(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const r = Math.floor(((v >> 16) & 255) * 0.45);
  const g = Math.floor(((v >> 8) & 255) * 0.45);
  const b = Math.floor((v & 255) * 0.45);
  return `rgb(${r}, ${g}, ${b})`;
}

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

/** Kleiner Stein, mittig in einem Kasten – für Halten und Vorschau. */
function drawMini(
  ctx: CanvasRenderingContext2D,
  type: number,
  cx: number,
  cy: number,
  size: number,
  dim: boolean,
): void {
  const cells = cellsOf(type, 0);
  if (cells.length === 0) return;
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  const ox = cx - (w * size) / 2 - Math.min(...xs) * size;
  const oy = cy - (h * size) / 2 - Math.min(...ys) * size;
  ctx.globalAlpha = dim ? 0.35 : 1;
  for (const [x, y] of cells) {
    drawBlock(ctx, ox + x * size, oy + y * size, size, COLORS[type] ?? '#fff', !dim);
  }
  ctx.globalAlpha = 1;
}

function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
): void {
  ctx.fillStyle = 'rgba(167, 139, 250, 0.08)';
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#c4b5fd';
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(title, x + w / 2, y + 7);
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

/** Reine Zier außerhalb des Spielzustands: Funken beim Abräumen, Banner bei Mehrfachreihen. */
const fx = {
  lastTicks: -1,
  lastClears: 0,
  lastTime: 0,
  sparks: [] as Spark[],
  banner: null as { text: string; until: number } | null,
};

const CLEAR_NAMES = ['', 'Einfach', 'Doppel', 'Dreifach', 'Viererpack!'];

function updateFx(state: BlockView, time: number): void {
  if (state.ticks < fx.lastTicks) {
    fx.sparks = [];
    fx.lastClears = state.clears;
    fx.banner = null;
  }
  fx.lastTicks = state.ticks;
  if (state.clears > fx.lastClears) {
    for (const row of state.clearRows) {
      const y = BOARD_Y + (row - HIDDEN) * CELL + CELL / 2;
      for (let i = 0; i < 18; i += 1) {
        const x = BOARD_X + (i / 17) * BOARD_W;
        fx.sparks.push({
          x,
          y,
          vx: ((i % 5) - 2) * 0.04,
          vy: -0.08 - (i % 4) * 0.04,
          life: 1,
          color: COLORS[(i % 7) + 1] ?? '#fff',
        });
      }
    }
    if (state.lastClear >= 2) {
      fx.banner = { text: CLEAR_NAMES[state.lastClear] ?? '', until: time + 1100 };
    }
  }
  fx.lastClears = state.clears;
  const dt = Math.min(64, Math.max(0, time - fx.lastTime));
  fx.lastTime = time;
  for (const s of fx.sparks) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 0.0004 * dt;
    s.life -= dt / 800;
  }
  fx.sparks = fx.sparks.filter((s) => s.life > 0);
}

function drawBoard(ctx: CanvasRenderingContext2D, state: BlockView, time: number): void {
  // Brunnen mit feinem Raster.
  const well = ctx.createLinearGradient(0, BOARD_Y, 0, BOARD_Y + BOARD_H);
  well.addColorStop(0, '#120b24');
  well.addColorStop(1, '#0a0716');
  ctx.fillStyle = well;
  ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.07)';
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x += 1) {
    ctx.beginPath();
    ctx.moveTo(BOARD_X + x * CELL + 0.5, BOARD_Y);
    ctx.lineTo(BOARD_X + x * CELL + 0.5, BOARD_Y + BOARD_H);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS - HIDDEN; y += 1) {
    ctx.beginPath();
    ctx.moveTo(BOARD_X, BOARD_Y + y * CELL + 0.5);
    ctx.lineTo(BOARD_X + BOARD_W, BOARD_Y + y * CELL + 0.5);
    ctx.stroke();
  }

  const clearing = new Set(state.clearRows);
  const flash = state.clearTimer > 0 ? state.clearTimer / CLEAR_FRAMES : 0;
  for (let y = HIDDEN; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      const v = state.board[y * COLS + x] ?? 0;
      if (v === 0) continue;
      const px = BOARD_X + x * CELL;
      const py = BOARD_Y + (y - HIDDEN) * CELL;
      if (clearing.has(y)) {
        // Volle Reihe leuchtet weiß auf und verblasst.
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.65 * flash).toFixed(3)})`;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      } else {
        drawBlock(ctx, px, py, CELL, COLORS[v] ?? '#fff', false);
      }
    }
  }

  const piece = state.piece;
  if (piece && !state.over) {
    const color = COLORS[piece.type] ?? '#fff';
    const gy = ghostY(state, piece);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.45 + 0.15 * Math.sin(time / 250);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    for (const [cx, cy] of cellsOf(piece.type, piece.rot)) {
      const y = gy + cy - HIDDEN;
      if (y < 0) continue;
      ctx.strokeRect(
        BOARD_X + (piece.x + cx) * CELL + 3,
        BOARD_Y + y * CELL + 3,
        CELL - 6,
        CELL - 6,
      );
    }
    ctx.restore();
    for (const [cx, cy] of cellsOf(piece.type, piece.rot)) {
      const y = piece.y + cy - HIDDEN;
      if (y < 0) continue;
      drawBlock(ctx, BOARD_X + (piece.x + cx) * CELL, BOARD_Y + y * CELL, CELL, color);
    }
  }

  ctx.save();
  ctx.shadowColor = '#a78bfa';
  ctx.shadowBlur = 14;
  ctx.strokeStyle = '#a78bfa';
  ctx.lineWidth = 2;
  ctx.strokeRect(BOARD_X - 1, BOARD_Y - 1, BOARD_W + 2, BOARD_H + 2);
  ctx.restore();
}

function drawSide(ctx: CanvasRenderingContext2D, state: BlockView): void {
  panel(ctx, 8, BOARD_Y, 84, 84, 'HALTEN');
  if (state.hold) drawMini(ctx, state.hold, 50, BOARD_Y + 50, 15, state.holdUsed);

  panel(ctx, 8, BOARD_Y + 96, 84, 150, 'STAND');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const stats: [string, string][] = [
    ['Level', String(state.level)],
    ['Reihen', String(state.lines)],
    ['bis Level', String(10 - (state.lines % 10))],
  ];
  stats.forEach(([label, value], i) => {
    const y = BOARD_Y + 132 + i * 40;
    ctx.fillStyle = 'rgba(196, 181, 253, 0.7)';
    ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(label, 50, y);
    ctx.fillStyle = '#f5f3ff';
    ctx.font = '700 18px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(value, 50, y + 19);
  });

  const nx = BOARD_X + BOARD_W + 12;
  panel(ctx, nx, BOARD_Y, 80, 222, 'NÄCHSTE');
  state.queue.slice(0, 3).forEach((type, i) => {
    drawMini(ctx, type, nx + 40, BOARD_Y + 56 + i * 62, i === 0 ? 16 : 13, false);
  });
}

function drawOverlay(ctx: CanvasRenderingContext2D, state: BlockView, time: number): void {
  for (const s of fx.sparks) {
    ctx.globalAlpha = Math.max(0, s.life);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  const banner = fx.banner;
  if (banner && time < banner.until) {
    const k = 1 - (banner.until - time) / 1100;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 2 - 2 * k);
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 18;
    ctx.font = `800 ${Math.round(26 + 6 * Math.sin(k * Math.PI))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H * 0.35 - k * 30);
    ctx.restore();
  }
  if (state.over) {
    ctx.fillStyle = 'rgba(10, 7, 22, 0.72)';
    ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);
    ctx.fillStyle = '#ddd6fe';
    ctx.font = '800 26px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Stapel voll', BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H / 2);
  }
}

interface Snapshot {
  locks: number;
  clears: number;
  lastClear: number;
  hardDrops: number;
  rotations: number;
  hold: number;
  level: number;
  x: number;
  over: boolean;
}

export const renderer: RealtimeRenderer<BlockView> = {
  id: 'blockstapel',
  logic,
  view: { width: WIDTH, height: HEIGHT },
  touch: 'stack',
  instructions:
    '←/→ schieben (gedrückt halten wiederholt), ↑ oder X dreht, Z/Y dreht andersherum, ↓ weicher Fall, Leertaste harter Fall, C oder Shift hält den Stein zurück. Alle zehn Reihen steigt das Level – und das Tempo.',
  keyInput(key, phase) {
    if (key === 'z' || key === 'Z' || key === 'y' || key === 'Y') {
      return phase === 'press' ? ROTATE_CCW : null;
    }
    if (key === 'x' || key === 'X') return phase === 'press' ? ARCADE_INPUT_UP : null;
    if (key === 'c' || key === 'C' || key === 'Shift') {
      return phase === 'press' ? ARCADE_INPUT_ACTION2 : null;
    }
    const input = defaultKeyInput(key, phase, true);
    if (input === null) return null;
    if (phase === 'release') {
      // Loslassen zählt nur bei den Tasten, die gehalten wirken.
      const base = input - ARCADE_INPUT_RELEASE;
      return base === ARCADE_INPUT_LEFT || base === ARCADE_INPUT_RIGHT || base === ARCADE_INPUT_DOWN
        ? input
        : null;
    }
    return input;
  },
  render(ctx, state, time) {
    updateFx(state, time);
    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, '#0d0820');
    bg.addColorStop(1, '#05030c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawSide(ctx, state);
    drawBoard(ctx, state, time);
    drawOverlay(ctx, state, time);
  },
  snapshot: (state): Snapshot => ({
    locks: state.locks,
    clears: state.clears,
    lastClear: state.lastClear,
    hardDrops: state.hardDrops,
    rotations: state.rotations,
    hold: state.hold,
    level: state.level,
    x: state.piece?.x ?? -1,
    over: state.over,
  }),
  sounds(prev, next) {
    const a = prev as Snapshot | null;
    const b = next as Snapshot;
    if (!a) return [];
    const out: SfxName[] = [];
    if (b.over && !a.over) return ['lose'];
    if (b.clears > a.clears) out.push(b.lastClear >= 4 ? 'powerup' : 'line');
    else if (b.hardDrops > a.hardDrops) out.push('hit');
    else if (b.locks > a.locks) out.push('place');
    if (b.level > a.level) out.push('win');
    if (b.rotations > a.rotations) out.push('turn');
    if (b.hold !== a.hold) out.push('card');
    if (b.x !== a.x && b.locks === a.locks && a.x >= 0 && b.x >= 0) out.push('move');
    return out;
  },
};
