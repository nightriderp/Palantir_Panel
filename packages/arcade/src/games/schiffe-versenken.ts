/**
 * Schiffe versenken auf 10×10.
 *
 * Aufbau gleichzeitig: Beide Sitze sind aktiv, bis jeder seine Flotte gesetzt
 * hat – per Hand (`flotte`) oder zufällig (`zufall`). Danach wird abwechselnd
 * geschossen. Die gegnerische Flotte bleibt verdeckt; `view` zeigt von ihr nur
 * Treffer, Wasser und versenkte Schiffe.
 *
 * Zwei Flotten:
 *   - `standard`: 5, 4, 3, 3, 2 – Schiffe dürfen sich berühren.
 *   - `klassisch`: 5, 4, 4, 3, 3, 3, 2, 2, 2, 2 – kein Schiff berührt ein anderes,
 *     auch nicht über Eck.
 */

import { type RngState, nextInt, nextRandom } from '../rng.js';
import {
  type BotLevel,
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  isRecord,
  intIn,
  pushLog,
} from '../turn.js';

export const SIZE = 10;

export const FLEETS = {
  standard: [5, 4, 3, 3, 2],
  klassisch: [5, 4, 4, 3, 3, 3, 2, 2, 2, 2],
} as const;

export type FleetKind = keyof typeof FLEETS;

export interface SchiffeOptions {
  flotte: FleetKind;
  /** Nach einem Treffer darf man noch einmal schießen. */
  nochmal: boolean;
}

export interface Ship {
  x: number;
  y: number;
  len: number;
  /** Waagrecht (nach rechts) oder senkrecht (nach unten). */
  horizontal: boolean;
}

export type SchiffeMove =
  { type: 'flotte'; ships: Ship[] } | { type: 'zufall' } | { type: 'schuss'; x: number; y: number };

/** Ergebnis eines Schusses auf ein Feld: 0 unbeschossen, 1 Wasser, 2 Treffer, 3 versenkt. */
export type ShotMark = 0 | 1 | 2 | 3;

export interface SchiffeState {
  version: 1;
  options: SchiffeOptions;
  /** `null`, solange der Sitz seine Flotte noch nicht gesetzt hat. */
  fleets: (Ship[] | null)[];
  /** Schüsse **auf** das Raster des Sitzes, Index y*10+x. */
  shots: ShotMark[][];
  turn: number;
  rng: RngState;
  lastShot: { seat: number; x: number; y: number; mark: ShotMark } | null;
  result: { winners: number[]; summary: string } | null;
  log: TurnLogEntry[];
}

export interface SchiffeView {
  phase: 'aufbau' | 'schiessen' | 'ende';
  fleetKind: FleetKind;
  fleetLengths: number[];
  nochmal: boolean;
  /** Eigene Flotte (Zuschauer: leer; nach Partieende beide sichtbar über `revealed`). */
  myFleet: Ship[] | null;
  /** Schüsse des Gegners auf mein Raster. */
  myGrid: ShotMark[];
  /** Meine Schüsse auf das gegnerische Raster. */
  enemyGrid: ShotMark[];
  /** Versenkte gegnerische Schiffe (vollständig bekannt). */
  enemySunk: Ship[];
  /** Eigene versenkte Schiffe. */
  mySunk: Ship[];
  /** Hat der jeweilige Sitz seine Flotte gesetzt? */
  ready: boolean[];
  turn: number;
  lastShot: { seat: number; x: number; y: number; mark: ShotMark } | null;
  /** Beide Flotten nach Partieende; sonst `null`. */
  revealed: (Ship[] | null)[] | null;
  /** Aus Zuschauersicht: Sitz, dessen Raster `myGrid` zeigt. */
  perspective: number;
}

const COLOR_NAMES = ['Rot', 'Blau'];
const COLS = 'ABCDEFGHIJ';

export function cellName(x: number, y: number): string {
  return `${COLS[x] ?? '?'}${y + 1}`;
}

export function shipCells(ship: Ship): number[] {
  const cells: number[] = [];
  for (let i = 0; i < ship.len; i += 1) {
    const x = ship.horizontal ? ship.x + i : ship.x;
    const y = ship.horizontal ? ship.y : ship.y + i;
    cells.push(y * SIZE + x);
  }
  return cells;
}

function inBounds(ship: Ship): boolean {
  if (ship.x < 0 || ship.y < 0) return false;
  return ship.horizontal
    ? ship.x + ship.len <= SIZE && ship.y < SIZE
    : ship.y + ship.len <= SIZE && ship.x < SIZE;
}

/** Rand, Überlappung und – in der klassischen Flotte – Berührung prüfen. */
function geometryError(ships: readonly Ship[], noTouch: boolean): string | null {
  const grid = new Array<number>(SIZE * SIZE).fill(-1);
  for (let i = 0; i < ships.length; i += 1) {
    const ship = ships[i]!;
    if (!inBounds(ship)) return 'Ein Schiff ragt über den Rand.';
    for (const c of shipCells(ship)) {
      if (grid[c] !== -1) return 'Schiffe dürfen sich nicht überlappen.';
      grid[c] = i;
    }
  }
  if (!noTouch) return null;
  for (let i = 0; i < ships.length; i += 1) {
    for (const c of shipCells(ships[i]!)) {
      const cx = c % SIZE;
      const cy = Math.floor(c / SIZE);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
          const o = grid[ny * SIZE + nx];
          if (o !== -1 && o !== i)
            return 'In der klassischen Flotte dürfen sich Schiffe nicht berühren.';
        }
      }
    }
  }
  return null;
}

/** Prüft eine Flotte; liefert die deutsche Fehlermeldung oder `null`. */
export function fleetError(ships: readonly Ship[], kind: FleetKind): string | null {
  const want = [...FLEETS[kind]].sort((a, b) => b - a);
  const got = ships.map((s) => s.len).sort((a, b) => b - a);
  if (want.length !== got.length || want.some((l, i) => l !== got[i]))
    return 'Die Flotte passt nicht zur Vorgabe.';
  return geometryError(ships, kind === 'klassisch');
}

/** Zufällige gültige Flotte – deterministisch über `rng`. */
export function randomFleet(rng: RngState, kind: FleetKind): Ship[] {
  const lengths = [...FLEETS[kind]].sort((a, b) => b - a);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const ships: Ship[] = [];
    let failed = false;
    for (const len of lengths) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t += 1) {
        const horizontal = nextRandom(rng) < 0.5;
        const ship: Ship = {
          x: nextInt(rng, horizontal ? SIZE - len + 1 : SIZE),
          y: nextInt(rng, horizontal ? SIZE : SIZE - len + 1),
          len,
          horizontal,
        };
        if (geometryError([...ships, ship], kind === 'klassisch') === null) {
          ships.push(ship);
          placed = true;
        }
      }
      if (!placed) {
        failed = true;
        break;
      }
    }
    if (!failed) return ships;
  }
  throw new Error('schiffe-versenken: keine Flotte gefunden.');
}

function shipAt(fleet: readonly Ship[], cell: number): Ship | null {
  for (const s of fleet) if (shipCells(s).includes(cell)) return s;
  return null;
}

function isSunk(ship: Ship, shots: readonly ShotMark[]): boolean {
  return shipCells(ship).every((c) => (shots[c] ?? 0) >= 2);
}

function phaseOf(state: SchiffeState): SchiffeView['phase'] {
  if (state.result) return 'ende';
  return state.fleets.every((f) => f !== null) ? 'schiessen' : 'aufbau';
}

function parseOptions(raw: unknown): SchiffeOptions | null {
  if (raw === undefined || raw === null) return { flotte: 'standard', nochmal: false };
  if (!isRecord(raw)) return null;
  const flotte = raw['flotte'] === undefined ? 'standard' : raw['flotte'];
  const nochmal = raw['nochmal'] === undefined ? false : raw['nochmal'];
  if (flotte !== 'standard' && flotte !== 'klassisch') return null;
  if (typeof nochmal !== 'boolean') return null;
  return { flotte, nochmal };
}

function parseMove(raw: unknown): SchiffeMove | null {
  if (!isRecord(raw)) return null;
  if (raw['type'] === 'zufall') return { type: 'zufall' };
  if (raw['type'] === 'schuss') {
    const x = intIn(raw['x'], 0, SIZE - 1);
    const y = intIn(raw['y'], 0, SIZE - 1);
    return x === null || y === null ? null : { type: 'schuss', x, y };
  }
  if (raw['type'] !== 'flotte') return null;
  const list = raw['ships'];
  if (!Array.isArray(list) || list.length < 1 || list.length > 10) return null;
  const ships: Ship[] = [];
  for (const s of list) {
    if (!isRecord(s)) return null;
    const x = intIn(s['x'], 0, SIZE - 1);
    const y = intIn(s['y'], 0, SIZE - 1);
    const len = intIn(s['len'], 2, 5);
    if (x === null || y === null || len === null || typeof s['horizontal'] !== 'boolean')
      return null;
    ships.push({ x, y, len, horizontal: s['horizontal'] });
  }
  return { type: 'flotte', ships };
}

function applyMove(state: SchiffeState, seat: number, move: SchiffeMove): MoveResult<SchiffeState> {
  if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
  const phase = phaseOf(state);
  if (move.type === 'flotte' || move.type === 'zufall') {
    if (phase !== 'aufbau' || state.fleets[seat] !== null)
      return { ok: false, error: 'Deine Flotte steht bereits.' };
    let ships: Ship[];
    let rng = state.rng;
    if (move.type === 'zufall') {
      rng = { s: state.rng.s };
      ships = randomFleet(rng, state.options.flotte);
    } else {
      const err = fleetError(move.ships, state.options.flotte);
      if (err) return { ok: false, error: err };
      ships = move.ships.map((s) => ({ ...s }));
    }
    const fleets = state.fleets.map((f, i) => (i === seat ? ships : f));
    let log = pushLog(state.log, { seat, text: 'hat die Flotte in Stellung gebracht.' });
    if (fleets.every((f) => f !== null))
      log = pushLog(log, { seat: null, text: 'Alle Flotten stehen – Rot schießt zuerst.' });
    return { ok: true, state: { ...state, fleets, rng, log } };
  }
  if (phase !== 'schiessen') return { ok: false, error: 'Erst müssen beide Flotten stehen.' };
  if (seat !== state.turn) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
  const target = 1 - seat;
  const cell = move.y * SIZE + move.x;
  const grid = state.shots[target]!;
  if (grid[cell] !== 0) return { ok: false, error: 'Auf dieses Feld hast du schon geschossen.' };
  const fleet = state.fleets[target]!;
  const shots = state.shots.map((g) => [...g]);
  const next = shots[target]!;
  const ship = shipAt(fleet, cell);
  let mark: ShotMark = 1;
  let text = `schießt auf ${cellName(move.x, move.y)} – Wasser.`;
  if (ship) {
    next[cell] = 2;
    mark = 2;
    text = `schießt auf ${cellName(move.x, move.y)} – Treffer!`;
    if (isSunk(ship, next)) {
      for (const c of shipCells(ship)) next[c] = 3;
      mark = 3;
      text = `schießt auf ${cellName(move.x, move.y)} – versenkt (${ship.len}er)!`;
    }
  } else {
    next[cell] = 1;
  }
  let log = pushLog(state.log, { seat, text });
  let result: SchiffeState['result'] = null;
  if (fleet.every((s) => isSunk(s, next))) {
    const shotsFired = next.filter((m) => m !== 0).length;
    result = {
      winners: [seat],
      summary: `${COLOR_NAMES[seat]} versenkt die ganze Flotte mit ${shotsFired} Schüssen.`,
    };
    log = pushLog(log, { seat: null, text: result.summary });
  }
  const again = mark !== 1 && state.options.nochmal;
  return {
    ok: true,
    state: {
      ...state,
      shots,
      turn: again ? seat : target,
      lastShot: { seat, x: move.x, y: move.y, mark },
      result,
      log,
    },
  };
}

// ---------------------------------------------------------------------------
// Computergegner: Suchen und Jagen
// ---------------------------------------------------------------------------

/** Längen der noch nicht versenkten Schiffe – aus öffentlich bekannten Versenkt-Meldungen. */
function remainingLengths(state: SchiffeState, target: number): number[] {
  const left = [...FLEETS[state.options.flotte]] as number[];
  const grid = state.shots[target]!;
  for (const ship of state.fleets[target] ?? []) {
    if (shipCells(ship).every((c) => grid[c] === 3)) {
      const i = left.indexOf(ship.len);
      if (i >= 0) left.splice(i, 1);
    }
  }
  return left;
}

/**
 * Wahrscheinlichkeitsdichte: Wie viele Lagen der übrigen Schiffe decken ein
 * Feld? Lagen über offenen Treffern zählen vielfach – dort liegt das Schiff,
 * das gerade gejagt wird.
 */
function density(
  grid: readonly ShotMark[],
  lengths: readonly number[],
  noTouch: boolean,
): number[] {
  const heat = new Array<number>(SIZE * SIZE).fill(0);
  const blocked = (c: number): boolean => grid[c] === 1 || grid[c] === 3;
  const nearSunk = (c: number): boolean => {
    if (!noTouch) return false;
    const cx = c % SIZE;
    const cy = Math.floor(c / SIZE);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && grid[ny * SIZE + nx] === 3) return true;
      }
    }
    return false;
  };
  for (const len of lengths) {
    for (const horizontal of [true, false]) {
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const ship: Ship = { x, y, len, horizontal };
          if (!inBounds(ship)) continue;
          const cells = shipCells(ship);
          if (cells.some((c) => blocked(c) || nearSunk(c))) continue;
          const hits = cells.filter((c) => grid[c] === 2).length;
          const weight = hits > 0 ? 1 + hits * 30 : 1;
          for (const c of cells) heat[c] = heat[c]! + weight;
        }
      }
    }
  }
  return heat;
}

function neighbors4(c: number): number[] {
  const x = c % SIZE;
  const y = Math.floor(c / SIZE);
  const out: number[] = [];
  if (x > 0) out.push(c - 1);
  if (x < SIZE - 1) out.push(c + 1);
  if (y > 0) out.push(c - SIZE);
  if (y < SIZE - 1) out.push(c + SIZE);
  return out;
}

function botShot(state: SchiffeState, seat: number, level: BotLevel, rng: RngState): number {
  const target = 1 - seat;
  const grid = state.shots[target]!;
  const open: number[] = [];
  for (let c = 0; c < SIZE * SIZE; c += 1) if (grid[c] === 0) open.push(c);
  const pickFrom = (list: number[]): number => list[nextInt(rng, list.length)] ?? open[0]!;
  const lengths = remainingLengths(state, target);
  const noTouch = state.options.flotte === 'klassisch';

  // Jagen: offene Treffer (noch nicht versenkt) haben Vorrang.
  const hits: number[] = [];
  for (let c = 0; c < SIZE * SIZE; c += 1) if (grid[c] === 2) hits.push(c);

  if (level === 'schwer') {
    const heat = density(grid, lengths, noTouch);
    let best = -1;
    let bestCells: number[] = [];
    for (const c of open) {
      // Parität: Ohne offene Treffer reicht jedes zweite Feld (kleinstes Schiff ≥ 2).
      const parity = hits.length === 0 && ((c % SIZE) + Math.floor(c / SIZE)) % 2 === 1 ? 0.97 : 1;
      const v = heat[c]! * parity;
      if (v > best) {
        best = v;
        bestCells = [c];
      } else if (v === best) bestCells.push(c);
    }
    return pickFrom(bestCells.length > 0 ? bestCells : open);
  }

  if (hits.length > 0 && (level === 'mittel' || nextInt(rng, 2) === 0)) {
    // Liegen zwei Treffer in einer Reihe, entlang dieser Linie weitersuchen.
    if (level === 'mittel' && hits.length >= 2) {
      const line: number[] = [];
      for (const h of hits) {
        for (const n of neighbors4(h)) {
          if (grid[n] !== 0) continue;
          const dir = n - h;
          const back = h - dir;
          const sameRow =
            Math.abs(dir) === 1 ? Math.floor(back / SIZE) === Math.floor(h / SIZE) : true;
          if (back >= 0 && back < SIZE * SIZE && sameRow && grid[back] === 2) line.push(n);
        }
      }
      if (line.length > 0) return pickFrom(line);
    }
    const around = [...new Set(hits.flatMap((h) => neighbors4(h)).filter((n) => grid[n] === 0))];
    if (around.length > 0) return pickFrom(around);
  }
  if (level === 'mittel') {
    const smallest = Math.min(...lengths, 2);
    const parity = open.filter((c) => ((c % SIZE) + Math.floor(c / SIZE)) % smallest === 0);
    if (parity.length > 0) return pickFrom(parity);
  }
  return pickFrom(open);
}

function bot(state: SchiffeState, seat: number, level: BotLevel, rng: RngState): SchiffeMove {
  if (state.fleets[seat] === null) {
    return { type: 'flotte', ships: randomFleet(rng, state.options.flotte) };
  }
  const c = botShot(state, seat, level, rng);
  return { type: 'schuss', x: c % SIZE, y: Math.floor(c / SIZE) };
}

// ---------------------------------------------------------------------------

function sunkShips(fleet: readonly Ship[] | null, grid: readonly ShotMark[]): Ship[] {
  if (!fleet) return [];
  return fleet.filter((s) => shipCells(s).every((c) => grid[c] === 3)).map((s) => ({ ...s }));
}

function view(state: SchiffeState, seat: number | null): SchiffeView {
  const me = seat ?? 0;
  const enemy = 1 - me;
  const finished = state.result !== null;
  return {
    phase: phaseOf(state),
    fleetKind: state.options.flotte,
    fleetLengths: [...FLEETS[state.options.flotte]],
    nochmal: state.options.nochmal,
    // Zuschauer sehen keine Flotte, bis die Partie vorbei ist.
    myFleet: seat === null ? null : (state.fleets[me]?.map((s) => ({ ...s })) ?? null),
    myGrid: [...state.shots[me]!],
    enemyGrid: [...state.shots[enemy]!],
    enemySunk: sunkShips(state.fleets[enemy] ?? null, state.shots[enemy]!),
    mySunk: sunkShips(state.fleets[me] ?? null, state.shots[me]!),
    ready: state.fleets.map((f) => f !== null),
    turn: state.turn,
    lastShot: state.lastShot,
    revealed: finished ? state.fleets.map((f) => (f ? f.map((s) => ({ ...s })) : null)) : null,
    perspective: me,
  };
}

export const game: TurnGame<SchiffeState, SchiffeMove, SchiffeOptions, SchiffeView> = {
  kind: 'turn',
  id: 'schiffe-versenken',
  version: 1,
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: { flotte: 'standard', nochmal: false },
  parseOptions,
  hiddenInformation: true,
  setup: ({ seed, options }) => ({
    version: 1,
    options: { ...options },
    fleets: [null, null],
    shots: [new Array<ShotMark>(SIZE * SIZE).fill(0), new Array<ShotMark>(SIZE * SIZE).fill(0)],
    turn: 0,
    rng: { s: seed >>> 0 },
    lastShot: null,
    result: null,
    log: [{ seat: null, text: 'Bringt eure Flotten in Stellung!' }],
  }),
  activeSeats: (state) => {
    if (state.result) return [];
    if (phaseOf(state) === 'aufbau') return [0, 1].filter((s) => state.fleets[s] === null);
    return [state.turn];
  },
  parseMove,
  applyMove,
  outcome: (state): TurnOutcome | null => {
    if (!state.result) return null;
    const scores = [0, 1].map((s) => state.shots[1 - s]!.filter((m) => m >= 2).length);
    return { winners: state.result.winners, summary: state.result.summary, scores };
  },
  view,
  log: (state) => state.log.slice(-50),
  bot,
};
