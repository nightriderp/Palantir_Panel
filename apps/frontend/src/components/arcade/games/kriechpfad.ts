import { ARCADE_PALETTE } from '../engine/palette';
import {
  type ArcadeGame,
  type ControlPhase,
  type GameControl,
  type GamePhase,
  type GameView,
} from '../engine/types';

/**
 * „Kriechpfad" – eigenständiges Spiel in der Tradition der Schlangen-Spiele
 * (Lastenheft §3.9, kein Originaltitel, keine Original-Assets).
 *
 * Eine wachsende Linie zieht über ein Raster, frisst Häppchen und darf weder die
 * Wand noch sich selbst treffen. Jeder Bissen verlängert sie und erhöht das
 * Tempo leicht.
 */

interface Cell {
  x: number;
  y: number;
}

interface KriechpfadState {
  readonly cols: number;
  readonly rows: number;
  snake: Cell[];
  dir: Cell;
  pendingDir: Cell;
  food: Cell;
  grow: number;
  score: number;
  phase: GamePhase;
  accMs: number;
  random: () => number;
}

const COLS = 20;
const ROWS = 20;
const VIEW: GameView = { width: 480, height: 480 };
const BASE_STEP_MS = 150;
const MIN_STEP_MS = 70;

function stepMsFor(length: number): number {
  // Mit jeder Länge etwas schneller, bis zur Untergrenze.
  return Math.max(MIN_STEP_MS, BASE_STEP_MS - (length - 3) * 4);
}

function placeFood(state: KriechpfadState): Cell {
  const occupied = new Set(state.snake.map((cell) => `${cell.x},${cell.y}`));
  const free: Cell[] = [];
  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return state.food;
  const index = Math.min(free.length - 1, Math.floor(state.random() * free.length));
  return free[index]!;
}

function isReverse(a: Cell, b: Cell): boolean {
  return a.x === -b.x && a.y === -b.y;
}

function advance(state: KriechpfadState): void {
  if (!isReverse(state.pendingDir, state.dir)) {
    state.dir = state.pendingDir;
  }

  const head = state.snake[0]!;
  const next: Cell = { x: head.x + state.dir.x, y: head.y + state.dir.y };

  const hitsWall = next.x < 0 || next.y < 0 || next.x >= state.cols || next.y >= state.rows;
  const hitsSelf = state.snake.some((cell, index) => {
    // Das letzte Glied macht Platz, sofern nicht gewachsen wird.
    if (index === state.snake.length - 1 && state.grow === 0) return false;
    return cell.x === next.x && cell.y === next.y;
  });

  if (hitsWall || hitsSelf) {
    state.phase = 'over';
    return;
  }

  state.snake.unshift(next);

  if (next.x === state.food.x && next.y === state.food.y) {
    state.score += 10;
    state.grow += 2;
    state.food = placeFood(state);
  }

  if (state.grow > 0) {
    state.grow -= 1;
  } else {
    state.snake.pop();
  }
}

export const kriechpfad: ArcadeGame<KriechpfadState> = {
  id: 'kriechpfad',
  instructions:
    'Pfeiltasten oder Wischtasten: lenke die Linie. Friss die Häppchen, meide dich selbst.',
  touch: 'dpad',
  view: VIEW,

  create(random = Math.random) {
    const start: Cell[] = [
      { x: 9, y: 10 },
      { x: 8, y: 10 },
      { x: 7, y: 10 },
    ];
    const state: KriechpfadState = {
      cols: COLS,
      rows: ROWS,
      snake: start,
      dir: { x: 1, y: 0 },
      pendingDir: { x: 1, y: 0 },
      food: { x: 14, y: 10 },
      grow: 0,
      score: 0,
      phase: 'ready',
      accMs: 0,
      random,
    };
    state.food = placeFood(state);
    return state;
  },

  step(state, dtMs) {
    if (state.phase !== 'running') return state;
    state.accMs += dtMs;
    const stepMs = stepMsFor(state.snake.length);
    // Bei einem langen Bild-Aussetzer nicht beliebig viele Schritte nachholen.
    let budget = 4;
    while (state.accMs >= stepMs && budget > 0 && state.phase === 'running') {
      state.accMs -= stepMs;
      budget -= 1;
      advance(state);
    }
    return state;
  },

  control(state, control: GameControl, phase: ControlPhase) {
    if (phase !== 'press') return state;
    if (state.phase === 'over') return state;
    if (state.phase === 'ready') state.phase = 'running';

    const map: Record<GameControl, Cell | null> = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
      action: null,
    };
    const dir = map[control];
    if (dir && !isReverse(dir, state.dir)) {
      state.pendingDir = dir;
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

    // Häppchen.
    ctx.fillStyle = ARCADE_PALETTE.accent;
    ctx.beginPath();
    ctx.arc(
      (state.food.x + 0.5) * cellW,
      (state.food.y + 0.5) * cellH,
      Math.min(cellW, cellH) * 0.32,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Linie: Kopf hell, Körper in Markenfarbe.
    state.snake.forEach((cell, index) => {
      ctx.fillStyle = index === 0 ? ARCADE_PALETTE.brandBright : ARCADE_PALETTE.brand;
      const pad = Math.min(cellW, cellH) * 0.12;
      ctx.fillRect(cell.x * cellW + pad, cell.y * cellH + pad, cellW - pad * 2, cellH - pad * 2);
    });
  },
};
