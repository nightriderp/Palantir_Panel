import { describe, expect, it } from 'vitest';
import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  ArcadeRecorder,
  runArcadeReplay,
} from '../realtime.js';
import {
  CLEARED_TICKS,
  DYING_TICKS,
  MAZE,
  MAZE_H,
  MAZE_W,
  READY_TICKS,
  TILE,
  frightTicks,
  game,
  ghostTarget,
  type PacState,
} from './punktejaeger.js';

function idle(state: PacState, n: number): PacState {
  for (let i = 0; i < n; i += 1) game.step(state, 0);
  return state;
}

function started(seed = 1): PacState {
  return idle(game.create(seed), READY_TICKS);
}

/** Geister weit weg und eingesperrt – für Tests, die nur Pac-Man betreffen. */
function parkGhosts(state: PacState): void {
  for (const g of state.ghosts) {
    g.mode = 'house';
    g.releaseAt = 1_000_000;
    g.x = 9 * TILE + TILE / 2;
    g.y = 9 * TILE + TILE / 2;
  }
}

describe('Pac-Man', () => {
  it('hat ein geschlossenes, spiegelgleiches Labyrinth ohne Sackgassen', () => {
    expect(MAZE).toHaveLength(MAZE_H);
    for (const row of MAZE) {
      expect(row).toHaveLength(MAZE_W);
      expect([...row].reverse().join('').replace('P', ' ')).toBe(row.replace('P', ' '));
    }
    const open = (x: number, y: number) => {
      const c = MAZE[y]?.[((x % MAZE_W) + MAZE_W) % MAZE_W] ?? '#';
      return c !== '#' && c !== '-' && c !== 'G';
    };
    for (let y = 0; y < MAZE_H; y += 1) {
      for (let x = 0; x < MAZE_W; x += 1) {
        if (!open(x, y)) continue;
        const exits = [open(x + 1, y), open(x - 1, y), open(x, y + 1), open(x, y - 1)];
        expect(exits.filter(Boolean).length, `Feld ${x},${y}`).toBeGreaterThanOrEqual(2);
      }
    }
    expect(MAZE.join('').split('o')).toHaveLength(5);
  });

  it('startet mit drei Leben und wartet die Bereitschaftsphase ab', () => {
    const state = game.create(5);
    expect(state.lives).toBe(3);
    expect(state.phase).toBe('ready');
    const x = state.pac.x;
    idle(state, READY_TICKS);
    expect(state.phase).toBe('play');
    idle(state, 1);
    expect(state.pac.x).toBeLessThan(x);
  });

  it('frisst Punkte und merkt sich die Abbiegung', () => {
    const state = started();
    parkGhosts(state);
    game.step(state, ARCADE_INPUT_UP);
    // Oben ist über dem Startfeld Wand – der Wunsch bleibt stehen, bis es passt.
    expect(state.pac.want).toBe(ARCADE_INPUT_UP);
    idle(state, 60);
    expect(state.score).toBeGreaterThan(0);
    expect(state.pac.dir).toBe(ARCADE_INPUT_UP);
  });

  it('kehrt mitten im Gang sofort um', () => {
    const state = started();
    parkGhosts(state);
    idle(state, 3);
    game.step(state, ARCADE_INPUT_RIGHT);
    expect(state.pac.dir).toBe(ARCADE_INPUT_RIGHT);
  });

  it('macht Geister mit der Kraftpille fressbar und zählt doppelt', () => {
    const state = started();
    parkGhosts(state);
    // Kraftpille direkt vor Pac-Man legen.
    const tx = Math.floor(state.pac.x / TILE) - 1;
    const ty = Math.floor(state.pac.y / TILE);
    state.dots[ty * MAZE_W + tx] = 2;
    idle(state, 12);
    expect(state.frightTimer).toBeGreaterThan(0);
    expect(state.ghosts.every((g) => g.frightened)).toBe(true);
    // Zwei verängstigte Geister auf Pac-Man: beide gefressen, der zweite doppelt so viel wert.
    for (const g of state.ghosts.slice(0, 2)) {
      g.mode = 'active';
      g.x = state.pac.x;
      g.y = state.pac.y;
    }
    const before = state.score;
    game.step(state, 0);
    expect(state.powerTotal).toBe(1);
    expect(state.ghostsEaten).toBe(2);
    expect(state.score - before).toBeGreaterThanOrEqual(200 + 400);
    expect(state.pauseTimer).toBeGreaterThan(0);
    expect(state.ghosts.filter((g) => g.mode === 'eyes')).toHaveLength(2);
    expect(frightTicks(1)).toBeGreaterThan(frightTicks(5));
  });

  it('verliert ein Leben bei Berührung und endet nach dem letzten', () => {
    const state = started();
    for (let life = 3; life >= 1; life -= 1) {
      const g = state.ghosts[0]!;
      g.mode = 'active';
      g.frightened = false;
      g.x = state.pac.x;
      g.y = state.pac.y;
      game.step(state, 0);
      expect(state.phase).toBe('dying');
      idle(state, DYING_TICKS);
      expect(state.lives).toBe(life - 1);
      if (life > 1) idle(state, READY_TICKS);
    }
    expect(game.isOver(state)).toBe(true);
  });

  it('geht nach dem letzten Punkt ins nächste Level', () => {
    const state = started();
    parkGhosts(state);
    state.dots = state.dots.map(() => 0);
    const tx = Math.floor(state.pac.x / TILE) - 1;
    const ty = Math.floor(state.pac.y / TILE);
    state.dots[ty * MAZE_W + tx] = 1;
    state.dotsLeft = 1;
    idle(state, 20);
    expect(state.phase).toBe('cleared');
    idle(state, CLEARED_TICKS);
    expect(state.level).toBe(2);
    expect(state.dotsLeft).toBeGreaterThan(100);
  });

  it('gibt den Geistern unterschiedliche Ziele', () => {
    const state = started();
    state.modeIndex = 1; // Jagd
    state.pac.dir = ARCADE_INPUT_LEFT;
    const targets = [0, 1, 2, 3].map((i) => ghostTarget(state, i).join(','));
    expect(new Set(targets.slice(0, 3)).size).toBe(3);
    state.modeIndex = 0;
    expect(ghostTarget(state, 0)).not.toEqual(ghostTarget(state, 1));
  });

  it('ist deterministisch, läuft im Band nach und endet', () => {
    const dirs = [ARCADE_INPUT_LEFT, ARCADE_INPUT_UP, ARCADE_INPUT_RIGHT, ARCADE_INPUT_DOWN];
    const recorder = new ArcadeRecorder();
    const a = game.create(2024);
    const b = game.create(2024);
    let tick = 0;
    for (; tick < 60_000 && !game.isOver(a); tick += 1) {
      const input = tick % 40 === 0 ? (dirs[(tick / 40) % 4] ?? 0) : 0;
      if (input) recorder.record(tick, input);
      game.step(a, input);
      game.step(b, input);
    }
    expect(a).toEqual(b);
    expect(game.isOver(a)).toBe(true);
    const result = runArcadeReplay(game, 2024, recorder.finish(tick));
    expect(result).toEqual({ score: game.score(a), ticks: tick, finished: true });
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});
