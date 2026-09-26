/**
 * Galgenmännchen für 1–6 Personen.
 *
 * Allein kommt das Wort aus der eigenen Wortliste. Zu mehreren denkt sich je
 * Runde ein Sitz ein Wort aus, die übrigen raten reihum. Nach so vielen Runden,
 * wie Personen mitspielen, war jede einmal Wortgeberin – das hält es fair.
 *
 * Wertung zu mehreren: Ein richtiger Buchstabe bringt so viele Punkte, wie er
 * im Wort vorkommt. Wer das Wort vollständig macht, bekommt 3 Punkte extra;
 * wer es vorher komplett ausspricht, zusätzlich 1 Punkt je noch verdeckten
 * Buchstaben – Mut soll sich lohnen. Bleibt das Wort nach zehn Fehlern
 * ungelöst, bekommt die Wortgeberin 10 Punkte.
 *
 * Das Wort ist verdeckte Information: Nur die Wortgeberin sieht es in ihrer
 * Sicht, alle anderen nur das Muster aus erratenen Buchstaben.
 */

import { type RngState, createRng, pick } from '../rng.js';
import {
  type TurnGame,
  type TurnLogEntry,
  cloneState,
  isRecord,
  pushLog,
  textUpTo,
} from '../turn.js';
import { GALGEN_KATEGORIEN, GALGEN_KATEGORIE_IDS } from './galgenmaennchen-woerter.js';

export const MAX_WRONG = 10;
const MIN_LETTERS = 3;
const MAX_LETTERS = 24;
const MAX_WORD_LENGTH = 30;
const MAX_HINT_LENGTH = 60;
export const GALGEN_ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜß'];

export interface GalgenOptions {
  /** Kategorie der Wortliste (nur allein), `alle` = gemischt. */
  kategorie: string;
}

export type GalgenMove =
  | { type: 'setzeWort'; wort: string; hinweis: string }
  | { type: 'buchstabe'; b: string }
  | { type: 'loesung'; wort: string };

export interface GalgenRoundResult {
  setter: number;
  word: string;
  solved: boolean;
  solver: number | null;
}

export interface GalgenState {
  mode: 'solo' | 'multi';
  players: number;
  rng: RngState;
  round: number;
  /** Wortgeber der aktuellen Runde; -1 allein. */
  setter: number;
  phase: 'wort' | 'raten';
  word: string;
  hint: string;
  category: string;
  guessed: string[];
  wrongLetters: string[];
  wrong: number;
  turn: number;
  scores: number[];
  results: GalgenRoundResult[];
  lastGuess: { seat: number; guess: string; correct: boolean } | null;
  over: boolean;
  log: TurnLogEntry[];
}

export interface GalgenView {
  mode: 'solo' | 'multi';
  players: number;
  round: number;
  rounds: number;
  setter: number;
  phase: 'wort' | 'raten';
  turn: number;
  /** Je Zeichen des Wortes: der Buchstabe, falls bekannt, sonst `null`. */
  pattern: (string | null)[];
  hint: string;
  category: string;
  guessed: string[];
  wrongLetters: string[];
  wrong: number;
  maxWrong: number;
  scores: number[];
  /** Das Wort – nur für die Wortgeberin oder nach Spielende. */
  word: string | null;
  results: GalgenRoundResult[];
  lastGuess: GalgenState['lastGuess'];
  over: boolean;
}

/** Großschreibung, die ß erhält (JavaScript macht sonst „SS" daraus). */
export function upperGerman(text: string): string {
  let out = '';
  for (const ch of text) out += ch === 'ß' ? 'ß' : ch.toUpperCase();
  return out;
}

const isLetter = (ch: string): boolean => GALGEN_ALPHABET.includes(ch);

/** Wort aus fremden Daten normieren; `null`, wenn es die Regeln verletzt. */
export function normalizeWord(raw: string): string | null {
  const collapsed = upperGerman(
    raw
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*-\s*/g, '-'),
  );
  if (collapsed.length === 0 || collapsed.length > MAX_WORD_LENGTH) return null;
  let letters = 0;
  for (const ch of collapsed) {
    if (isLetter(ch)) letters += 1;
    else if (ch !== ' ' && ch !== '-') return null;
  }
  if (letters < MIN_LETTERS || letters > MAX_LETTERS) return null;
  const first = collapsed[0] as string;
  const last = collapsed[collapsed.length - 1] as string;
  if (!isLetter(first) || !isLetter(last)) return null;
  return collapsed;
}

function isSolved(state: GalgenState): boolean {
  for (const ch of state.word) if (isLetter(ch) && !state.guessed.includes(ch)) return false;
  return true;
}

function hiddenLetterCount(state: GalgenState): number {
  let n = 0;
  for (const ch of state.word) if (isLetter(ch) && !state.guessed.includes(ch)) n += 1;
  return n;
}

function nextGuesser(state: GalgenState, from: number): number {
  for (let k = 1; k <= state.players; k += 1) {
    const seat = (from + k) % state.players;
    if (seat !== state.setter) return seat;
  }
  return from;
}

function pickWord(rng: RngState, kategorie: string): { word: string; category: string } {
  const pool = GALGEN_KATEGORIEN.filter((k) => kategorie === 'alle' || k.id === kategorie);
  const cat = pick(rng, pool.length > 0 ? pool : GALGEN_KATEGORIEN) ?? GALGEN_KATEGORIEN[0];
  const word = cat ? (pick(rng, cat.woerter) ?? 'GALGEN') : 'GALGEN';
  return { word: upperGerman(word), category: cat?.name ?? '' };
}

function beginRound(state: GalgenState): void {
  state.setter = state.round % state.players;
  state.phase = 'wort';
  state.word = '';
  state.hint = '';
  state.guessed = [];
  state.wrongLetters = [];
  state.wrong = 0;
  state.lastGuess = null;
  state.turn = state.setter;
}

/** Runde abschließen: Punkte verteilen, bei mehreren Runden die nächste beginnen. */
function endRound(state: GalgenState, solver: number | null): void {
  const solved = solver !== null;
  state.results.push({ setter: state.setter, word: state.word, solved, solver });
  if (state.mode === 'solo') {
    state.over = true;
    state.log = pushLog(state.log, {
      seat: null,
      text: solved
        ? `Geschafft – das Wort war „${state.word}".`
        : `Das Männchen hängt. Gesucht war „${state.word}".`,
    });
    return;
  }
  if (!solved) {
    state.scores[state.setter] = (state.scores[state.setter] ?? 0) + 10;
    state.log = pushLog(state.log, {
      seat: state.setter,
      text: `hat gewonnen: Niemand kam auf „${state.word}" (+10).`,
    });
  } else {
    state.log = pushLog(state.log, { seat: solver, text: `hat „${state.word}" gelöst.` });
  }
  state.round += 1;
  if (state.round >= state.players) {
    state.over = true;
    state.log = pushLog(state.log, { seat: null, text: 'Alle Runden gespielt.' });
    return;
  }
  beginRound(state);
}

export function parseGalgenMove(raw: unknown): GalgenMove | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'setzeWort') {
    const wort = textUpTo(raw.wort, 60);
    if (wort === null) return null;
    let hinweis = '';
    if (raw.hinweis !== undefined && raw.hinweis !== '') {
      const h = textUpTo(raw.hinweis, MAX_HINT_LENGTH);
      if (h === null) return null;
      hinweis = h;
    }
    return { type: 'setzeWort', wort, hinweis };
  }
  if (raw.type === 'buchstabe') {
    if (typeof raw.b !== 'string') return null;
    const b = upperGerman(raw.b);
    if (!isLetter(b)) return null;
    return { type: 'buchstabe', b };
  }
  if (raw.type === 'loesung') {
    const wort = textUpTo(raw.wort, 60);
    if (wort === null) return null;
    return { type: 'loesung', wort };
  }
  return null;
}

export const game: TurnGame<GalgenState, GalgenMove, GalgenOptions, GalgenView> = {
  kind: 'turn',
  id: 'galgenmaennchen',
  version: 1,
  minPlayers: 1,
  maxPlayers: 6,
  defaultOptions: { kategorie: 'alle' },
  parseOptions(raw) {
    if (raw === undefined || raw === null) return { kategorie: 'alle' };
    if (!isRecord(raw)) return null;
    if (raw.kategorie === undefined) return { kategorie: 'alle' };
    if (raw.kategorie === 'alle') return { kategorie: 'alle' };
    const id = GALGEN_KATEGORIE_IDS.find((k) => k === raw.kategorie);
    return id ? { kategorie: id } : null;
  },
  hiddenInformation: true,
  setup({ players, seed, options }) {
    const rng = createRng(seed);
    const state: GalgenState = {
      mode: players === 1 ? 'solo' : 'multi',
      players,
      rng,
      round: 0,
      setter: -1,
      phase: 'raten',
      word: '',
      hint: '',
      category: '',
      guessed: [],
      wrongLetters: [],
      wrong: 0,
      turn: 0,
      scores: new Array<number>(players).fill(0),
      results: [],
      lastGuess: null,
      over: false,
      log: [],
    };
    if (players === 1) {
      const { word, category } = pickWord(rng, options.kategorie);
      state.word = word;
      state.category = category;
      state.log = [
        { seat: null, text: `Neues Wort aus „${category}" – ${MAX_WRONG} Fehler sind erlaubt.` },
      ];
    } else {
      beginRound(state);
      state.log = [{ seat: state.setter, text: 'denkt sich das erste Wort aus.' }];
    }
    return state;
  },
  activeSeats(state) {
    if (state.over) return [];
    return [state.phase === 'wort' ? state.setter : state.turn];
  },
  parseMove: parseGalgenMove,
  applyMove(state, seat, move) {
    if (state.over) return { ok: false, error: 'Die Partie ist vorbei.' };
    if (move.type === 'setzeWort') {
      if (state.phase !== 'wort' || seat !== state.setter) {
        return { ok: false, error: 'Du bist gerade nicht mit dem Wort dran.' };
      }
      const word = normalizeWord(move.wort);
      if (word === null) {
        return {
          ok: false,
          error: `Das Wort braucht ${MIN_LETTERS}–${MAX_LETTERS} Buchstaben (auch ÄÖÜß, Bindestrich und Leerzeichen).`,
        };
      }
      const next = cloneState(state);
      next.word = word;
      next.hint = move.hinweis;
      next.phase = 'raten';
      next.turn = nextGuesser(next, next.setter);
      next.log = pushLog(next.log, {
        seat,
        text: `hat sich ein Wort mit ${[...word].filter(isLetter).length} Buchstaben ausgedacht.`,
      });
      return { ok: true, state: next };
    }

    if (state.phase !== 'raten' || seat !== state.turn) {
      return { ok: false, error: 'Du bist gerade nicht am Zug.' };
    }
    const next = cloneState(state);
    const multi = next.mode === 'multi';

    if (move.type === 'buchstabe') {
      if (next.guessed.includes(move.b) || next.wrongLetters.includes(move.b)) {
        return { ok: false, error: `„${move.b}" wurde schon geraten.` };
      }
      const hits = [...next.word].filter((ch) => ch === move.b).length;
      if (hits > 0) {
        next.guessed.push(move.b);
        if (multi) next.scores[seat] = (next.scores[seat] ?? 0) + hits;
        next.lastGuess = { seat, guess: move.b, correct: true };
        next.log = pushLog(next.log, {
          seat,
          text:
            hits === 1 ? `rät „${move.b}" – ein Treffer.` : `rät „${move.b}" – ${hits} Treffer.`,
        });
        if (isSolved(next)) {
          if (multi) next.scores[seat] = (next.scores[seat] ?? 0) + 3;
          endRound(next, seat);
          return { ok: true, state: next };
        }
      } else {
        next.wrongLetters.push(move.b);
        next.wrong += 1;
        next.lastGuess = { seat, guess: move.b, correct: false };
        next.log = pushLog(next.log, { seat, text: `rät „${move.b}" – leider nicht dabei.` });
      }
    } else {
      const guess = normalizeWord(move.wort);
      if (guess !== null && guess === next.word) {
        if (multi) next.scores[seat] = (next.scores[seat] ?? 0) + 3 + hiddenLetterCount(next);
        for (const ch of next.word)
          if (isLetter(ch) && !next.guessed.includes(ch)) next.guessed.push(ch);
        next.lastGuess = { seat, guess, correct: true };
        next.log = pushLog(next.log, { seat, text: `löst mit „${guess}".` });
        endRound(next, seat);
        return { ok: true, state: next };
      }
      next.wrong += 1;
      next.lastGuess = { seat, guess: guess ?? upperGerman(move.wort), correct: false };
      next.log = pushLog(next.log, { seat, text: `tippt auf „${guess ?? move.wort}" – falsch.` });
    }

    if (next.wrong >= MAX_WRONG) {
      endRound(next, null);
      return { ok: true, state: next };
    }
    if (multi) next.turn = nextGuesser(next, seat);
    return { ok: true, state: next };
  },
  outcome(state) {
    if (!state.over) return null;
    if (state.mode === 'solo') {
      const won = state.results[0]?.solved === true;
      return {
        winners: won ? [0] : [],
        summary: won
          ? `Gelöst mit ${state.wrong} ${state.wrong === 1 ? 'Fehler' : 'Fehlern'}: „${state.word}".`
          : `Verloren – gesucht war „${state.word}".`,
      };
    }
    const best = Math.max(...state.scores);
    const winners = state.scores.flatMap((s, i) => (s === best ? [i] : []));
    return {
      winners,
      summary:
        winners.length > 1 ? `Gleichstand mit ${best} Punkten.` : `Gewonnen mit ${best} Punkten.`,
      scores: [...state.scores],
    };
  },
  view(state, seat) {
    const revealAll = state.over;
    const pattern = [...state.word].map((ch) =>
      !isLetter(ch) || state.guessed.includes(ch) || revealAll ? ch : null,
    );
    const seesWord =
      state.word !== '' &&
      (revealAll || (state.mode === 'multi' && seat !== null && seat === state.setter));
    return {
      mode: state.mode,
      players: state.players,
      round: state.round,
      rounds: state.mode === 'solo' ? 1 : state.players,
      setter: state.setter,
      phase: state.phase,
      turn: state.turn,
      pattern,
      hint: state.hint,
      category: state.category,
      guessed: [...state.guessed],
      wrongLetters: [...state.wrongLetters],
      wrong: state.wrong,
      maxWrong: MAX_WRONG,
      scores: [...state.scores],
      word: seesWord ? state.word : null,
      results: state.results.map((r) => ({ ...r })),
      lastGuess: state.lastGuess,
      over: state.over,
    };
  },
  log: (state) => state.log.slice(-50),
};
