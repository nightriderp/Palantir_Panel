/**
 * Pac-Man („punktejaeger") – eigenes Labyrinth, ein Schritt alle 16 ms.
 *
 * Positionen liegen in ganzzahligen Untereinheiten (`TILE` je Feld), damit
 * die Bewegung glatt aussieht und trotzdem ohne Gleitkomma-Drift nachrechenbar
 * bleibt. Abgebogen wird nur auf Feldmitten; die Bewegung hält dort an, fragt
 * nach der neuen Richtung und läuft mit dem Rest der Strecke weiter.
 *
 * Die Geister haben je eigenes Zielverhalten: direkt, vorausschauend,
 * flankierend und scheu. Zwischen Streifen (Ecken ansteuern) und Jagd wechselt
 * ein fester Zeitplan, verängstigt laufen sie zufällig – Zufall aus dem Zustand.
 */

import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  oppositeDirection,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { createRng, nextInt, type RngState } from '../rng.js';

/**
 * Eigenes Labyrinth. `#` Wand, `.` Punkt, `o` Kraftpille, `-` Tür des
 * Geisterhauses, `G` Hausinneres, Leerzeichen freier Gang ohne Punkt, `P`
 * Startfeld. Die offene Reihe 9 ist der Tunnel.
 */
export const MAZE: readonly string[] = [
  '###################',
  '#o.......#.......o#',
  '#.##.###.#.###.##.#',
  '#.................#',
  '#.##.#.#####.#.##.#',
  '#....#...#...#....#',
  '####.### # ###.####',
  '####.#       #.####',
  '####.# ##-## #.####',
  '    .  #GGG#  .    ',
  '####.# ##### #.####',
  '####.#       #.####',
  '####.# ##### #.####',
  '#........#........#',
  '#.##.###.#.###.##.#',
  '#o.#.....P.....#.o#',
  '##.#.#.#####.#.#.##',
  '#....#...#...#....#',
  '#.######.#.######.#',
  '#.................#',
  '###################',
];

export const MAZE_W = 19;
export const MAZE_H = 21;
/** Untereinheiten je Feld. */
export const TILE = 120;
const HALF = TILE / 2;

const PAC_START: [number, number] = [9, 15];
const EXIT_TILE: [number, number] = [9, 7];
const HOUSE_Y = 9;
export const FRUIT_TILE: [number, number] = [9, 11];

const DIRS: readonly ArcadeInput[] = [
  ARCADE_INPUT_UP,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_RIGHT,
];
const DELTA: Record<number, [number, number]> = {
  [ARCADE_INPUT_UP]: [0, -1],
  [ARCADE_INPUT_RIGHT]: [1, 0],
  [ARCADE_INPUT_DOWN]: [0, 1],
  [ARCADE_INPUT_LEFT]: [-1, 0],
};

/** Streif-Ecken außerhalb des Labyrinths: rot, violett, türkis, orange. */
const SCATTER: readonly [number, number][] = [
  [17, -2],
  [1, -2],
  [18, 22],
  [0, 22],
];
/** Wechsel Streifen/Jagd in Schritten; danach bleibt es bei der Jagd. */
const SCHEDULE = [420, 1200, 420, 1200, 300, 1200, 300];
const FRUIT_VALUES = [100, 300, 500, 700, 1000, 2000, 3000, 5000];
/** Bei so vielen gefressenen Punkten je Level erscheint eine Frucht. */
const FRUIT_AT = [60, 140];
const FRUIT_TTL = 540;
const EXTRA_LIFE_AT = 10_000;

export const READY_TICKS = 120;
export const DYING_TICKS = 100;
export const CLEARED_TICKS = 150;
const GHOST_EAT_PAUSE = 36;

export type GhostMode = 'house' | 'leaving' | 'active' | 'eyes' | 'entering';
export type PacPhase = 'ready' | 'play' | 'dying' | 'cleared' | 'over';

export interface Actor {
  x: number;
  y: number;
  dir: ArcadeInput;
}

export interface Pac extends Actor {
  /** Gepufferte Wunschrichtung – greift an der nächsten passenden Abzweigung. */
  want: ArcadeInput;
  moving: boolean;
}

export interface Ghost extends Actor {
  mode: GhostMode;
  frightened: boolean;
  /** Schritt seit Lebensbeginn, ab dem der Geist das Haus verlässt. */
  releaseAt: number;
}

export interface PacPopup {
  x: number;
  y: number;
  points: number;
  ttl: number;
}

export interface PacState {
  version: 1;
  rng: RngState;
  maze: string[];
  /** Je Feld 0 leer, 1 Punkt, 2 Kraftpille. */
  dots: number[];
  dotsLeft: number;
  dotsEatenLevel: number;
  level: number;
  lives: number;
  score: number;
  extraLifeGiven: boolean;
  pac: Pac;
  ghosts: Ghost[];
  phase: PacPhase;
  phaseTimer: number;
  /** Schritte seit Beginn des aktuellen Lebens (für die Hausfreigabe). */
  lifeTicks: number;
  modeIndex: number;
  modeTimer: number;
  frightTimer: number;
  frightTotal: number;
  /** Wie viele Geister in der laufenden Angstphase schon gefressen wurden. */
  combo: number;
  fruit: { kind: number; ttl: number } | null;
  fruitsSpawned: number;
  pauseTimer: number;
  popup: PacPopup | null;
  ticks: number;
  // Zähler für Geräusche der Oberfläche.
  dotsTotal: number;
  powerTotal: number;
  ghostsEaten: number;
  fruitsEaten: number;
  deaths: number;
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function center(tile: number): number {
  return tile * TILE + HALF;
}

function tileOf(v: number): number {
  return Math.floor(v / TILE);
}

function charAt(state: PacState, tx: number, ty: number): string {
  if (ty < 0 || ty >= MAZE_H) return '#';
  const row = state.maze[ty] ?? '';
  return row[mod(tx, MAZE_W)] ?? '#';
}

/** Für Pac-Man und Geister außerhalb des Hauses: Wände und Tür sperren. */
function passable(state: PacState, tx: number, ty: number): boolean {
  const c = charAt(state, tx, ty);
  return c !== '#' && c !== '-' && c !== 'G';
}

function isTunnel(tx: number, ty: number): boolean {
  return ty === 9 && (mod(tx, MAZE_W) < 4 || mod(tx, MAZE_W) > 14);
}

function atCenter(a: Actor): boolean {
  return mod(a.x - HALF, TILE) === 0 && mod(a.y - HALF, TILE) === 0;
}

/**
 * Bewegt um `dist` Untereinheiten. Auf jeder Feldmitte wird `decide`
 * gefragt; 0 heißt stehen bleiben.
 */
function advance(actor: Actor, dist: number, decide: (a: Actor) => ArcadeInput): void {
  let rest = dist;
  for (let guard = 0; rest > 0 && guard < 8; guard += 1) {
    if (atCenter(actor)) {
      const d = decide(actor);
      if (d === 0) return;
      actor.dir = d;
    }
    const delta = DELTA[actor.dir];
    if (!delta) return;
    const [dx, dy] = delta;
    const off = dx !== 0 ? mod(actor.x - HALF, TILE) : mod(actor.y - HALF, TILE);
    const positive = dx > 0 || dy > 0;
    const toNext = positive ? TILE - off : off === 0 ? TILE : off;
    const s = Math.min(rest, toNext);
    actor.x += dx * s;
    actor.y += dy * s;
    rest -= s;
    if (actor.x < 0) actor.x += MAZE_W * TILE;
    else if (actor.x >= MAZE_W * TILE) actor.x -= MAZE_W * TILE;
  }
}

/** Gerade auf ein Ziel zu (erst waagrecht, dann senkrecht) – für die Wege durchs Haus. */
function moveToward(actor: Actor, tx: number, ty: number, speed: number): boolean {
  let rest = speed;
  if (actor.x !== tx) {
    const s = Math.min(rest, Math.abs(tx - actor.x));
    actor.dir = tx > actor.x ? ARCADE_INPUT_RIGHT : ARCADE_INPUT_LEFT;
    actor.x += Math.sign(tx - actor.x) * s;
    rest -= s;
  }
  if (rest > 0 && actor.y !== ty) {
    const s = Math.min(rest, Math.abs(ty - actor.y));
    actor.dir = ty > actor.y ? ARCADE_INPUT_DOWN : ARCADE_INPUT_UP;
    actor.y += Math.sign(ty - actor.y) * s;
  }
  return actor.x === tx && actor.y === ty;
}

export function pacSpeed(level: number): number {
  return Math.min(17, 13 + level);
}

export function ghostSpeed(level: number): number {
  return Math.min(16, 11 + level);
}

export function frightTicks(level: number): number {
  return Math.max(90, 420 - (level - 1) * 60);
}

export function fruitValue(level: number): number {
  return FRUIT_VALUES[Math.min(level, FRUIT_VALUES.length) - 1] ?? 5000;
}

function scatterMode(state: PacState): boolean {
  return state.modeIndex < SCHEDULE.length && state.modeIndex % 2 === 0;
}

function freshDots(state: PacState): void {
  state.dots = [];
  state.dotsLeft = 0;
  for (let y = 0; y < MAZE_H; y += 1) {
    for (let x = 0; x < MAZE_W; x += 1) {
      const c = charAt(state, x, y);
      const v = c === '.' ? 1 : c === 'o' ? 2 : 0;
      state.dots.push(v);
      if (v > 0) state.dotsLeft += 1;
    }
  }
  state.dotsEatenLevel = 0;
  state.fruitsSpawned = 0;
}

function resetActors(state: PacState): void {
  state.pac = {
    x: center(PAC_START[0]),
    y: center(PAC_START[1]),
    dir: ARCADE_INPUT_LEFT,
    want: 0,
    moving: false,
  };
  const early = (state.level - 1) * 60;
  const release = [
    0,
    Math.max(0, 60 - early),
    Math.max(30, 360 - early),
    Math.max(60, 660 - early),
  ];
  const starts: [number, number][] = [EXIT_TILE, [9, HOUSE_Y], [8, HOUSE_Y], [10, HOUSE_Y]];
  state.ghosts = starts.map(([tx, ty], i) => ({
    x: center(tx),
    y: center(ty),
    dir: i === 0 ? ARCADE_INPUT_LEFT : ARCADE_INPUT_UP,
    mode: i === 0 ? 'active' : 'house',
    frightened: false,
    releaseAt: release[i] ?? 0,
  }));
  state.lifeTicks = 0;
  state.modeIndex = 0;
  state.modeTimer = 0;
  state.frightTimer = 0;
  state.combo = 0;
  state.fruit = null;
  state.pauseTimer = 0;
  state.popup = null;
  state.phase = 'ready';
  state.phaseTimer = READY_TICKS;
}

function create(seed: number): PacState {
  const state = {
    version: 1,
    rng: createRng(seed),
    maze: [...MAZE],
    dots: [],
    dotsLeft: 0,
    dotsEatenLevel: 0,
    level: 1,
    lives: 3,
    score: 0,
    extraLifeGiven: false,
    ghosts: [],
    phase: 'ready',
    phaseTimer: READY_TICKS,
    lifeTicks: 0,
    modeIndex: 0,
    modeTimer: 0,
    frightTimer: 0,
    frightTotal: 0,
    combo: 0,
    fruit: null,
    fruitsSpawned: 0,
    pauseTimer: 0,
    popup: null,
    ticks: 0,
    dotsTotal: 0,
    powerTotal: 0,
    ghostsEaten: 0,
    fruitsEaten: 0,
    deaths: 0,
  } as unknown as PacState;
  freshDots(state);
  resetActors(state);
  return state;
}

function addScore(state: PacState, points: number): void {
  state.score += points;
  if (!state.extraLifeGiven && state.score >= EXTRA_LIFE_AT) {
    state.extraLifeGiven = true;
    state.lives += 1;
  }
}

function isDirection(input: ArcadeInput): boolean {
  return DELTA[input] !== undefined;
}

function pacDecide(state: PacState) {
  return (a: Actor): ArcadeInput => {
    const pac = state.pac;
    const tx = tileOf(a.x);
    const ty = tileOf(a.y);
    const wantDelta = DELTA[pac.want];
    if (wantDelta && passable(state, tx + wantDelta[0], ty + wantDelta[1])) return pac.want;
    const d = DELTA[a.dir];
    if (d && passable(state, tx + d[0], ty + d[1])) return a.dir;
    return 0;
  };
}

/** Zielfeld eines Geistes je nach Charakter und Phase. */
export function ghostTarget(state: PacState, index: number): [number, number] {
  const corner = SCATTER[index] ?? [0, 0];
  if (scatterMode(state)) return corner;
  const pac = state.pac;
  const px = tileOf(pac.x);
  const py = tileOf(pac.y);
  const [dx, dy] = DELTA[pac.dir] ?? [0, 0];
  switch (index) {
    case 0:
      return [px, py];
    case 1:
      return [px + dx * 4, py + dy * 4];
    case 2: {
      const lead = state.ghosts[0];
      const rx = lead ? tileOf(lead.x) : px;
      const ry = lead ? tileOf(lead.y) : py;
      const ax = px + dx * 2;
      const ay = py + dy * 2;
      return [ax * 2 - rx, ay * 2 - ry];
    }
    default: {
      const g = state.ghosts[index];
      if (!g) return corner;
      const ex = tileOf(g.x) - px;
      const ey = tileOf(g.y) - py;
      return ex * ex + ey * ey > 64 ? [px, py] : corner;
    }
  }
}

function ghostDecide(state: PacState, index: number) {
  return (a: Actor): ArcadeInput => {
    const ghost = state.ghosts[index];
    if (!ghost) return 0;
    const tx = tileOf(a.x);
    const ty = tileOf(a.y);
    if (ghost.mode === 'eyes' && tx === EXIT_TILE[0] && ty === EXIT_TILE[1]) {
      ghost.mode = 'entering';
      return 0;
    }
    const back = oppositeDirection(a.dir);
    let options = DIRS.filter((d) => {
      const delta = DELTA[d];
      return d !== back && delta !== undefined && passable(state, tx + delta[0], ty + delta[1]);
    });
    if (options.length === 0) options = [back];
    if (ghost.frightened && ghost.mode === 'active') {
      return options[nextInt(state.rng, options.length)] ?? back;
    }
    const [gx, gy] = ghost.mode === 'eyes' ? EXIT_TILE : ghostTarget(state, index);
    let best = options[0] ?? back;
    let bestDist = Infinity;
    for (const d of options) {
      const delta = DELTA[d];
      if (!delta) continue;
      const nx = tx + delta[0] - gx;
      const ny = ty + delta[1] - gy;
      const dist = nx * nx + ny * ny;
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  };
}

function reverseActiveGhosts(state: PacState): void {
  for (const g of state.ghosts) {
    if (g.mode === 'active') g.dir = oppositeDirection(g.dir);
  }
}

function moveGhosts(state: PacState): void {
  state.ghosts.forEach((ghost, index) => {
    switch (ghost.mode) {
      case 'house':
        if (state.lifeTicks >= ghost.releaseAt) ghost.mode = 'leaving';
        return;
      case 'leaving':
        if (moveToward(ghost, center(EXIT_TILE[0]), center(EXIT_TILE[1]), 8)) {
          ghost.mode = 'active';
          ghost.dir = ARCADE_INPUT_LEFT;
        }
        return;
      case 'entering':
        if (moveToward(ghost, center(EXIT_TILE[0]), center(HOUSE_Y), 16)) {
          ghost.mode = 'leaving';
          ghost.frightened = false;
        }
        return;
      case 'eyes':
        advance(ghost, 32, ghostDecide(state, index));
        return;
      case 'active': {
        const speed = ghost.frightened
          ? 8
          : isTunnel(tileOf(ghost.x), tileOf(ghost.y))
            ? 7
            : ghostSpeed(state.level);
        advance(ghost, speed, ghostDecide(state, index));
        return;
      }
    }
  });
}

function eatAt(state: PacState): void {
  const tx = mod(tileOf(state.pac.x), MAZE_W);
  const ty = tileOf(state.pac.y);
  const i = ty * MAZE_W + tx;
  const v = state.dots[i] ?? 0;
  if (v > 0) {
    state.dots[i] = 0;
    state.dotsLeft -= 1;
    state.dotsEatenLevel += 1;
    if (v === 1) {
      addScore(state, 10);
      state.dotsTotal += 1;
    } else {
      addScore(state, 50);
      state.powerTotal += 1;
      state.frightTotal = frightTicks(state.level);
      state.frightTimer = state.frightTotal;
      state.combo = 0;
      for (const g of state.ghosts) {
        if (g.mode !== 'eyes' && g.mode !== 'entering') g.frightened = true;
      }
      reverseActiveGhosts(state);
    }
    if (
      state.fruitsSpawned < FRUIT_AT.length &&
      state.dotsEatenLevel === FRUIT_AT[state.fruitsSpawned]
    ) {
      state.fruitsSpawned += 1;
      state.fruit = { kind: Math.min(state.level, FRUIT_VALUES.length) - 1, ttl: FRUIT_TTL };
    }
  }
  if (state.fruit && tx === FRUIT_TILE[0] && ty === FRUIT_TILE[1]) {
    const points = fruitValue(state.level);
    addScore(state, points);
    state.fruitsEaten += 1;
    state.popup = { x: state.pac.x, y: state.pac.y, points, ttl: 60 };
    state.fruit = null;
  }
}

function collide(state: PacState): void {
  const pac = state.pac;
  const width = MAZE_W * TILE;
  for (const ghost of state.ghosts) {
    if (ghost.mode !== 'active') continue;
    let dx = Math.abs(ghost.x - pac.x);
    if (dx > width / 2) dx = width - dx;
    const dy = Math.abs(ghost.y - pac.y);
    if (dx + dy >= TILE * 0.6) continue;
    if (ghost.frightened) {
      const points = 200 * 2 ** Math.min(state.combo, 3);
      state.combo += 1;
      addScore(state, points);
      state.ghostsEaten += 1;
      ghost.mode = 'eyes';
      ghost.frightened = false;
      state.popup = { x: ghost.x, y: ghost.y, points, ttl: GHOST_EAT_PAUSE };
      state.pauseTimer = GHOST_EAT_PAUSE;
    } else {
      state.phase = 'dying';
      state.phaseTimer = DYING_TICKS;
      state.deaths += 1;
      return;
    }
  }
}

function play(state: PacState, input: ArcadeInput): void {
  const pac = state.pac;
  if (isDirection(input)) {
    pac.want = input;
    // Umkehren geht jederzeit, auch mitten im Gang.
    if (input === oppositeDirection(pac.dir)) pac.dir = input;
  }
  if (state.popup) {
    state.popup.ttl -= 1;
    if (state.popup.ttl <= 0) state.popup = null;
  }
  // Nach dem Fressen eines Geistes steht alles kurz still – die Punkte sollen lesbar sein.
  if (state.pauseTimer > 0) {
    state.pauseTimer -= 1;
    return;
  }
  state.lifeTicks += 1;

  if (state.frightTimer > 0) {
    state.frightTimer -= 1;
    if (state.frightTimer === 0) {
      for (const g of state.ghosts) g.frightened = false;
    }
  } else if (state.modeIndex < SCHEDULE.length) {
    state.modeTimer += 1;
    if (state.modeTimer >= (SCHEDULE[state.modeIndex] ?? Infinity)) {
      state.modeTimer = 0;
      state.modeIndex += 1;
      reverseActiveGhosts(state);
    }
  }

  if (state.fruit) {
    state.fruit.ttl -= 1;
    if (state.fruit.ttl <= 0) state.fruit = null;
  }

  const bx = pac.x;
  const by = pac.y;
  advance(pac, pacSpeed(state.level), pacDecide(state));
  pac.moving = pac.x !== bx || pac.y !== by;
  eatAt(state);
  collide(state);
  if (state.phase !== 'play') return;
  moveGhosts(state);
  collide(state);
  if (state.phase !== 'play') return;

  if (state.dotsLeft <= 0) {
    state.phase = 'cleared';
    state.phaseTimer = CLEARED_TICKS;
  }
}

function step(state: PacState, input: ArcadeInput): PacState {
  if (state.phase === 'over') return state;
  state.ticks += 1;
  switch (state.phase) {
    case 'ready':
      // Richtungswunsch schon vor dem Start merken.
      if (isDirection(input)) state.pac.want = input;
      state.phaseTimer -= 1;
      if (state.phaseTimer <= 0) state.phase = 'play';
      return state;
    case 'play':
      play(state, input);
      return state;
    case 'dying':
      state.phaseTimer -= 1;
      if (state.phaseTimer <= 0) {
        state.lives -= 1;
        if (state.lives <= 0) {
          state.phase = 'over';
        } else {
          resetActors(state);
        }
      }
      return state;
    case 'cleared':
      state.phaseTimer -= 1;
      if (state.phaseTimer <= 0) {
        state.level += 1;
        freshDots(state);
        resetActors(state);
      }
      return state;
    default:
      return state;
  }
}

export const game: RealtimeGame<PacState> = {
  kind: 'realtime',
  id: 'punktejaeger',
  version: 1,
  create,
  step,
  isOver: (state) => state.phase === 'over',
  score: (state) => Math.max(0, Math.floor(state.score)),
  tickMs: () => 16,
};
