/**
 * Schach – vollständige Regeln für zwei Sitze (Sitz 0 = Weiß).
 *
 * Die eigentliche Rechenarbeit (Zuggenerator, Suche) liegt in
 * `schach-engine.ts`. Hier steht nur, was die Partie als JSON ausmacht:
 * Stellung als 64-Zeichen-Text, Wiederholungsschlüssel, Remisangebot, Verlauf.
 */

import {
  type BotLevel,
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  intIn,
  isRecord,
  pushLog,
} from '../turn.js';
import { type RngState } from '../rng.js';
import {
  BLACK,
  BISHOP,
  CASTLE_BK,
  CASTLE_BQ,
  CASTLE_WK,
  CASTLE_WQ,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  ROOK,
  chooseMove,
  evaluate,
  moveFlag,
  moveFrom,
  movePromo,
  moveTo,
  FLAG_EP,
  pieceToChar,
  toSan,
} from './schach-engine.js';

export type SchachPromotion = 'q' | 'r' | 'b' | 'n';

export type SchachMove =
  | { type: 'zug'; from: number; to: number; promotion?: SchachPromotion }
  | { type: 'aufgeben' }
  | { type: 'remis-anbieten' }
  | { type: 'remis-annehmen' };

export interface SchachState {
  version: 1;
  /** 64 Zeichen a1 … h8, FEN-Buchstaben, `.` = leer. */
  board: string;
  side: 0 | 1;
  castling: number;
  ep: number;
  halfmove: number;
  fullmove: number;
  /** Stellungsschlüssel seit dem letzten unumkehrbaren Zug (für die dreifache Wiederholung). */
  keys: string[];
  lastMove: [number, number] | null;
  /** Geschlagene Figuren: [von Weiß geschlagen, von Schwarz geschlagen] als FEN-Buchstaben. */
  captured: [string, string];
  /** Alle Züge in Kurznotation. */
  san: string[];
  /** Sitz, der Remis angeboten hat. */
  drawOffer: number | null;
  result: TurnOutcome | null;
  log: TurnLogEntry[];
}

export interface SchachView {
  board: string;
  side: 0 | 1;
  lastMove: [number, number] | null;
  /** Feld des Königs, der im Schach steht, sonst -1. */
  checkSquare: number;
  /** Legale Züge der Seite am Zug als [von, nach]; Umwandlungen einmal je Ziel. */
  legal: [number, number][];
  captured: [string, string];
  san: string[];
  drawOffer: number | null;
  result: TurnOutcome | null;
}

type Options = Record<string, never>;

const START = 'RNBQKBNRPPPPPPPP' + '.'.repeat(32) + 'pppppppprnbqkbnr';
const COLOR_NAME = ['Weiß', 'Schwarz'];
const PROMO_CODE: Record<SchachPromotion, number> = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT };

function toPosition(s: SchachState): Position {
  return Position.fromBoard(s.board, s.side, s.castling, s.ep, s.halfmove, s.fullmove);
}

function done(s: SchachState, winners: number[], summary: string): void {
  s.result = { winners, summary };
  s.drawOffer = null;
  s.log = pushLog(s.log, { seat: null, text: summary });
}

function applyChessMove(state: SchachState, seat: number, raw: SchachMove & { type: 'zug' }) {
  const pos = toPosition(state);
  const legal = pos.legal();
  const candidates = legal.filter((m) => moveFrom(m) === raw.from && moveTo(m) === raw.to);
  if (candidates.length === 0)
    return { ok: false as const, error: 'Dieser Zug ist nicht erlaubt.' };
  let move = candidates[0]!;
  if (candidates.length > 1) {
    if (!raw.promotion) {
      return { ok: false as const, error: 'Bitte eine Figur für die Umwandlung wählen.' };
    }
    const want = PROMO_CODE[raw.promotion];
    const found = candidates.find((m) => movePromo(m) === want);
    if (found === undefined)
      return { ok: false as const, error: 'Diese Umwandlung ist nicht möglich.' };
    move = found;
  }
  const san = toSan(pos, move, legal);
  const capturedPiece = moveFlag(move) === FLAG_EP ? PAWN | (seat ? 0 : BLACK) : pos.b[raw.to]!;
  const moverNumber = pos.full;
  pos.make(move);

  const next: SchachState = {
    ...state,
    board: pos.boardString(),
    side: pos.side,
    castling: pos.castle,
    ep: pos.ep,
    halfmove: pos.half,
    fullmove: pos.full,
    lastMove: [raw.from, raw.to],
    captured: [...state.captured],
    san: [...state.san, san],
    // Ein Zug des Gegners lehnt dessen offenes Angebot stillschweigend ab.
    drawOffer: state.drawOffer === seat ? seat : null,
  };
  if (capturedPiece) {
    next.captured[seat] = (next.captured[seat] ?? '') + pieceToChar(capturedPiece);
  }
  const key = pos.key();
  next.keys = pos.half === 0 ? [key] : [...state.keys, key];
  next.log = pushLog(state.log, {
    seat,
    text: seat === 0 ? `${moverNumber}. ${san}` : `${moverNumber}… ${san}`,
  });

  const replies = pos.legal();
  if (replies.length === 0) {
    if (pos.inCheck()) done(next, [seat], `Schachmatt – ${COLOR_NAME[seat]} gewinnt.`);
    else done(next, [], 'Patt – Remis.');
  } else if (pos.insufficientMaterial()) {
    done(next, [], 'Ungenügendes Material – Remis.');
  } else if (next.keys.filter((k) => k === key).length >= 3) {
    done(next, [], 'Dreifache Stellungswiederholung – Remis.');
  } else if (pos.half >= 100) {
    done(next, [], '50-Züge-Regel – Remis.');
  }
  return { ok: true as const, state: next };
}

export const game: TurnGame<SchachState, SchachMove, Options, SchachView> = {
  kind: 'turn',
  id: 'schach',
  version: 1,
  minPlayers: 2,
  maxPlayers: 2,
  defaultOptions: {},
  parseOptions: (raw) => (raw === undefined || raw === null || isRecord(raw) ? {} : null),
  hiddenInformation: false,

  setup() {
    const pos = Position.fromBoard(START, 0, 15, -1, 0, 1);
    return {
      version: 1,
      board: START,
      side: 0,
      castling: CASTLE_WK | CASTLE_WQ | CASTLE_BK | CASTLE_BQ,
      ep: -1,
      halfmove: 0,
      fullmove: 1,
      keys: [pos.key()],
      lastMove: null,
      captured: ['', ''],
      san: [],
      drawOffer: null,
      result: null,
      log: [],
    };
  },

  activeSeats: (s) => (s.result ? [] : [s.side]),

  parseMove(raw) {
    if (!isRecord(raw)) return null;
    if (raw.type === 'aufgeben' || raw.type === 'remis-anbieten' || raw.type === 'remis-annehmen') {
      return { type: raw.type };
    }
    if (raw.type !== 'zug') return null;
    const from = intIn(raw.from, 0, 63);
    const to = intIn(raw.to, 0, 63);
    if (from === null || to === null || from === to) return null;
    if (raw.promotion === undefined) return { type: 'zug', from, to };
    if (
      raw.promotion === 'q' ||
      raw.promotion === 'r' ||
      raw.promotion === 'b' ||
      raw.promotion === 'n'
    ) {
      return { type: 'zug', from, to, promotion: raw.promotion };
    }
    return null;
  },

  applyMove(state, seat, move): MoveResult<SchachState> {
    if (state.result) return { ok: false, error: 'Die Partie ist bereits vorbei.' };
    if (seat !== state.side) return { ok: false, error: 'Du bist gerade nicht am Zug.' };
    const other = 1 - seat;
    switch (move.type) {
      case 'zug':
        return applyChessMove(state, seat, move);
      case 'aufgeben': {
        const next: SchachState = { ...state };
        done(next, [other], `${COLOR_NAME[seat]} gibt auf – ${COLOR_NAME[other]} gewinnt.`);
        return { ok: true, state: next };
      }
      case 'remis-anbieten': {
        if (state.drawOffer !== null)
          return { ok: false, error: 'Es liegt bereits ein Remisangebot vor.' };
        return {
          ok: true,
          state: {
            ...state,
            drawOffer: seat,
            log: pushLog(state.log, { seat, text: `${COLOR_NAME[seat]} bietet Remis an.` }),
          },
        };
      }
      case 'remis-annehmen': {
        if (state.drawOffer !== other)
          return { ok: false, error: 'Es liegt kein Remisangebot vor.' };
        const next: SchachState = { ...state };
        done(next, [], 'Remis durch Einigung.');
        return { ok: true, state: next };
      }
      default:
        return { ok: false, error: 'Unbekannter Zug.' };
    }
  },

  outcome: (s) => s.result,

  view(s) {
    const pos = toPosition(s);
    const legal: [number, number][] = [];
    if (!s.result) {
      const seen = new Set<number>();
      for (const m of pos.legal()) {
        const k = moveFrom(m) * 64 + moveTo(m);
        if (seen.has(k)) continue;
        seen.add(k);
        legal.push([moveFrom(m), moveTo(m)]);
      }
    }
    return {
      board: s.board,
      side: s.side,
      lastMove: s.lastMove,
      checkSquare: pos.inCheck() ? pos.king[pos.side] : -1,
      legal,
      captured: s.captured,
      san: s.san,
      drawOffer: s.drawOffer,
      result: s.result,
    };
  },

  log: (s) => s.log.slice(-50),

  bot(state: SchachState, seat: number, level: BotLevel, rng: RngState): SchachMove {
    const pos = toPosition(state);
    // Ein Angebot nimmt der Computer nur an, wenn er selbst schlechter steht.
    if (state.drawOffer === 1 - seat && evaluate(pos) < -150) return { type: 'remis-annehmen' };
    const { move } = chooseMove(pos, level, rng);
    const promo = movePromo(move);
    const result: SchachMove = { type: 'zug', from: moveFrom(move), to: moveTo(move) };
    if (promo) {
      result.promotion =
        promo === QUEEN ? 'q' : promo === ROOK ? 'r' : promo === BISHOP ? 'b' : 'n';
    }
    return result;
  },
};
