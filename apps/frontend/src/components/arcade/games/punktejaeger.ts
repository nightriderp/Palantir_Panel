import { ARCADE_PALETTE } from '../engine/palette';
import {
  type ArcadeGame,
  type ControlPhase,
  type GameControl,
  type GamePhase,
  type GameView,
} from '../engine/types';

/**
 * „Punktejäger" – eigenständiges Spiel in der Tradition der Labyrinth-Spiele
 * (Lastenheft §3.9, kein Originaltitel, kein nachgebautes Level).
 *
 * Ziehe durch ein Labyrinth, sammle jeden Punkt ein und halte Abstand zu den
 * Wächtern. Ist das Feld leer, füllt es sich neu und die Wächter werden etwas
 * schneller. Berührt dich ein Wächter, ist Schluss. Das Labyrinth entsteht aus
 * einem einfachen Säulenraster – kein Nachbau eines geschützten Levels.
 */

interface Cell {
  x: number;
  y: number;
}

interface Ghost {
  x: number;
  y: number;
  dir: Cell;
  color: string;
}

interface PunktejaegerState {
  readonly cols: number;
  readonly rows: number;
  walls: boolean[][];
  dots: boolean[][];
  dotsLeft: number;
  player: Cell;
  dir: Cell;
  pendingDir: Cell;
  ghosts: Ghost[];
  score: number;
  phase: GamePhase;
  accMs: number;
  ghostAccMs: number;
  ghostStepMs: number;
  random: () => number;
}

const SIZE = 15;
const VIEW: GameView = { width: 480, height: 480 };
const PLAYER_STEP_MS = 150;
const GHOST_BASE_STEP_MS = 190;
const GHOST_MIN_STEP_MS = 130;

const DIRS: Cell[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

const GHOST_COLORS = [ARCADE_PALETTE.danger, ARCADE_PALETTE.warning, ARCADE_PALETTE.brandBright];

/**
 * Wand? Rand ist immer Wand; im Inneren stehen Säulen an geraden Koordinaten.
 * Das Säulenraster ist garantiert zusammenhängend – jeder Freiraum ist
 * erreichbar, also lässt sich das Feld immer leer sammeln.
 */
function isWall(x: number, y: number): boolean {
  if (x <= 0 || y <= 0 || x >= SIZE - 1 || y >= SIZE - 1) return true;
  return x % 2 === 0 && y % 2 === 0;
}

function buildWalls(): boolean[][] {
  return Array.from({ length: SIZE }, (_, y) =>
    Array.from({ length: SIZE }, (_, x) => isWall(x, y)),
  );
}

function ghostStarts(): Cell[] {
  const center = SIZE - 2;
  return [
    { x: center, y: 1 },
    { x: 1, y: center },
    { x: center, y: center },
  ];
}

function fillDots(state: PunktejaegerState): void {
  let count = 0;
  const reserved = new Set<string>();
  reserved.add(`${state.player.x},${state.player.y}`);
  for (const ghost of state.ghosts) reserved.add(`${ghost.x},${ghost.y}`);

  state.dots = Array.from({ length: state.rows }, (_, y) =>
    Array.from({ length: state.cols }, (_, x) => {
      if (state.walls[y]![x]) return false;
      if (reserved.has(`${x},${y}`)) return false;
      count += 1;
      return true;
    }),
  );
  state.dotsLeft = count;
}

function inside(state: PunktejaegerState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < state.cols && y < state.rows;
}

function canMove(state: PunktejaegerState, x: number, y: number): boolean {
  return inside(state, x, y) && !state.walls[y]![x];
}

function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function stepPlayer(state: PunktejaegerState): void {
  if (canMove(state, state.player.x + state.pendingDir.x, state.player.y + state.pendingDir.y)) {
    state.dir = state.pendingDir;
  }
  const nx = state.player.x + state.dir.x;
  const ny = state.player.y + state.dir.y;
  if (!canMove(state, nx, ny)) return;

  state.player = { x: nx, y: ny };
  if (state.dots[ny]![nx]) {
    state.dots[ny]![nx] = false;
    state.dotsLeft -= 1;
    state.score += 10;
  }

  if (state.dotsLeft <= 0) {
    state.ghostStepMs = Math.max(GHOST_MIN_STEP_MS, state.ghostStepMs - 15);
    fillDots(state);
  }
}

function chooseGhostDir(state: PunktejaegerState, ghost: Ghost): Cell {
  const options = DIRS.filter((d) => canMove(state, ghost.x + d.x, ghost.y + d.y));
  if (options.length === 0) return ghost.dir;

  const nonReverse = options.filter((d) => !(d.x === -ghost.dir.x && d.y === -ghost.dir.y));
  const pool = nonReverse.length > 0 ? nonReverse : options;

  // Ein Teil der Züge zufällig, damit die Wächter nicht perfekt jagen.
  if (state.random() < 0.28) {
    return pool[Math.floor(state.random() * pool.length)]!;
  }

  let best = pool[0]!;
  let bestDist = Infinity;
  for (const d of pool) {
    const dist = manhattan({ x: ghost.x + d.x, y: ghost.y + d.y }, state.player);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

function stepGhosts(state: PunktejaegerState): void {
  for (const ghost of state.ghosts) {
    const dir = chooseGhostDir(state, ghost);
    ghost.dir = dir;
    if (canMove(state, ghost.x + dir.x, ghost.y + dir.y)) {
      ghost.x += dir.x;
      ghost.y += dir.y;
    }
  }
}

function touched(state: PunktejaegerState): boolean {
  return state.ghosts.some((ghost) => ghost.x === state.player.x && ghost.y === state.player.y);
}

export const punktejaeger: ArcadeGame<PunktejaegerState> = {
  id: 'punktejaeger',
  instructions: 'Pfeiltasten oder Wischtasten: sammle alle Punkte, weiche den Wächtern aus.',
  touch: 'dpad',
  view: VIEW,

  create(random = Math.random) {
    const walls = buildWalls();
    const ghosts: Ghost[] = ghostStarts().map((start, index) => ({
      ...start,
      dir: { x: 0, y: 0 },
      color: GHOST_COLORS[index % GHOST_COLORS.length]!,
    }));
    const state: PunktejaegerState = {
      cols: SIZE,
      rows: SIZE,
      walls,
      dots: [],
      dotsLeft: 0,
      player: { x: 1, y: 1 },
      dir: { x: 0, y: 0 },
      pendingDir: { x: 0, y: 0 },
      ghosts,
      score: 0,
      phase: 'ready',
      accMs: 0,
      ghostAccMs: 0,
      ghostStepMs: GHOST_BASE_STEP_MS,
      random,
    };
    fillDots(state);
    return state;
  },

  step(state, dtMs) {
    if (state.phase !== 'running') return state;

    state.accMs += dtMs;
    let budget = 4;
    while (state.accMs >= PLAYER_STEP_MS && budget > 0 && state.phase === 'running') {
      state.accMs -= PLAYER_STEP_MS;
      budget -= 1;
      stepPlayer(state);
      if (touched(state)) {
        state.phase = 'over';
        return state;
      }
    }

    state.ghostAccMs += dtMs;
    budget = 4;
    while (state.ghostAccMs >= state.ghostStepMs && budget > 0 && state.phase === 'running') {
      state.ghostAccMs -= state.ghostStepMs;
      budget -= 1;
      stepGhosts(state);
      if (touched(state)) {
        state.phase = 'over';
        return state;
      }
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
    if (dir) state.pendingDir = dir;
    return state;
  },

  phase: (state) => state.phase,
  score: (state) => state.score,

  render(ctx, state, view) {
    const cellW = view.width / state.cols;
    const cellH = view.height / state.rows;

    ctx.fillStyle = ARCADE_PALETTE.field;
    ctx.fillRect(0, 0, view.width, view.height);

    for (let y = 0; y < state.rows; y += 1) {
      for (let x = 0; x < state.cols; x += 1) {
        if (state.walls[y]![x]) {
          ctx.fillStyle = ARCADE_PALETTE.grid;
          ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
        } else if (state.dots[y]![x]) {
          ctx.fillStyle = ARCADE_PALETTE.muted;
          ctx.beginPath();
          ctx.arc(
            (x + 0.5) * cellW,
            (y + 0.5) * cellH,
            Math.min(cellW, cellH) * 0.12,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
    }

    // Spieler.
    ctx.fillStyle = ARCADE_PALETTE.accent;
    ctx.beginPath();
    ctx.arc(
      (state.player.x + 0.5) * cellW,
      (state.player.y + 0.5) * cellH,
      Math.min(cellW, cellH) * 0.38,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // Wächter.
    for (const ghost of state.ghosts) {
      ctx.fillStyle = ghost.color;
      ctx.beginPath();
      ctx.arc(
        (ghost.x + 0.5) * cellW,
        (ghost.y + 0.5) * cellH,
        Math.min(cellW, cellH) * 0.34,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  },
};
