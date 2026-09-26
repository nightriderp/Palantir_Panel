/**
 * Schach-Kern: Stellung, Zuggenerator, Bewertung und Suche.
 *
 * Getrennt von `schach.ts`, weil hier auf Geschwindigkeit gerechnet wird
 * (Int8Array, Züge als Ganzzahlen, Ziehen/Zurücknehmen statt Kopieren). Der
 * JSON-Zustand der Partie wird nur an der Grenze in eine `Position` übersetzt.
 *
 * Felder: `sq = rang * 8 + linie`, a1 = 0, h8 = 63. Figuren: Weiß 1…6, Schwarz
 * mit gesetztem Bit 8.
 */

import { type RngState, nextRandom } from '../rng.js';

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const BLACK = 8;

export const FLAG_DOUBLE = 1;
export const FLAG_EP = 2;
export const FLAG_CASTLE = 3;

/** Rochaderechte als Bits: weiß kurz, weiß lang, schwarz kurz, schwarz lang. */
export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export function encodeMove(from: number, to: number, promo = 0, flag = 0): number {
  return from | (to << 6) | (promo << 12) | (flag << 15);
}
export const moveFrom = (m: number): number => m & 63;
export const moveTo = (m: number): number => (m >> 6) & 63;
export const movePromo = (m: number): number => (m >> 12) & 7;
export const moveFlag = (m: number): number => (m >> 15) & 3;

// ---------------------------------------------------------------------------
// Vorberechnete Tabellen
// ---------------------------------------------------------------------------

const DIRS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function onBoard(f: number, r: number): boolean {
  return f >= 0 && f < 8 && r >= 0 && r < 8;
}

const KNIGHT_T: number[][] = [];
const KING_T: number[][] = [];
const RAYS: number[][][] = [];
/** PAWN_FROM[farbe][sq]: Felder, von denen ein Bauer dieser Farbe `sq` angreift. */
const PAWN_FROM: number[][][] = [[], []];

for (let sq = 0; sq < 64; sq += 1) {
  const f = sq & 7;
  const r = sq >> 3;
  const kn: number[] = [];
  for (const [df, dr] of [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
  ] as const) {
    if (onBoard(f + df, r + dr)) kn.push((r + dr) * 8 + f + df);
  }
  KNIGHT_T.push(kn);
  const kg: number[] = [];
  const rays: number[][] = [];
  for (const [df, dr] of DIRS) {
    if (onBoard(f + df, r + dr)) kg.push((r + dr) * 8 + f + df);
    const ray: number[] = [];
    for (let i = 1; onBoard(f + df * i, r + dr * i); i += 1)
      ray.push((r + dr * i) * 8 + f + df * i);
    rays.push(ray);
  }
  KING_T.push(kg);
  RAYS.push(rays);
  const w: number[] = [];
  const b: number[] = [];
  for (const df of [-1, 1]) {
    if (onBoard(f + df, r - 1)) w.push((r - 1) * 8 + f + df);
    if (onBoard(f + df, r + 1)) b.push((r + 1) * 8 + f + df);
  }
  PAWN_FROM[0]?.push(w);
  PAWN_FROM[1]?.push(b);
}

/** Welche Rochaderechte bleiben, wenn von/auf diesem Feld gezogen wird. */
const CASTLE_MASK: number[] = Array.from({ length: 64 }, () => 15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;
CASTLE_MASK[7] = 15 & ~CASTLE_WK;
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[56] = 15 & ~CASTLE_BQ;
CASTLE_MASK[63] = 15 & ~CASTLE_BK;
CASTLE_MASK[60] = 15 & ~(CASTLE_BK | CASTLE_BQ);

const FEN_PIECES = 'pnbrqk';

export function pieceToChar(p: number): string {
  if (p === 0) return '.';
  const c = FEN_PIECES[(p & 7) - 1] ?? '?';
  return p & BLACK ? c : c.toUpperCase();
}

export function charToPiece(c: string): number {
  const i = FEN_PIECES.indexOf(c.toLowerCase());
  if (i < 0) return -1;
  return c === c.toLowerCase() ? (i + 1) | BLACK : i + 1;
}

export function squareName(sq: number): string {
  return 'abcdefgh'[sq & 7]! + String((sq >> 3) + 1);
}

// ---------------------------------------------------------------------------
// Stellung
// ---------------------------------------------------------------------------

export class Position {
  b = new Int8Array(64);
  side: 0 | 1 = 0;
  castle = 0;
  ep = -1;
  half = 0;
  full = 1;
  king: [number, number] = [4, 60];
  private readonly hist: number[] = [];

  static fromBoard(
    board: string,
    side: 0 | 1,
    castle: number,
    ep: number,
    half: number,
    full: number,
  ): Position {
    const pos = new Position();
    for (let sq = 0; sq < 64; sq += 1) {
      const p = charToPiece(board[sq] ?? '.');
      pos.b[sq] = p < 0 ? 0 : p;
      if (p === KING) pos.king[0] = sq;
      if (p === (KING | BLACK)) pos.king[1] = sq;
    }
    pos.side = side;
    pos.castle = castle;
    pos.ep = ep;
    pos.half = half;
    pos.full = full;
    return pos;
  }

  /** FEN lesen (nur für Tests und Aufbau); `null` bei Unfug. */
  static fromFen(fen: string): Position | null {
    const parts = fen.trim().split(/\s+/);
    const rows = (parts[0] ?? '').split('/');
    if (rows.length !== 8) return null;
    const cells: string[] = Array.from({ length: 64 }, () => '.');
    for (let i = 0; i < 8; i += 1) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of rows[i] ?? '') {
        if (/[1-8]/.test(ch)) file += Number(ch);
        else {
          if (charToPiece(ch) < 0 || file > 7) return null;
          cells[rank * 8 + file] = ch;
          file += 1;
        }
      }
      if (file !== 8) return null;
    }
    const side = parts[1] === 'b' ? 1 : 0;
    let castle = 0;
    for (const ch of parts[2] ?? '-') {
      if (ch === 'K') castle |= CASTLE_WK;
      if (ch === 'Q') castle |= CASTLE_WQ;
      if (ch === 'k') castle |= CASTLE_BK;
      if (ch === 'q') castle |= CASTLE_BQ;
    }
    const epText = parts[3] ?? '-';
    let ep = -1;
    if (/^[a-h][36]$/.test(epText))
      ep = (Number(epText[1]) - 1) * 8 + 'abcdefgh'.indexOf(epText[0]!);
    return Position.fromBoard(
      cells.join(''),
      side,
      castle,
      ep,
      Number(parts[4] ?? 0) || 0,
      Number(parts[5] ?? 1) || 1,
    );
  }

  boardString(): string {
    let s = '';
    for (let sq = 0; sq < 64; sq += 1) s += pieceToChar(this.b[sq] ?? 0);
    return s;
  }

  attacked(sq: number, by: number): boolean {
    const c = by ? BLACK : 0;
    const b = this.b;
    for (const s of PAWN_FROM[by]![sq]!) if (b[s] === (PAWN | c)) return true;
    for (const s of KNIGHT_T[sq]!) if (b[s] === (KNIGHT | c)) return true;
    for (const s of KING_T[sq]!) if (b[s] === (KING | c)) return true;
    const rays = RAYS[sq]!;
    for (let d = 0; d < 8; d += 1) {
      const straight = d < 4;
      for (const s of rays[d]!) {
        const p = b[s]!;
        if (p === 0) continue;
        if ((p & BLACK) === c) {
          const t = p & 7;
          if (t === QUEEN || t === (straight ? ROOK : BISHOP)) return true;
        }
        break;
      }
    }
    return false;
  }

  inCheck(): boolean {
    return this.attacked(this.king[this.side], this.side ^ 1);
  }

  /** Pseudolegale Züge (eigener König darf danach noch im Schach stehen). */
  pseudo(out: number[], capturesOnly: boolean): void {
    const b = this.b;
    const us = this.side ? BLACK : 0;
    const dir = this.side ? -8 : 8;
    const startRank = this.side ? 6 : 1;
    const promoRank = this.side ? 0 : 7;
    for (let sq = 0; sq < 64; sq += 1) {
      const p = b[sq]!;
      if (p === 0 || (p & BLACK) !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const to = sq + dir;
        const promo = to >> 3 === promoRank;
        if (b[to] === 0 && (!capturesOnly || promo)) {
          if (promo) {
            out.push(encodeMove(sq, to, QUEEN));
            if (!capturesOnly) {
              out.push(encodeMove(sq, to, ROOK));
              out.push(encodeMove(sq, to, BISHOP));
              out.push(encodeMove(sq, to, KNIGHT));
            }
          } else {
            out.push(encodeMove(sq, to));
            if (sq >> 3 === startRank && b[to + dir] === 0) {
              out.push(encodeMove(sq, to + dir, 0, FLAG_DOUBLE));
            }
          }
        }
        const f = sq & 7;
        for (const df of [-1, 1]) {
          if (f + df < 0 || f + df > 7) continue;
          const t2 = to + df;
          const q = b[t2]!;
          if (q !== 0 && (q & BLACK) !== us) {
            if (promo) {
              out.push(encodeMove(sq, t2, QUEEN));
              if (!capturesOnly) {
                out.push(encodeMove(sq, t2, ROOK));
                out.push(encodeMove(sq, t2, BISHOP));
                out.push(encodeMove(sq, t2, KNIGHT));
              }
            } else out.push(encodeMove(sq, t2));
          } else if (t2 === this.ep) {
            out.push(encodeMove(sq, t2, 0, FLAG_EP));
          }
        }
      } else if (t === KNIGHT || t === KING) {
        for (const to of (t === KNIGHT ? KNIGHT_T : KING_T)[sq]!) {
          const q = b[to]!;
          if (q === 0 ? !capturesOnly : (q & BLACK) !== us) out.push(encodeMove(sq, to));
        }
        if (t === KING && !capturesOnly) this.castles(sq, out);
      } else {
        const d0 = t === BISHOP ? 4 : 0;
        const d1 = t === ROOK ? 4 : 8;
        const rays = RAYS[sq]!;
        for (let d = d0; d < d1; d += 1) {
          for (const to of rays[d]!) {
            const q = b[to]!;
            if (q === 0) {
              if (!capturesOnly) out.push(encodeMove(sq, to));
              continue;
            }
            if ((q & BLACK) !== us) out.push(encodeMove(sq, to));
            break;
          }
        }
      }
    }
  }

  private castles(sq: number, out: number[]): void {
    const b = this.b;
    const them = this.side ^ 1;
    if (this.side === 0 && sq === 4) {
      if (this.castle & CASTLE_WK && b[5] === 0 && b[6] === 0 && b[7] === ROOK) {
        if (!this.attacked(4, them) && !this.attacked(5, them) && !this.attacked(6, them)) {
          out.push(encodeMove(4, 6, 0, FLAG_CASTLE));
        }
      }
      if (this.castle & CASTLE_WQ && b[3] === 0 && b[2] === 0 && b[1] === 0 && b[0] === ROOK) {
        if (!this.attacked(4, them) && !this.attacked(3, them) && !this.attacked(2, them)) {
          out.push(encodeMove(4, 2, 0, FLAG_CASTLE));
        }
      }
    } else if (this.side === 1 && sq === 60) {
      const r = ROOK | BLACK;
      if (this.castle & CASTLE_BK && b[61] === 0 && b[62] === 0 && b[63] === r) {
        if (!this.attacked(60, them) && !this.attacked(61, them) && !this.attacked(62, them)) {
          out.push(encodeMove(60, 62, 0, FLAG_CASTLE));
        }
      }
      if (this.castle & CASTLE_BQ && b[59] === 0 && b[58] === 0 && b[57] === 0 && b[56] === r) {
        if (!this.attacked(60, them) && !this.attacked(59, them) && !this.attacked(58, them)) {
          out.push(encodeMove(60, 58, 0, FLAG_CASTLE));
        }
      }
    }
  }

  /**
   * Zug ausführen. Liefert `false`, wenn der eigene König danach im Schach
   * steht – der Zug ist dann trotzdem ausgeführt und muss zurückgenommen werden.
   */
  make(m: number): boolean {
    const b = this.b;
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flag = (m >> 15) & 3;
    const piece = b[from]!;
    const cap = b[to]!;
    this.hist.push(cap | (this.castle << 4) | ((this.ep + 1) << 8) | (this.half << 15));
    b[to] = promo ? promo | (piece & BLACK) : piece;
    b[from] = 0;
    if (flag === FLAG_EP) b[to + (this.side ? 8 : -8)] = 0;
    else if (flag === FLAG_CASTLE) {
      const [rf, rt] = to === 6 ? [7, 5] : to === 2 ? [0, 3] : to === 62 ? [63, 61] : [56, 59];
      b[rt] = b[rf]!;
      b[rf] = 0;
    }
    if ((piece & 7) === KING) this.king[this.side] = to;
    this.castle &= CASTLE_MASK[from]! & CASTLE_MASK[to]!;
    this.ep = flag === FLAG_DOUBLE ? (from + to) >> 1 : -1;
    this.half = (piece & 7) === PAWN || cap !== 0 || flag === FLAG_EP ? 0 : this.half + 1;
    if (this.side === 1) this.full += 1;
    this.side = this.side === 0 ? 1 : 0;
    return !this.attacked(this.king[this.side === 0 ? 1 : 0], this.side);
  }

  unmake(m: number): void {
    const b = this.b;
    const from = m & 63;
    const to = (m >> 6) & 63;
    const promo = (m >> 12) & 7;
    const flag = (m >> 15) & 3;
    this.side = this.side === 0 ? 1 : 0;
    if (this.side === 1) this.full -= 1;
    const h = this.hist.pop() ?? 0;
    let piece = b[to]!;
    if (promo) piece = PAWN | (piece & BLACK);
    b[from] = piece;
    b[to] = h & 15;
    this.castle = (h >> 4) & 15;
    this.ep = ((h >> 8) & 127) - 1;
    this.half = h >>> 15;
    if (flag === FLAG_EP) b[to + (this.side ? 8 : -8)] = PAWN | (this.side ? 0 : BLACK);
    else if (flag === FLAG_CASTLE) {
      const [rf, rt] = to === 6 ? [7, 5] : to === 2 ? [0, 3] : to === 62 ? [63, 61] : [56, 59];
      b[rf] = b[rt]!;
      b[rt] = 0;
    }
    if ((piece & 7) === KING) this.king[this.side] = from;
  }

  legal(): number[] {
    const out: number[] = [];
    this.pseudo(out, false);
    return out.filter((m) => {
      const ok = this.make(m);
      this.unmake(m);
      return ok;
    });
  }

  /** Schlüssel für die Stellungswiederholung (en passant nur, wenn es schlagbar ist). */
  key(): string {
    let ep = -1;
    if (this.ep >= 0) {
      const pawn = PAWN | (this.side ? BLACK : 0);
      for (const s of PAWN_FROM[this.side]![this.ep]!) if (this.b[s] === pawn) ep = this.ep;
    }
    return `${this.boardString()}|${this.side}|${this.castle}|${ep}`;
  }

  /** Reicht das Material beider Seiten nicht mehr zum Matt? */
  insufficientMaterial(): boolean {
    let minors = 0;
    const bishopColors = new Set<number>();
    let knights = 0;
    for (let sq = 0; sq < 64; sq += 1) {
      const t = this.b[sq]! & 7;
      if (t === 0 || t === KING) continue;
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      minors += 1;
      if (t === KNIGHT) knights += 1;
      else bishopColors.add(((sq >> 3) + (sq & 7)) & 1);
    }
    if (minors <= 1) return true;
    // Nur Läufer, alle auf derselben Feldfarbe: Matt ist unmöglich.
    return knights === 0 && bishopColors.size === 1;
  }
}

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves: number[] = [];
  pos.pseudo(moves, false);
  let n = 0;
  for (const m of moves) {
    if (pos.make(m)) n += depth === 1 ? 1 : perft(pos, depth - 1);
    pos.unmake(m);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Kurznotation (deutsch: K D T L S)
// ---------------------------------------------------------------------------

const LETTER = ['', '', 'S', 'L', 'T', 'D', 'K'];

/** Kurznotation eines legalen Zugs in `pos` (vor dem Ziehen). */
export function toSan(pos: Position, m: number, legal: readonly number[]): string {
  const from = moveFrom(m);
  const to = moveTo(m);
  const flag = moveFlag(m);
  const promo = movePromo(m);
  const t = pos.b[from]! & 7;
  const capture = pos.b[to] !== 0 || flag === FLAG_EP;
  let s: string;
  if (flag === FLAG_CASTLE) s = (to & 7) === 6 ? 'O-O' : 'O-O-O';
  else if (t === PAWN) {
    s = capture ? `${'abcdefgh'[from & 7]}x${squareName(to)}` : squareName(to);
    if (promo) s += `=${LETTER[promo]}`;
  } else {
    const rivals = legal.filter(
      (o) => o !== m && moveTo(o) === to && (pos.b[moveFrom(o)]! & 7) === t,
    );
    let dis = '';
    if (rivals.length > 0) {
      const sameFile = rivals.some((o) => (moveFrom(o) & 7) === (from & 7));
      const sameRank = rivals.some((o) => moveFrom(o) >> 3 === from >> 3);
      if (!sameFile) dis = 'abcdefgh'[from & 7]!;
      else if (!sameRank) dis = String((from >> 3) + 1);
      else dis = squareName(from);
    }
    s = `${LETTER[t]}${dis}${capture ? 'x' : ''}${squareName(to)}`;
  }
  pos.make(m);
  if (pos.inCheck()) s += pos.legal().length === 0 ? '#' : '+';
  pos.unmake(m);
  return s;
}

// ---------------------------------------------------------------------------
// Bewertung
// ---------------------------------------------------------------------------

export const VALUE = [0, 100, 320, 330, 500, 900, 0];

/**
 * Feldtabellen, aus einfachen Regeln berechnet statt abgeschrieben: Springer
 * und Läufer wollen ins Zentrum, Bauern nach vorn, Türme auf die siebte Reihe,
 * der König im Mittelspiel in die Ecke und im Endspiel in die Mitte.
 * Index: Feld aus Sicht der eigenen Farbe (Weiß: sq, Schwarz: sq ^ 56).
 */
const PST: number[][] = [[], [], [], [], [], [], []];
const KING_END: number[] = [];

for (let sq = 0; sq < 64; sq += 1) {
  const f = sq & 7;
  const r = sq >> 3;
  const cd = (Math.abs(2 * f - 7) + Math.abs(2 * r - 7)) / 2; // 1 … 7
  const centerFile = f === 3 || f === 4;
  PST[PAWN]!.push(
    [0, 0, 4, 10, 20, 34, 60, 0][r]! +
      (centerFile && r >= 3 ? 12 : 0) +
      (centerFile && r === 1 ? -12 : 0) +
      ((f <= 2 || f >= 5) && r === 1 ? 4 : 0),
  );
  PST[KNIGHT]!.push(Math.round(28 - cd * 8) - (r === 0 ? 10 : 0));
  PST[BISHOP]!.push(Math.round(14 - cd * 4) - (r === 0 ? 6 : 0));
  PST[ROOK]!.push((r === 6 ? 18 : 0) + (centerFile && r === 0 ? 6 : 0));
  PST[QUEEN]!.push(Math.round(6 - cd * 2));
  PST[KING]!.push(
    r === 0 ? (f === 1 || f === 2 || f === 6 ? 22 : f === 0 || f === 7 ? 12 : 0) : -14 * r,
  );
  KING_END.push(Math.round(24 - cd * 8));
}

const PHASE = [0, 0, 1, 1, 2, 4, 0];

/** Bewertung aus Sicht der Seite am Zug, in Hundertstel-Bauern. */
export function evaluate(pos: Position): number {
  let mg = 0;
  let phase = 0;
  const bishops = [0, 0];
  const kingSq = [0, 0];
  const b = pos.b;
  for (let sq = 0; sq < 64; sq += 1) {
    const p = b[sq]!;
    if (p === 0) continue;
    const t = p & 7;
    const black = p & BLACK ? 1 : 0;
    const rel = black ? sq ^ 56 : sq;
    phase += PHASE[t]!;
    if (t === KING) {
      kingSq[black] = rel;
      continue;
    }
    if (t === BISHOP) bishops[black]! += 1;
    const v = VALUE[t]! + PST[t]![rel]!;
    mg += black ? -v : v;
  }
  if (bishops[0]! >= 2) mg += 30;
  if (bishops[1]! >= 2) mg -= 30;
  const ph = Math.min(phase, 24);
  const kw = (PST[KING]![kingSq[0]!]! * ph + KING_END[kingSq[0]!]! * (24 - ph)) / 24;
  const kb = (PST[KING]![kingSq[1]!]! * ph + KING_END[kingSq[1]!]! * (24 - ph)) / 24;
  const score = Math.round(mg + kw - kb);
  return pos.side ? -score : score;
}

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------

export const MATE = 100_000;
const INF = 1_000_000;

export interface SearchConfig {
  maxDepth: number;
  /** Knotenbudget – bewusst statt einer Uhr, damit der Bot deterministisch bleibt. */
  budget: number;
  quiesce: boolean;
}

function orderScore(pos: Position, m: number, best: number): number {
  if (m === best) return 1_000_000;
  const victim = pos.b[moveTo(m)]! & 7;
  const promo = movePromo(m);
  let s = 0;
  if (victim) s += 100_000 + VALUE[victim]! * 10 - VALUE[pos.b[moveFrom(m)]! & 7]!;
  else if (moveFlag(m) === FLAG_EP) s += 100_000 + 990;
  if (promo) s += 90_000 + VALUE[promo]!;
  return s;
}

/** Sortiert in-place absteigend nach MVV-LVA (Schläge zuerst). */
function orderMoves(pos: Position, moves: number[], best = -1): void {
  const scores = moves.map((m) => orderScore(pos, m, best));
  const idx = moves.map((_, i) => i).sort((a, b) => scores[b]! - scores[a]! || a - b);
  const copy = idx.map((i) => moves[i]!);
  for (let i = 0; i < copy.length; i += 1) moves[i] = copy[i]!;
}

export class Searcher {
  nodes = 0;
  aborted = false;

  constructor(
    private readonly pos: Position,
    private readonly cfg: SearchConfig,
  ) {}

  private tick(): boolean {
    this.nodes += 1;
    if (this.nodes > this.cfg.budget) this.aborted = true;
    return this.aborted;
  }

  quiesce(alpha: number, beta: number, qdepth: number): number {
    if (this.tick()) return 0;
    const stand = evaluate(this.pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (qdepth <= 0) return stand;
    const moves: number[] = [];
    this.pos.pseudo(moves, true);
    orderMoves(this.pos, moves);
    for (const m of moves) {
      const ok = this.pos.make(m);
      if (!ok) {
        this.pos.unmake(m);
        continue;
      }
      const score = -this.quiesce(-beta, -alpha, qdepth - 1);
      this.pos.unmake(m);
      if (this.aborted) return 0;
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    const inCheck = this.pos.inCheck();
    // Schachgebote verlängern, damit Mattnetze nicht am Horizont verschwinden.
    if (inCheck && ply < 10) depth += 1;
    if (depth <= 0) {
      if (this.cfg.quiesce) return this.quiesce(alpha, beta, 6);
      if (this.tick()) return 0;
      return evaluate(this.pos);
    }
    if (this.tick()) return 0;
    if (this.pos.half >= 100) return 0;
    const moves: number[] = [];
    this.pos.pseudo(moves, false);
    orderMoves(this.pos, moves);
    let legal = 0;
    let best = -INF;
    for (const m of moves) {
      const ok = this.pos.make(m);
      if (!ok) {
        this.pos.unmake(m);
        continue;
      }
      legal += 1;
      const score = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.pos.unmake(m);
      if (this.aborted) return 0;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    return best;
  }

  /**
   * Iterative Vertiefung. Bricht das Budget eine Runde ab, zählt das Ergebnis
   * der letzten vollständigen Runde – so bleibt der Zug deterministisch.
   */
  search(rootMoves: number[]): { move: number; score: number } {
    let bestMove = rootMoves[0]!;
    let bestScore = -INF;
    const order = [...rootMoves];
    for (let depth = 1; depth <= this.cfg.maxDepth; depth += 1) {
      orderMoves(this.pos, order, bestMove);
      let alpha = -INF;
      let iterBest = order[0]!;
      for (const m of order) {
        this.pos.make(m);
        const score = -this.negamax(depth - 1, -INF, -alpha, 1);
        this.pos.unmake(m);
        if (this.aborted) break;
        if (score > alpha) {
          alpha = score;
          iterBest = m;
        }
      }
      if (this.aborted) break;
      bestMove = iterBest;
      bestScore = alpha;
      if (alpha >= MATE - 100) break;
    }
    return { move: bestMove, score: bestScore };
  }
}

export type Level = 'leicht' | 'mittel' | 'schwer';

export const LEVEL_CONFIG: Record<Level, SearchConfig> = {
  leicht: { maxDepth: 1, budget: 5_000, quiesce: false },
  mittel: { maxDepth: 3, budget: 20_000, quiesce: true },
  schwer: { maxDepth: 5, budget: 50_000, quiesce: true },
};

/** Zug des Computers; `nodes` für Tests (Budgetprüfung ohne Uhr). */
export function chooseMove(
  pos: Position,
  level: Level,
  rng: RngState,
): { move: number; nodes: number } {
  const legal = pos.legal();
  if (legal.length === 0) throw new Error('Keine legalen Züge.');
  // Zufällige Vorsortierung: Gleich gute Züge wechseln so von Partie zu Partie.
  const shuffledMoves = legal
    .map((m) => ({ m, k: nextRandom(rng) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);
  const searcher = new Searcher(pos, LEVEL_CONFIG[level]);
  if (level === 'leicht') {
    // Ein Halbzug plus kräftiges Rauschen: sieht Matt in eins und hängende
    // Figuren nur manchmal – genau das macht die Stufe schlagbar.
    let best = shuffledMoves[0]!;
    let bestScore = -INF;
    for (const m of shuffledMoves) {
      pos.make(m);
      let score: number;
      if (pos.legal().length === 0) score = pos.inCheck() ? MATE : 0;
      else score = -searcher.quiesce(-INF, INF, 1) + (nextRandom(rng) * 180 - 90);
      pos.unmake(m);
      if (score > bestScore) {
        bestScore = score;
        best = m;
      }
    }
    return { move: best, nodes: searcher.nodes };
  }
  const { move } = searcher.search(shuffledMoves);
  return { move, nodes: searcher.nodes };
}
