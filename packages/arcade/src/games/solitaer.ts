/**
 * Solitär (Klondike) für eine Person.
 *
 * Karten sind Zahlen 0…51: Farbe = ⌊k / 13⌋ (0 Pik, 1 Herz, 2 Karo, 3 Kreuz),
 * Wert = k mod 13 + 1 (1 Ass … 13 König). So bleibt der Zustand kleines JSON.
 *
 * Wertung angelehnt an die bekannte Standard-Wertung: Ablage +10, vom
 * Talon ins Tableau +5, Aufdecken +5, von der Ablage zurück −15, Talon
 * erneut durchgehen kostet. Statt eines Zeitbonus gibt es beim Sieg einen
 * Bonus für wenige Züge – Zeit kann das Backend nicht nachrechnen, Züge schon.
 *
 * Es gibt nur einen Sitz und keine Mitspieler; verdeckte Karten sind trotzdem
 * nicht in der Sicht, damit niemand im Netzwerk-Tab nachschauen kann.
 */

import { shuffled, createRng } from '../rng.js';
import { type TurnGame, type TurnLogEntry, cloneState, intIn, isRecord, pushLog } from '../turn.js';

export type SolitaerPile =
  'w' | 'f0' | 'f1' | 'f2' | 'f3' | 't0' | 't1' | 't2' | 't3' | 't4' | 't5' | 't6';

const PILES: readonly SolitaerPile[] = [
  'w',
  'f0',
  'f1',
  'f2',
  'f3',
  't0',
  't1',
  't2',
  't3',
  't4',
  't5',
  't6',
];

export type SolitaerMove =
  | { type: 'ziehen' }
  | { type: 'verschieben'; from: SolitaerPile; to: SolitaerPile; count: number }
  | { type: 'vervollstaendigen' }
  | { type: 'aufgeben' };

export interface SolitaerOptions {
  /** Karten je Ziehen vom Stapel. */
  draw: 1 | 3;
}

interface Column {
  down: number[];
  up: number[];
}

export interface SolitaerState {
  draw: 1 | 3;
  stock: number[];
  waste: number[];
  foundations: number[][];
  tableau: Column[];
  score: number;
  moves: number;
  recycles: number;
  over: boolean;
  won: boolean;
  bonus: number;
  last: { from: SolitaerPile | 'stock'; to: SolitaerPile | 'stock' } | null;
  log: TurnLogEntry[];
}

export interface SolitaerView {
  draw: 1 | 3;
  stockCount: number;
  /** Die obersten (bis zu drei) Karten des Talons, die oberste zuletzt. */
  wasteTop: number[];
  wasteCount: number;
  foundations: number[][];
  tableau: { down: number; up: number[] }[];
  score: number;
  moves: number;
  over: boolean;
  won: boolean;
  bonus: number;
  canAutoComplete: boolean;
  last: SolitaerState['last'];
}

/** Obergrenze an Zügen – eine Partie muss auch ohne „Aufgeben" enden. */
const MAX_MOVES = 2000;
const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;
const RANK_NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K'] as const;

export const suitOf = (card: number): number => Math.floor(card / 13);
export const rankOf = (card: number): number => (card % 13) + 1;
export const isRed = (card: number): boolean => suitOf(card) === 1 || suitOf(card) === 2;

export function cardName(card: number): string {
  return `${SUIT_SYMBOLS[suitOf(card)] ?? '?'}${RANK_NAMES[rankOf(card) - 1] ?? '?'}`;
}

function pileName(pile: SolitaerPile): string {
  if (pile === 'w') return 'dem Talon';
  if (pile.startsWith('f')) return `Ablage ${Number(pile.slice(1)) + 1}`;
  return `Reihe ${Number(pile.slice(1)) + 1}`;
}

function canOnFoundation(card: number, foundation: readonly number[]): boolean {
  const top = foundation[foundation.length - 1];
  if (top === undefined) return rankOf(card) === 1;
  return suitOf(top) === suitOf(card) && rankOf(card) === rankOf(top) + 1;
}

function canOnTableau(card: number, column: Column): boolean {
  const top = column.up[column.up.length - 1];
  if (top === undefined) return column.down.length === 0 && rankOf(card) === 13;
  return isRed(top) !== isRed(card) && rankOf(top) === rankOf(card) + 1;
}

function column(state: SolitaerState, pile: SolitaerPile): Column | null {
  if (!pile.startsWith('t')) return null;
  return state.tableau[Number(pile.slice(1))] ?? null;
}

function foundation(state: SolitaerState, pile: SolitaerPile): number[] | null {
  if (!pile.startsWith('f')) return null;
  return state.foundations[Number(pile.slice(1))] ?? null;
}

function canAutoComplete(state: SolitaerState): boolean {
  return (
    !state.over &&
    state.stock.length === 0 &&
    state.waste.length === 0 &&
    state.tableau.every((c) => c.down.length === 0)
  );
}

function addScore(state: SolitaerState, delta: number): void {
  state.score = Math.max(0, state.score + delta);
}

function checkWin(state: SolitaerState): void {
  if (state.foundations.every((f) => f.length === 13)) {
    state.over = true;
    state.won = true;
    state.bonus = Math.max(0, 2000 - state.moves * 10);
    state.score += state.bonus;
    state.log = pushLog(state.log, {
      seat: null,
      text: `Alle Karten liegen auf der Ablage – gelöst in ${state.moves} Zügen (+${state.bonus} Bonus).`,
    });
  }
}

function afterMove(state: SolitaerState): void {
  state.moves += 1;
  checkWin(state);
  if (!state.over && state.moves >= MAX_MOVES) {
    state.over = true;
    state.log = pushLog(state.log, { seat: null, text: 'Zuglimit erreicht – die Partie endet.' });
  }
}

type Result = { ok: true; state: SolitaerState } | { ok: false; error: string };

function applyDraw(state: SolitaerState): Result {
  const next = cloneState(state);
  if (next.stock.length > 0) {
    const n = Math.min(next.draw, next.stock.length);
    for (let i = 0; i < n; i += 1) next.waste.push(next.stock.pop() as number);
    next.last = { from: 'stock', to: 'w' };
    afterMove(next);
    return { ok: true, state: next };
  }
  if (next.waste.length === 0) return { ok: false, error: 'Stapel und Talon sind leer.' };
  next.stock = [...next.waste].reverse();
  next.waste = [];
  next.recycles += 1;
  // Wer den Talon immer wieder durchblättert, soll dafür zahlen – bei „Drei ziehen" erst ab dem vierten Mal.
  if (next.draw === 1) addScore(next, -100);
  else if (next.recycles > 3) addScore(next, -20);
  next.last = { from: 'w', to: 'stock' };
  next.log = pushLog(next.log, { seat: 0, text: 'Talon wieder umgedreht.' });
  afterMove(next);
  return { ok: true, state: next };
}

function applyShift(
  state: SolitaerState,
  from: SolitaerPile,
  to: SolitaerPile,
  count: number,
): Result {
  if (from === to) return { ok: false, error: 'Quelle und Ziel sind gleich.' };
  if (to === 'w') return { ok: false, error: 'Auf den Talon kann man nichts legen.' };
  // Erst am unveränderten Zustand prüfen, dann kopieren – ungültige Versuche (Hervorhebung, Doppeltipp) kosten so nichts.
  let cards: number[];
  if (from === 'w') {
    if (count !== 1) return { ok: false, error: 'Vom Talon geht nur die oberste Karte.' };
    const top = state.waste[state.waste.length - 1];
    if (top === undefined) return { ok: false, error: 'Der Talon ist leer.' };
    cards = [top];
  } else if (from.startsWith('f')) {
    if (count !== 1) return { ok: false, error: 'Von der Ablage geht nur eine Karte.' };
    const f = foundation(state, from) as number[];
    const top = f[f.length - 1];
    if (top === undefined) return { ok: false, error: 'Diese Ablage ist leer.' };
    cards = [top];
  } else {
    const c = column(state, from) as Column;
    if (count < 1 || count > c.up.length)
      return { ok: false, error: 'So viele offene Karten liegen dort nicht.' };
    cards = c.up.slice(c.up.length - count);
  }
  const lead = cards[0] as number;

  if (to.startsWith('f')) {
    if (cards.length !== 1)
      return { ok: false, error: 'Auf die Ablage geht immer nur eine Karte.' };
    if (from.startsWith('f'))
      return { ok: false, error: 'Zwischen den Ablagen wird nicht umgelegt.' };
    const f = foundation(state, to) as number[];
    if (!canOnFoundation(lead, f)) {
      return { ok: false, error: `${cardName(lead)} passt nicht auf diese Ablage.` };
    }
  } else {
    const c = column(state, to) as Column;
    if (!canOnTableau(lead, c)) {
      return {
        ok: false,
        error:
          c.up.length === 0 && c.down.length === 0
            ? 'Auf eine leere Reihe darf nur ein König.'
            : `${cardName(lead)} passt dort nicht hin.`,
      };
    }
  }

  const next = cloneState(state);
  // Abheben
  if (from === 'w') next.waste.pop();
  else if (from.startsWith('f')) (foundation(next, from) as number[]).pop();
  else (column(next, from) as Column).up.splice(-count, count);

  // Ablegen
  if (to.startsWith('f')) (foundation(next, to) as number[]).push(lead);
  else (column(next, to) as Column).up.push(...cards);

  // Wertung
  if (to.startsWith('f')) addScore(next, 10);
  else if (from === 'w') addScore(next, 5);
  else if (from.startsWith('f')) addScore(next, -15);

  const text =
    cards.length > 1
      ? `${cards.length} Karten ab ${cardName(lead)} von ${pileName(from)} nach ${pileName(to)}.`
      : `${cardName(lead)} von ${pileName(from)} nach ${pileName(to)}.`;
  next.log = pushLog(next.log, { seat: 0, text });

  const src = column(next, from);
  if (src && src.up.length === 0 && src.down.length > 0) {
    src.up.push(src.down.pop() as number);
    addScore(next, 5);
  }
  next.last = { from, to };
  afterMove(next);
  return { ok: true, state: next };
}

function applyAutoComplete(state: SolitaerState): Result {
  if (!canAutoComplete(state)) {
    return {
      ok: false,
      error: 'Automatisch fertig spielen geht erst, wenn alle Karten offen liegen.',
    };
  }
  const next = cloneState(state);
  // Alle Reihen sind gültige absteigende Folgen, also liegt die kleinste Karte immer oben – das geht immer auf.
  let guard = 0;
  while (!next.foundations.every((f) => f.length === 13) && guard < 60) {
    guard += 1;
    for (const c of next.tableau) {
      const top = c.up[c.up.length - 1];
      if (top === undefined) continue;
      const f = next.foundations.find((fd) => canOnFoundation(top, fd));
      if (f) {
        c.up.pop();
        f.push(top);
        addScore(next, 10);
      }
    }
  }
  next.log = pushLog(next.log, { seat: 0, text: 'Die restlichen Karten wandern auf die Ablage.' });
  next.last = null;
  afterMove(next);
  return { ok: true, state: next };
}

export function parseSolitaerMove(raw: unknown): SolitaerMove | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'ziehen') return { type: 'ziehen' };
  if (raw.type === 'vervollstaendigen') return { type: 'vervollstaendigen' };
  if (raw.type === 'aufgeben') return { type: 'aufgeben' };
  if (raw.type === 'verschieben') {
    const from = PILES.find((p) => p === raw.from);
    const to = PILES.find((p) => p === raw.to);
    const count = intIn(raw.count, 1, 13);
    if (!from || !to || count === null) return null;
    return { type: 'verschieben', from, to, count };
  }
  return null;
}

export const game: TurnGame<SolitaerState, SolitaerMove, SolitaerOptions, SolitaerView> = {
  kind: 'turn',
  id: 'solitaer',
  version: 1,
  minPlayers: 1,
  maxPlayers: 1,
  defaultOptions: { draw: 1 },
  parseOptions(raw) {
    if (raw === undefined || raw === null) return { draw: 1 };
    if (!isRecord(raw)) return null;
    if (raw.draw === undefined) return { draw: 1 };
    if (raw.draw === 1 || raw.draw === 3) return { draw: raw.draw };
    return null;
  },
  hiddenInformation: false,
  setup({ seed, options }) {
    const rng = createRng(seed);
    const deck = shuffled(
      rng,
      Array.from({ length: 52 }, (_, i) => i),
    );
    const tableau: Column[] = [];
    for (let i = 0; i < 7; i += 1) {
      const down = deck.splice(0, i);
      const up = deck.splice(0, 1);
      tableau.push({ down, up });
    }
    return {
      draw: options.draw,
      stock: deck,
      waste: [],
      foundations: [[], [], [], []],
      tableau,
      score: 0,
      moves: 0,
      recycles: 0,
      over: false,
      won: false,
      bonus: 0,
      last: null,
      log: [
        {
          seat: null,
          text:
            options.draw === 3
              ? 'Neue Partie – es werden je drei Karten gezogen.'
              : 'Neue Partie – es wird je eine Karte gezogen.',
        },
      ],
    };
  },
  activeSeats: (state) => (state.over ? [] : [0]),
  parseMove: parseSolitaerMove,
  applyMove(state, seat, move) {
    if (state.over) return { ok: false, error: 'Die Partie ist vorbei.' };
    if (seat !== 0) return { ok: false, error: 'Solitär spielt nur eine Person.' };
    switch (move.type) {
      case 'ziehen':
        return applyDraw(state);
      case 'verschieben':
        return applyShift(state, move.from, move.to, move.count);
      case 'vervollstaendigen':
        return applyAutoComplete(state);
      case 'aufgeben': {
        const next = cloneState(state);
        next.over = true;
        next.log = pushLog(next.log, { seat: 0, text: `Aufgegeben mit ${next.score} Punkten.` });
        return { ok: true, state: next };
      }
    }
  },
  outcome(state) {
    if (!state.over) return null;
    return {
      winners: state.won ? [0] : [],
      summary: state.won
        ? `Gelöst! ${state.score} Punkte nach ${state.moves} Zügen.`
        : `Nicht gelöst – ${state.score} Punkte.`,
      scores: [state.score],
    };
  },
  view(state) {
    return {
      draw: state.draw,
      stockCount: state.stock.length,
      wasteTop: state.waste.slice(-3),
      wasteCount: state.waste.length,
      foundations: state.foundations.map((f) => [...f]),
      tableau: state.tableau.map((c) => ({ down: c.down.length, up: [...c.up] })),
      score: state.score,
      moves: state.moves,
      over: state.over,
      won: state.won,
      bonus: state.bonus,
      canAutoComplete: canAutoComplete(state),
      last: state.last,
    };
  },
  log: (state) => state.log.slice(-50),
};
