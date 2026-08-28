import { ARCADE_PALETTE } from '../engine/palette';
import {
  type ArcadeGame,
  type ControlPhase,
  type GameControl,
  type GamePhase,
  type GameView,
} from '../engine/types';

/**
 * „Blockstapel" – eigenständiges Spiel in der Tradition der Stapel-Spiele
 * (Lastenheft §3.9, kein Originaltitel, keine Original-Assets).
 *
 * Fallende Formen aus vier Feldern wollen sinnvoll gestapelt werden.
 * Vollständige Reihen lösen sich auf und bringen Punkte; erreicht der Stapel die
 * Decke, ist Schluss. Die Formen selbst sind schlichte Geometrie – reine
 * Vier-Feld-Kombinationen ohne geschütztes Vorbild.
 */

type Shape = number[][];

interface Piece {
  shape: Shape;
  color: string;
  x: number;
  y: number;
}

interface BlockstapelState {
  readonly cols: number;
  readonly rows: number;
  grid: (string | null)[][];
  piece: Piece;
  bag: number[];
  score: number;
  lines: number;
  dropAccMs: number;
  softDrop: boolean;
  phase: GamePhase;
  random: () => number;
}

const COLS = 10;
const ROWS = 20;
const VIEW: GameView = { width: 300, height: 600 };

interface PieceDef {
  shape: Shape;
  color: string;
}

// Sieben schlichte Vier-Feld-Formen (reine Geometrie).
const PIECES: PieceDef[] = [
  { shape: [[1, 1, 1, 1]], color: ARCADE_PALETTE.accent },
  {
    shape: [
      [1, 1],
      [1, 1],
    ],
    color: ARCADE_PALETTE.warning,
  },
  {
    shape: [
      [0, 1, 0],
      [1, 1, 1],
    ],
    color: ARCADE_PALETTE.brand,
  },
  {
    shape: [
      [0, 1, 1],
      [1, 1, 0],
    ],
    color: ARCADE_PALETTE.success,
  },
  {
    shape: [
      [1, 1, 0],
      [0, 1, 1],
    ],
    color: ARCADE_PALETTE.danger,
  },
  {
    shape: [
      [1, 0, 0],
      [1, 1, 1],
    ],
    color: ARCADE_PALETTE.brandBright,
  },
  {
    shape: [
      [0, 0, 1],
      [1, 1, 1],
    ],
    color: '#f78fb5',
  },
];

const LINE_SCORE = [0, 100, 300, 500, 800];

function emptyGrid(): (string | null)[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
}

function rotate(shape: Shape): Shape {
  const rows = shape.length;
  const cols = shape[0]!.length;
  const result: Shape = Array.from({ length: cols }, () => Array.from({ length: rows }, () => 0));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      result[c]![rows - 1 - r] = shape[r]![c]!;
    }
  }
  return result;
}

function collides(state: BlockstapelState, shape: Shape, offX: number, offY: number): boolean {
  for (let r = 0; r < shape.length; r += 1) {
    for (let c = 0; c < shape[r]!.length; c += 1) {
      if (shape[r]![c] === 0) continue;
      const gx = offX + c;
      const gy = offY + r;
      if (gx < 0 || gx >= state.cols || gy >= state.rows) return true;
      if (gy >= 0 && state.grid[gy]![gx] !== null) return true;
    }
  }
  return false;
}

function refillBag(state: BlockstapelState): void {
  const bag = [0, 1, 2, 3, 4, 5, 6];
  // Fisher-Yates mit der injizierten Zufallsquelle (deterministisch testbar).
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = Math.floor(state.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j]!, bag[i]!];
  }
  state.bag = bag;
}

function spawn(state: BlockstapelState): void {
  if (state.bag.length === 0) refillBag(state);
  const index = state.bag.shift()!;
  const def = PIECES[index]!;
  const shape = def.shape.map((row) => [...row]);
  const x = Math.floor((state.cols - shape[0]!.length) / 2);
  const piece: Piece = { shape, color: def.color, x, y: 0 };
  if (collides(state, piece.shape, piece.x, piece.y)) {
    state.phase = 'over';
  }
  state.piece = piece;
}

function lockPiece(state: BlockstapelState): void {
  const { shape, color, x, y } = state.piece;
  for (let r = 0; r < shape.length; r += 1) {
    for (let c = 0; c < shape[r]!.length; c += 1) {
      if (shape[r]![c] === 0) continue;
      const gy = y + r;
      const gx = x + c;
      if (gy >= 0 && gy < state.rows && gx >= 0 && gx < state.cols) {
        state.grid[gy]![gx] = color;
      }
    }
  }

  // Volle Reihen entfernen.
  const kept = state.grid.filter((row) => row.some((cell) => cell === null));
  const cleared = state.rows - kept.length;
  if (cleared > 0) {
    const fresh = Array.from({ length: cleared }, () =>
      Array.from({ length: state.cols }, () => null),
    );
    state.grid = [...fresh, ...kept];
    state.lines += cleared;
    state.score += LINE_SCORE[cleared] ?? 0;
  }

  spawn(state);
}

function dropStepMs(lines: number): number {
  return Math.max(120, 650 - Math.floor(lines / 8) * 60);
}

function tryMove(state: BlockstapelState, dx: number, dy: number): boolean {
  if (collides(state, state.piece.shape, state.piece.x + dx, state.piece.y + dy)) return false;
  state.piece.x += dx;
  state.piece.y += dy;
  return true;
}

export const blockstapel: ArcadeGame<BlockstapelState> = {
  id: 'blockstapel',
  instructions:
    'Links/Rechts: verschieben · Runter: schneller fallen · Aktion (Leertaste/↑): drehen.',
  touch: 'stack',
  view: VIEW,

  create(random = Math.random) {
    const state: BlockstapelState = {
      cols: COLS,
      rows: ROWS,
      grid: emptyGrid(),
      piece: { shape: PIECES[0]!.shape, color: PIECES[0]!.color, x: 3, y: 0 },
      bag: [],
      score: 0,
      lines: 0,
      dropAccMs: 0,
      softDrop: false,
      phase: 'ready',
      random,
    };
    refillBag(state);
    spawn(state);
    return state;
  },

  step(state, dtMs) {
    if (state.phase !== 'running') return state;
    state.dropAccMs += dtMs;
    const interval = state.softDrop ? 45 : dropStepMs(state.lines);
    let budget = 6;
    while (state.dropAccMs >= interval && budget > 0 && state.phase === 'running') {
      state.dropAccMs -= interval;
      budget -= 1;
      if (!tryMove(state, 0, 1)) {
        lockPiece(state);
      } else if (state.softDrop) {
        state.score += 1;
      }
    }
    return state;
  },

  control(state, control: GameControl, phase: ControlPhase) {
    if (state.phase === 'over') return state;
    if (phase === 'press' && state.phase === 'ready') state.phase = 'running';
    if (state.phase !== 'running') return state;

    if (control === 'down') {
      state.softDrop = phase === 'press';
      return state;
    }

    if (phase !== 'press') return state;

    if (control === 'left') {
      tryMove(state, -1, 0);
    } else if (control === 'right') {
      tryMove(state, 1, 0);
    } else if (control === 'action' || control === 'up') {
      const rotated = rotate(state.piece.shape);
      // Einfacher Wandstoß: an Ort und Stelle, dann leicht versetzt.
      for (const kick of [0, -1, 1, -2, 2]) {
        if (!collides(state, rotated, state.piece.x + kick, state.piece.y)) {
          state.piece.shape = rotated;
          state.piece.x += kick;
          break;
        }
      }
    }
    return state;
  },

  phase: (state) => state.phase,
  score: (state) => state.score,

  render(ctx, state, view) {
    const cellW = view.width / state.cols;
    const cellH = view.height / state.rows;

    ctx.fillStyle = ARCADE_PALETTE.field;
    ctx.fillRect(0, 0, view.width, view.height);

    // Raster.
    ctx.strokeStyle = ARCADE_PALETTE.grid;
    ctx.lineWidth = 1;
    for (let c = 1; c < state.cols; c += 1) {
      ctx.beginPath();
      ctx.moveTo(c * cellW, 0);
      ctx.lineTo(c * cellW, view.height);
      ctx.stroke();
    }

    function drawCell(gx: number, gy: number, color: string): void {
      if (gy < 0) return;
      ctx.fillStyle = color;
      ctx.fillRect(gx * cellW + 1, gy * cellH + 1, cellW - 2, cellH - 2);
    }

    for (let r = 0; r < state.rows; r += 1) {
      for (let c = 0; c < state.cols; c += 1) {
        const color = state.grid[r]![c];
        if (color) drawCell(c, r, color);
      }
    }

    const { shape, color, x, y } = state.piece;
    for (let r = 0; r < shape.length; r += 1) {
      for (let c = 0; c < shape[r]!.length; c += 1) {
        if (shape[r]![c] === 1) drawCell(x + c, y + r, color);
      }
    }
  },
};
