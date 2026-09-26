/**
 * Space Invaders – 5 × 11 Angreifer, vier Bunker, ein UFO, drei Leben.
 *
 * Fester Takt von 16 ms. Die Formation marschiert in Stufen: je weniger
 * Angreifer übrig sind, desto kürzer die Pause zwischen zwei Stufen – das
 * klassische Beschleunigen ergibt sich so von selbst. Alle Positionen sind
 * Vielfache kleiner Schrittweiten; gerechnet wird nur mit Grundrechenarten.
 *
 * Die Bunker liegen als Raster aus 2-px-Zellen im Zustand (Zahlen 0/1, damit
 * der Zustand reines JSON bleibt). Treffer fressen ein Loch mit leicht
 * zufälligem Rand, der Zufall kommt wie alles andere aus dem Startwert.
 */

import {
  ARCADE_INPUT_ACTION,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RELEASE,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  type ArcadeInput,
  type RealtimeGame,
} from '../realtime.js';
import { createRng, nextInt, nextRandom, type RngState } from '../rng.js';

export const INV_W = 360;
export const INV_H = 420;
export const INV_COLS = 11;
export const INV_ROWS = 5;
export const INV_CELL_W = 26;
export const INV_CELL_H = 22;
/** Breite der Angreifer je Typ (0 oben … 2 unten); Höhe einheitlich. */
export const INV_ALIEN_W: readonly number[] = [16, 22, 24];
export const INV_ALIEN_H = 16;
/** Typ je Reihe und Punkte je Reihe. */
export const INV_ROW_TYPE: readonly number[] = [0, 1, 1, 2, 2];
const ROW_POINTS: readonly number[] = [30, 20, 20, 10, 10];

export const INV_PLAYER_Y = 378;
export const INV_PLAYER_W = 26;
export const INV_PLAYER_H = 14;
export const INV_GROUND_Y = 402;

export const INV_BUNKER_COLS = 22;
export const INV_BUNKER_ROWS = 16;
export const INV_BUNKER_CELL = 2;
export const INV_BUNKER_Y = 316;
export const INV_UFO_Y = 40;
export const INV_UFO_W = 28;

const PLAYER_SPEED = 2.6;
const PLAYER_SHOT_SPEED = 7;
const SHOT_W = 2;
const SHOT_H = 8;
const MARCH_STEP = 4;
const DROP_STEP = 12;
const EDGE = 8;
const START_LIVES = 3;
const EXTRA_LIFE_AT = 1500;
const DEATH_TICKS = 90;
const WAVE_BREAK_TICKS = 90;
const UFO_SPEED = 1.3;
const UFO_POINTS: readonly number[] = [50, 100, 150, 300];

export interface InvShot {
  x: number;
  y: number;
  /** Nur für die Zeichnung: Zickzack oder Blitz. */
  kind: number;
}

export interface InvUfo {
  x: number;
  dir: number;
}

export interface InvExplosion {
  x: number;
  y: number;
  ttl: number;
  /** 0 Angreifer, 1 Spieler, 2 UFO, 3 Schuss/Bunker. */
  kind: number;
  points: number;
}

export interface InvadersState {
  version: 1;
  rng: RngState;
  tick: number;
  over: boolean;
  score: number;
  lives: number;
  wave: number;
  extraGiven: boolean;
  /** 1 = lebt, 0 = abgeschossen; Index `row * INV_COLS + col`. */
  aliens: number[];
  formX: number;
  formY: number;
  formDir: number;
  marchWait: number;
  /** Wechselt bei jeder Marschstufe – für die zweibildige Animation. */
  frame: number;
  playerX: number;
  left: boolean;
  right: boolean;
  shot: InvShot | null;
  enemyShots: InvShot[];
  fireWait: number;
  /** Vier Bunker, je `INV_BUNKER_COLS * INV_BUNKER_ROWS` Zellen. */
  bunkers: number[][];
  ufo: InvUfo | null;
  ufoWait: number;
  /** > 0: Spieler explodiert gerade, alles steht. */
  dying: number;
  /** > 0: Pause bis zur nächsten Welle. */
  waveBreak: number;
  explosions: InvExplosion[];
  /** Zähler nur für Geräusche. */
  shotsFired: number;
  kills: number;
  marches: number;
  ufoHits: number;
  bunkerHits: number;
}

/** Linke Kante von Bunker `i`. */
export function bunkerLeft(i: number): number {
  return Math.round((INV_W * (i + 1)) / 5) - (INV_BUNKER_COLS * INV_BUNKER_CELL) / 2;
}

function buildBunker(): number[] {
  const cells: number[] = [];
  for (let r = 0; r < INV_BUNKER_ROWS; r += 1) {
    for (let c = 0; c < INV_BUNKER_COLS; c += 1) {
      const fromEdge = Math.min(c, INV_BUNKER_COLS - 1 - c);
      // Abgerundete Kuppel oben, Durchgang unten in der Mitte.
      const roof = r < 3 && fromEdge < 3 - r;
      const arch = (r >= 11 && c >= 7 && c <= 14) || (r === 10 && c >= 8 && c <= 13);
      cells.push(roof || arch ? 0 : 1);
    }
  }
  return cells;
}

function formationStartY(wave: number): number {
  return 70 + Math.min(wave - 1, 6) * 12;
}

export function alienRect(
  state: InvadersState,
  index: number,
): { x: number; y: number; w: number; h: number } {
  const row = Math.floor(index / INV_COLS);
  const col = index % INV_COLS;
  const w = INV_ALIEN_W[INV_ROW_TYPE[row] ?? 0] ?? 16;
  const cx = state.formX + col * INV_CELL_W + INV_CELL_W / 2;
  return { x: cx - w / 2, y: state.formY + row * INV_CELL_H, w, h: INV_ALIEN_H };
}

function overlaps(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function aliveCount(state: InvadersState): number {
  let n = 0;
  for (const a of state.aliens) n += a;
  return n;
}

function marchInterval(state: InvadersState): number {
  const alive = aliveCount(state);
  const speedUp = Math.min(state.wave - 1, 3);
  return Math.max(1, Math.floor((alive * 30) / 55) + 2 - speedUp);
}

function startWave(state: InvadersState): void {
  state.aliens = new Array<number>(INV_COLS * INV_ROWS).fill(1);
  state.formX = (INV_W - INV_COLS * INV_CELL_W) / 2;
  state.formY = formationStartY(state.wave);
  state.formDir = 1;
  state.frame = 0;
  state.bunkers = [buildBunker(), buildBunker(), buildBunker(), buildBunker()];
  state.enemyShots = [];
  state.shot = null;
  state.marchWait = marchInterval(state);
  state.fireWait = 60;
}

function addScore(state: InvadersState, points: number): void {
  state.score += points;
  if (!state.extraGiven && state.score >= EXTRA_LIFE_AT) {
    state.extraGiven = true;
    state.lives += 1;
  }
}

/** Waagerechte Ausdehnung der lebenden Angreifer bei gegebenem `formX`. */
function formationBounds(
  state: InvadersState,
  formX: number,
): { minX: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < state.aliens.length; i += 1) {
    if (state.aliens[i] !== 1) continue;
    const row = Math.floor(i / INV_COLS);
    const col = i % INV_COLS;
    const w = INV_ALIEN_W[INV_ROW_TYPE[row] ?? 0] ?? 16;
    const cx = formX + col * INV_CELL_W + INV_CELL_W / 2;
    minX = Math.min(minX, cx - w / 2);
    maxX = Math.max(maxX, cx + w / 2);
    maxY = Math.max(maxY, state.formY + row * INV_CELL_H + INV_ALIEN_H);
  }
  return { minX, maxX, maxY };
}

function march(state: InvadersState): void {
  state.marches += 1;
  state.frame = 1 - state.frame;
  const nextX = state.formX + state.formDir * MARCH_STEP;
  const bounds = formationBounds(state, nextX);
  if (bounds.minX < EDGE || bounds.maxX > INV_W - EDGE) {
    state.formY += DROP_STEP;
    state.formDir = -state.formDir;
  } else {
    state.formX = nextX;
  }
  // Angreifer walzen Bunker nieder, die sie berühren.
  for (let i = 0; i < state.aliens.length; i += 1) {
    if (state.aliens[i] !== 1) continue;
    const rect = alienRect(state, i);
    for (let b = 0; b < 4; b += 1) eraseRect(state, b, rect.x, rect.y, rect.w, rect.h);
  }
  const { maxY } = formationBounds(state, state.formX);
  if (maxY >= INV_PLAYER_Y) {
    // Gelandet: die Invasion ist geglückt, egal wie viele Leben noch da sind.
    state.lives = 0;
    state.over = true;
    state.explosions.push({ x: state.playerX, y: INV_PLAYER_Y, ttl: 30, kind: 1, points: 0 });
  }
}

function eraseRect(
  state: InvadersState,
  b: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cells = state.bunkers[b];
  if (!cells) return;
  const left = bunkerLeft(b);
  const c0 = Math.max(0, Math.floor((x - left) / INV_BUNKER_CELL));
  const c1 = Math.min(INV_BUNKER_COLS - 1, Math.floor((x + w - 1 - left) / INV_BUNKER_CELL));
  const r0 = Math.max(0, Math.floor((y - INV_BUNKER_Y) / INV_BUNKER_CELL));
  const r1 = Math.min(
    INV_BUNKER_ROWS - 1,
    Math.floor((y + h - 1 - INV_BUNKER_Y) / INV_BUNKER_CELL),
  );
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) cells[r * INV_BUNKER_COLS + c] = 0;
  }
}

/** Trifft der Schuss eine Bunkerzelle? Dann Loch fressen und `true`. */
function shotHitsBunker(state: InvadersState, shot: InvShot): boolean {
  for (let b = 0; b < 4; b += 1) {
    const cells = state.bunkers[b];
    if (!cells) continue;
    const left = bunkerLeft(b);
    const sx = shot.x - SHOT_W / 2;
    if (
      !overlaps(
        sx,
        shot.y,
        SHOT_W,
        SHOT_H,
        left,
        INV_BUNKER_Y,
        INV_BUNKER_COLS * INV_BUNKER_CELL,
        INV_BUNKER_ROWS * INV_BUNKER_CELL,
      )
    ) {
      continue;
    }
    const c0 = Math.max(0, Math.floor((sx - left) / INV_BUNKER_CELL));
    const c1 = Math.min(
      INV_BUNKER_COLS - 1,
      Math.floor((sx + SHOT_W - 1 - left) / INV_BUNKER_CELL),
    );
    const r0 = Math.max(0, Math.floor((shot.y - INV_BUNKER_Y) / INV_BUNKER_CELL));
    const r1 = Math.min(
      INV_BUNKER_ROWS - 1,
      Math.floor((shot.y + SHOT_H - 1 - INV_BUNKER_Y) / INV_BUNKER_CELL),
    );
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        if (cells[r * INV_BUNKER_COLS + c] !== 1) continue;
        crater(state, cells, c, r);
        state.bunkerHits += 1;
        state.explosions.push({
          x: left + c * INV_BUNKER_CELL,
          y: INV_BUNKER_Y + r * INV_BUNKER_CELL,
          ttl: 10,
          kind: 3,
          points: 0,
        });
        return true;
      }
    }
  }
  return false;
}

function crater(state: InvadersState, cells: number[], c: number, r: number): void {
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > 3) continue;
      // Innen sicher weg, am Rand ausgefranst.
      if (d === 3 && nextRandom(state.rng) < 0.5) continue;
      const cc = c + dx;
      const rr = r + dy;
      if (cc < 0 || cc >= INV_BUNKER_COLS || rr < 0 || rr >= INV_BUNKER_ROWS) continue;
      cells[rr * INV_BUNKER_COLS + cc] = 0;
    }
  }
}

function enemyFire(state: InvadersState): void {
  state.fireWait -= 1;
  if (state.fireWait > 0) return;
  const maxShots = state.wave >= 3 ? 4 : 3;
  state.fireWait = 24 + nextInt(state.rng, 40) - Math.min(state.wave * 3, 15);
  if (state.enemyShots.length >= maxShots) return;
  const columns: number[] = [];
  for (let col = 0; col < INV_COLS; col += 1) {
    for (let row = 0; row < INV_ROWS; row += 1) {
      if (state.aliens[row * INV_COLS + col] === 1) {
        columns.push(col);
        break;
      }
    }
  }
  if (columns.length === 0) return;
  let col = columns[nextInt(state.rng, columns.length)] ?? 0;
  // Jeder dritte Schuss zielt auf den Spieler.
  if (nextInt(state.rng, 3) === 0) {
    let best = Infinity;
    for (const c of columns) {
      const cx = state.formX + c * INV_CELL_W + INV_CELL_W / 2;
      const d = Math.abs(cx - state.playerX);
      if (d < best) {
        best = d;
        col = c;
      }
    }
  }
  for (let row = INV_ROWS - 1; row >= 0; row -= 1) {
    const index = row * INV_COLS + col;
    if (state.aliens[index] !== 1) continue;
    const rect = alienRect(state, index);
    state.enemyShots.push({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h,
      kind: nextInt(state.rng, 2),
    });
    return;
  }
}

function hitPlayer(state: InvadersState): void {
  state.dying = DEATH_TICKS;
  state.lives -= 1;
  state.enemyShots = [];
  state.shot = null;
  state.explosions.push({ x: state.playerX, y: INV_PLAYER_Y + 6, ttl: 40, kind: 1, points: 0 });
}

function handleInput(state: InvadersState, input: ArcadeInput): void {
  if (input === ARCADE_INPUT_LEFT) state.left = true;
  else if (input === ARCADE_INPUT_RIGHT) state.right = true;
  else if (input === ARCADE_INPUT_LEFT + ARCADE_INPUT_RELEASE) state.left = false;
  else if (input === ARCADE_INPUT_RIGHT + ARCADE_INPUT_RELEASE) state.right = false;
  else if (
    (input === ARCADE_INPUT_ACTION || input === ARCADE_INPUT_UP) &&
    state.shot === null &&
    state.dying === 0 &&
    state.waveBreak === 0
  ) {
    state.shot = { x: state.playerX, y: INV_PLAYER_Y - SHOT_H, kind: 0 };
    state.shotsFired += 1;
  }
}

function movePlayerShot(state: InvadersState): void {
  const shot = state.shot;
  if (!shot) return;
  shot.y -= PLAYER_SHOT_SPEED;
  if (shot.y + SHOT_H < 24) {
    state.shot = null;
    return;
  }
  // Schuss gegen Schuss: beide weg.
  for (let i = 0; i < state.enemyShots.length; i += 1) {
    const e = state.enemyShots[i];
    if (!e) continue;
    if (overlaps(shot.x - 2, shot.y, 4, SHOT_H + PLAYER_SHOT_SPEED, e.x - 2, e.y, 4, SHOT_H)) {
      state.enemyShots.splice(i, 1);
      state.shot = null;
      state.explosions.push({ x: shot.x, y: shot.y, ttl: 10, kind: 3, points: 0 });
      return;
    }
  }
  if (shotHitsBunker(state, shot)) {
    state.shot = null;
    return;
  }
  for (let i = 0; i < state.aliens.length; i += 1) {
    if (state.aliens[i] !== 1) continue;
    const rect = alienRect(state, i);
    // Der Schuss überstreicht seinen ganzen Weg in diesem Schritt – sonst springt er durch.
    if (
      overlaps(
        shot.x - SHOT_W / 2,
        shot.y,
        SHOT_W,
        SHOT_H + PLAYER_SHOT_SPEED,
        rect.x,
        rect.y,
        rect.w,
        rect.h,
      )
    ) {
      state.aliens[i] = 0;
      const points = ROW_POINTS[Math.floor(i / INV_COLS)] ?? 10;
      addScore(state, points);
      state.kills += 1;
      state.shot = null;
      state.explosions.push({
        x: rect.x + rect.w / 2,
        y: rect.y + rect.h / 2,
        ttl: 16,
        kind: 0,
        points,
      });
      return;
    }
  }
  const ufo = state.ufo;
  if (
    ufo &&
    overlaps(shot.x - 1, shot.y, SHOT_W, SHOT_H, ufo.x - INV_UFO_W / 2, INV_UFO_Y, INV_UFO_W, 12)
  ) {
    const points = UFO_POINTS[nextInt(state.rng, UFO_POINTS.length)] ?? 100;
    addScore(state, points);
    state.ufoHits += 1;
    state.explosions.push({ x: ufo.x, y: INV_UFO_Y + 6, ttl: 60, kind: 2, points });
    state.ufo = null;
    state.shot = null;
  }
}

function moveEnemyShots(state: InvadersState): void {
  const speed = 2.4 + 0.2 * Math.min(state.wave, 5);
  const kept: InvShot[] = [];
  for (const shot of state.enemyShots) {
    shot.y += speed;
    if (shot.y > INV_GROUND_Y) {
      state.explosions.push({ x: shot.x, y: INV_GROUND_Y, ttl: 8, kind: 3, points: 0 });
      continue;
    }
    if (shotHitsBunker(state, shot)) continue;
    if (
      state.dying === 0 &&
      overlaps(
        shot.x - SHOT_W / 2,
        shot.y,
        SHOT_W,
        SHOT_H,
        state.playerX - INV_PLAYER_W / 2,
        INV_PLAYER_Y,
        INV_PLAYER_W,
        INV_PLAYER_H,
      )
    ) {
      hitPlayer(state);
      return;
    }
    kept.push(shot);
  }
  state.enemyShots = kept;
}

function moveUfo(state: InvadersState): void {
  if (state.ufo) {
    state.ufo.x += state.ufo.dir * UFO_SPEED;
    if (state.ufo.x < -INV_UFO_W || state.ufo.x > INV_W + INV_UFO_W) state.ufo = null;
    return;
  }
  state.ufoWait -= 1;
  if (state.ufoWait > 0) return;
  state.ufoWait = 900 + nextInt(state.rng, 900);
  if (aliveCount(state) < 8) return;
  const dir = nextInt(state.rng, 2) === 0 ? 1 : -1;
  state.ufo = { x: dir > 0 ? -INV_UFO_W / 2 : INV_W + INV_UFO_W / 2, dir };
}

export const game: RealtimeGame<InvadersState> = {
  kind: 'realtime',
  id: 'invaders',
  version: 1,

  create(seed) {
    const state: InvadersState = {
      version: 1,
      rng: createRng(seed),
      tick: 0,
      over: false,
      score: 0,
      lives: START_LIVES,
      wave: 1,
      extraGiven: false,
      aliens: [],
      formX: 0,
      formY: 0,
      formDir: 1,
      marchWait: 0,
      frame: 0,
      playerX: INV_W / 2,
      left: false,
      right: false,
      shot: null,
      enemyShots: [],
      fireWait: 0,
      bunkers: [],
      ufo: null,
      ufoWait: 900,
      dying: 0,
      waveBreak: 0,
      explosions: [],
      shotsFired: 0,
      kills: 0,
      marches: 0,
      ufoHits: 0,
      bunkerHits: 0,
    };
    startWave(state);
    return state;
  },

  step(state, input) {
    if (state.over) return state;
    state.tick += 1;
    handleInput(state, input);

    for (const e of state.explosions) e.ttl -= 1;
    state.explosions = state.explosions.filter((e) => e.ttl > 0);

    if (state.dying > 0) {
      state.dying -= 1;
      if (state.dying === 0 && state.lives <= 0) {
        state.lives = 0;
        state.over = true;
      }
      return state;
    }

    if (state.waveBreak > 0) {
      state.waveBreak -= 1;
      if (state.waveBreak === 0) {
        state.wave += 1;
        startWave(state);
      }
    }

    const dir = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    const half = INV_PLAYER_W / 2;
    state.playerX = Math.min(
      INV_W - EDGE - half,
      Math.max(EDGE + half, state.playerX + dir * PLAYER_SPEED),
    );

    movePlayerShot(state);
    if (state.waveBreak > 0) return state;

    if (aliveCount(state) === 0) {
      state.waveBreak = WAVE_BREAK_TICKS;
      state.enemyShots = [];
      state.ufo = null;
      addScore(state, 100 * state.wave);
      return state;
    }

    state.marchWait -= 1;
    if (state.marchWait <= 0) {
      march(state);
      state.marchWait = marchInterval(state);
      if (state.over) return state;
    }

    enemyFire(state);
    moveEnemyShots(state);
    moveUfo(state);
    return state;
  },

  isOver: (state) => state.over,
  score: (state) => state.score,
  tickMs: () => 16,
};
