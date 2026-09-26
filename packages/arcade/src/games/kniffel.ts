/**
 * Kniffel – fünf Würfel, drei Würfe, dreizehn Felder.
 *
 * Es gibt keine verdeckte Information: Würfel und Blätter sieht jeder. Der
 * interessante Teil ist der Computergegner. Er rechnet für jedes Halte-Muster
 * den Erwartungswert über alle verbleibenden Würfe exakt aus. Das klingt teuer,
 * ist es aber nicht: Fünf Würfel haben nur 252 unterscheidbare Ausgänge, und
 * zwischen den Würfen zählt nur, **welche** Augen man hält, nicht an welcher
 * Stelle. Ein vollständiger Zug kostet so einige tausend Rechenschritte.
 */

import { type RngState, createRng, nextInt, rollDie } from '../rng.js';
import {
  type BotLevel,
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  cloneState,
  intIn,
  isRecord,
  pushLog,
} from '../turn.js';

export const KNIFFEL_FIELDS = [
  'Einser',
  'Zweier',
  'Dreier',
  'Vierer',
  'Fünfer',
  'Sechser',
  'Dreierpasch',
  'Viererpasch',
  'Full House',
  'Kleine Straße',
  'Große Straße',
  'Kniffel',
  'Chance',
] as const;

export const FIELD_COUNT = 13;
const KNIFFEL_FIELD = 11;
const BONUS_GRENZE = 63;
const BONUS = 35;
const EXTRA_KNIFFEL = 100;

export interface KniffelOptions {
  /** Jeder weitere Kniffel nach einem eingetragenen 50er bringt 100 Punkte extra. */
  extraKniffel: boolean;
}

export type KniffelMove =
  { type: 'wuerfeln'; halten: boolean[] } | { type: 'eintragen'; feld: number };

export interface KniffelState {
  version: 1;
  players: number;
  options: KniffelOptions;
  rng: RngState;
  /** Augen 1–6; 0 = in diesem Zug noch nicht gewürfelt. */
  wuerfel: number[];
  gehalten: boolean[];
  /** Würfe in diesem Zug (0–3). */
  wuerfe: number;
  am: number;
  runde: number;
  /** Je Sitz 13 Felder, `null` = noch frei. */
  blaetter: (number | null)[][];
  /** Anzahl Extra-Kniffel je Sitz. */
  extra: number[];
  letzter: { sitz: number; feld: number; punkte: number } | null;
  zuege: number;
  fertig: boolean;
  log: TurnLogEntry[];
}

export interface KniffelTotals {
  oben: number;
  bonus: number;
  unten: number;
  extra: number;
  gesamt: number;
}

export interface KniffelView {
  players: number;
  options: KniffelOptions;
  wuerfel: number[];
  gehalten: boolean[];
  wuerfe: number;
  am: number;
  runde: number;
  blaetter: (number | null)[][];
  summen: KniffelTotals[];
  /** Punkte, die der Sitz am Zug mit den aktuellen Würfeln je Feld bekäme (`null` = belegt). */
  vorschau: (number | null)[];
  letzter: { sitz: number; feld: number; punkte: number } | null;
  zuege: number;
  fertig: boolean;
}

// ---------------------------------------------------------------------------
// Wertung
// ---------------------------------------------------------------------------

function countsOf(dice: readonly number[]): number[] {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const d of dice) if (d >= 1 && d <= 6) counts[d - 1] = (counts[d - 1] ?? 0) + 1;
  return counts;
}

function scoreCounts(counts: readonly number[], feld: number): number {
  const sum = counts.reduce((acc, c, i) => acc + c * (i + 1), 0);
  const max = Math.max(...counts);
  if (feld < 6) return (counts[feld] ?? 0) * (feld + 1);
  const run = (from: number, len: number): boolean => {
    for (let i = from; i < from + len; i += 1) if ((counts[i] ?? 0) === 0) return false;
    return true;
  };
  switch (feld) {
    case 6:
      return max >= 3 ? sum : 0;
    case 7:
      return max >= 4 ? sum : 0;
    case 8: {
      const sorted = counts.filter((c) => c > 0).sort();
      return sorted.length === 2 && sorted[0] === 2 && sorted[1] === 3 ? 25 : 0;
    }
    case 9:
      return run(0, 4) || run(1, 4) || run(2, 4) ? 30 : 0;
    case 10:
      return run(0, 5) || run(1, 5) ? 40 : 0;
    case 11:
      return max === 5 ? 50 : 0;
    default:
      return sum;
  }
}

/** Punkte der Würfel in einem Feld. */
export function scoreField(dice: readonly number[], feld: number): number {
  if (dice.some((d) => d < 1 || d > 6)) return 0;
  return scoreCounts(countsOf(dice), feld);
}

export function totals(sheet: readonly (number | null)[], extra: number): KniffelTotals {
  let oben = 0;
  let unten = 0;
  sheet.forEach((v, i) => {
    if (v === null) return;
    if (i < 6) oben += v;
    else unten += v;
  });
  const bonus = oben >= BONUS_GRENZE ? BONUS : 0;
  const extraPunkte = extra * EXTRA_KNIFFEL;
  return { oben, bonus, unten, extra: extraPunkte, gesamt: oben + bonus + unten + extraPunkte };
}

function isExtraKniffel(s: KniffelState, seat: number): boolean {
  return (
    s.options.extraKniffel &&
    s.wuerfe > 0 &&
    scoreField(s.wuerfel, KNIFFEL_FIELD) === 50 &&
    s.blaetter[seat]?.[KNIFFEL_FIELD] === 50
  );
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

function applyMove(state: KniffelState, seat: number, move: KniffelMove): MoveResult<KniffelState> {
  if (state.fertig) return { ok: false, error: 'Die Partie ist vorbei.' };
  if (seat !== state.am) return { ok: false, error: 'Du bist nicht am Zug.' };
  const s = cloneState(state);

  if (move.type === 'wuerfeln') {
    if (s.wuerfe >= 3) return { ok: false, error: 'Du hast schon dreimal gewürfelt.' };
    const halten = s.wuerfe === 0 ? [false, false, false, false, false] : move.halten;
    if (halten.every(Boolean)) return { ok: false, error: 'Mindestens ein Würfel muss rollen.' };
    s.wuerfel = s.wuerfel.map((d, i) => (halten[i] ? d : rollDie(s.rng)));
    s.gehalten = [...halten];
    s.wuerfe += 1;
    s.zuege += 1;
    s.log = pushLog(s.log, {
      seat,
      text: `würfelt ${s.wuerfel.join(' · ')}${s.wuerfe > 1 ? ` (Wurf ${s.wuerfe})` : ''}.`,
    });
    return { ok: true, state: s };
  }

  if (s.wuerfe === 0) return { ok: false, error: 'Erst würfeln, dann eintragen.' };
  const sheet = s.blaetter[seat] as (number | null)[];
  if (sheet[move.feld] !== null) return { ok: false, error: 'Dieses Feld ist schon belegt.' };
  const extra = isExtraKniffel(s, seat);
  const punkte = scoreField(s.wuerfel, move.feld);
  sheet[move.feld] = punkte;
  if (extra) {
    s.extra[seat] = (s.extra[seat] ?? 0) + 1;
    s.log = pushLog(s.log, { seat, text: `wirft einen weiteren Kniffel: +${EXTRA_KNIFFEL}!` });
  }
  s.log = pushLog(s.log, {
    seat,
    text:
      punkte > 0
        ? `trägt ${punkte} bei ${KNIFFEL_FIELDS[move.feld]} ein.`
        : `streicht ${KNIFFEL_FIELDS[move.feld]}.`,
  });
  s.letzter = { sitz: seat, feld: move.feld, punkte };
  s.zuege += 1;
  s.wuerfe = 0;
  s.wuerfel = [0, 0, 0, 0, 0];
  s.gehalten = [false, false, false, false, false];

  if (s.blaetter.every((b) => b.every((v) => v !== null))) {
    s.fertig = true;
    return { ok: true, state: s };
  }
  s.am = (seat + 1) % s.players;
  if (s.am === 0) s.runde += 1;
  return { ok: true, state: s };
}

function outcome(s: KniffelState): TurnOutcome | null {
  if (!s.fertig) return null;
  const scores = s.blaetter.map((b, i) => totals(b, s.extra[i] ?? 0).gesamt);
  const best = Math.max(...scores);
  const winners = scores.flatMap((v, i) => (v === best ? [i] : []));
  let summary: string;
  if (s.players === 1) summary = `${best} Punkte.`;
  else if (winners.length > 1) summary = `Gleichstand mit ${best} Punkten.`;
  else summary = `Sieg mit ${best} Punkten.`;
  return { winners, summary, scores };
}

function view(s: KniffelState): KniffelView {
  const sheet = s.blaetter[s.am] ?? [];
  return {
    players: s.players,
    options: { ...s.options },
    wuerfel: [...s.wuerfel],
    gehalten: [...s.gehalten],
    wuerfe: s.wuerfe,
    am: s.am,
    runde: s.runde,
    blaetter: s.blaetter.map((b) => [...b]),
    summen: s.blaetter.map((b, i) => totals(b, s.extra[i] ?? 0)),
    vorschau: sheet.map((v, i) =>
      v !== null || s.wuerfe === 0 || s.fertig ? null : scoreField(s.wuerfel, i),
    ),
    letzter: s.letzter ? { ...s.letzter } : null,
    zuege: s.zuege,
    fertig: s.fertig,
  };
}

// ---------------------------------------------------------------------------
// Computergegner
// ---------------------------------------------------------------------------

/*
 * Ein Würfel-Multiset als Zählvektor [Einsen … Sechsen], verschlüsselt als Zahl
 * zur Basis 6 (jede Anzahl ≤ 5). Die Tabellen hängen nur von der Würfelzahl ab
 * und werden beim ersten Bot-Zug einmal gebaut.
 */
function encode(counts: readonly number[]): number {
  let key = 0;
  for (let i = 5; i >= 0; i -= 1) key = key * 6 + (counts[i] ?? 0);
  return key;
}

interface Outcome {
  counts: number[];
  p: number;
}

let outcomeTable: Outcome[][] | null = null;

/** Alle Ausgänge beim Werfen von n Würfeln (n = 0 … 5) mit Wahrscheinlichkeit. */
function outcomes(): Outcome[][] {
  if (outcomeTable) return outcomeTable;
  const fact = [1, 1, 2, 6, 24, 120];
  const table: Outcome[][] = [];
  for (let n = 0; n <= 5; n += 1) {
    const list: Outcome[] = [];
    const rec = (face: number, left: number, counts: number[]): void => {
      if (face === 5) {
        const full = [...counts, left];
        let ways = fact[n] as number;
        for (const c of full) ways /= fact[c] as number;
        list.push({ counts: full, p: ways / 6 ** n });
        return;
      }
      for (let c = 0; c <= left; c += 1) rec(face + 1, left - c, [...counts, c]);
    };
    rec(0, n, []);
    table.push(list);
  }
  outcomeTable = table;
  return table;
}

/** Alle Teil-Multisets eines Zählvektors (die möglichen Halte-Muster). */
function subsets(counts: readonly number[]): number[][] {
  const result: number[][] = [];
  const rec = (face: number, acc: number[]): void => {
    if (face === 6) {
      result.push(acc);
      return;
    }
    for (let c = 0; c <= (counts[face] ?? 0); c += 1) rec(face + 1, [...acc, c]);
  };
  rec(0, []);
  return result;
}

/**
 * Durchschnittliche Punkte je Feld bei guter Spielweise. Ein Feld mit wenig
 * Punkten zu füllen „kostet" diesen Wert – so streicht der Bot lieber die
 * Einser als den Kniffel.
 */
const FIELD_PAR = [2.1, 5.3, 8.6, 12.2, 15.7, 19.2, 21.7, 13.1, 22.6, 29.5, 32.7, 16.9, 22.0];

/** Bewertung eines Endwurfs: bestes freies Feld (Feldnummer und Wert). */
function bestField(
  counts: readonly number[],
  sheet: readonly (number | null)[],
  level: BotLevel,
  extraBonus: boolean,
): { feld: number; value: number } {
  const oben = sheet.slice(0, 6).reduce<number>((a, v) => a + (v ?? 0), 0);
  const weight = level === 'schwer' ? 1 : 0.5;
  let best = { feld: -1, value: -Infinity };
  for (let feld = 0; feld < FIELD_COUNT; feld += 1) {
    if (sheet[feld] !== null) continue;
    const pts = scoreCounts(counts, feld);
    let value = pts - weight * (FIELD_PAR[feld] ?? 0);
    if (level === 'schwer' && feld < 6 && oben < BONUS_GRENZE) {
      // Richtung Bonus: drei gleiche je Feld sind der Maßstab.
      value += (pts - 3 * (feld + 1)) * 0.6;
      if (oben + pts >= BONUS_GRENZE) value += BONUS * 0.8;
    }
    if (value > best.value) best = { feld, value };
  }
  if (extraBonus && Math.max(...counts) === 5)
    best = { feld: best.feld, value: best.value + EXTRA_KNIFFEL };
  return best;
}

/** Bester Halte-Vektor (als Zählvektor) für die aktuellen Würfel und die verbleibenden Würfe. */
function bestKeep(
  dice: readonly number[],
  rollsLeft: number,
  sheet: readonly (number | null)[],
  level: BotLevel,
  extraBonus: boolean,
): { keep: number[]; value: number } {
  const table = outcomes();
  const finalCache = new Map<number, number>();
  const finalValue = (counts: readonly number[]): number => {
    const key = encode(counts);
    let v = finalCache.get(key);
    if (v === undefined) {
      v = bestField(counts, sheet, level, extraBonus).value;
      finalCache.set(key, v);
    }
    return v;
  };
  // Wert eines vollen Wurfs mit r verbleibenden Würfen, und Erwartung eines Halte-Musters.
  const valueCache = new Map<number, number>();
  const keepCache = new Map<number, number>();
  const valueOf = (counts: readonly number[], r: number): number => {
    if (r === 0) return finalValue(counts);
    const key = encode(counts) * 4 + r;
    let v = valueCache.get(key);
    if (v !== undefined) return v;
    v = -Infinity;
    for (const keep of subsets(counts)) v = Math.max(v, expectKeep(keep, r));
    valueCache.set(key, v);
    return v;
  };
  const expectKeep = (keep: readonly number[], r: number): number => {
    const key = encode(keep) * 4 + r;
    let v = keepCache.get(key);
    if (v !== undefined) return v;
    const kept = keep.reduce((a, c) => a + c, 0);
    v = 0;
    for (const o of table[5 - kept] ?? []) {
      const merged = keep.map((c, i) => c + (o.counts[i] ?? 0));
      v += o.p * valueOf(merged, r - 1);
    }
    keepCache.set(key, v);
    return v;
  };

  const counts = countsOf(dice);
  let best = { keep: counts, value: finalValue(counts) };
  for (const keep of subsets(counts)) {
    if (keep.reduce((a, c) => a + c, 0) === 5) continue;
    const v = expectKeep(keep, rollsLeft);
    if (v > best.value + 1e-9) best = { keep, value: v };
  }
  return best;
}

/** Zählvektor zurück in ein Halte-Muster über die konkreten Würfel. */
function holdMask(dice: readonly number[], keep: readonly number[]): boolean[] {
  const left = [...keep];
  return dice.map((d) => {
    const i = d - 1;
    if ((left[i] ?? 0) > 0) {
      left[i] = (left[i] ?? 0) - 1;
      return true;
    }
    return false;
  });
}

function bot(s: KniffelState, seat: number, level: BotLevel, rng: RngState): KniffelMove {
  const sheet = s.blaetter[seat] ?? [];
  if (s.wuerfe === 0) return { type: 'wuerfeln', halten: [false, false, false, false, false] };
  const counts = countsOf(s.wuerfel);
  const open = sheet.flatMap((v, i) => (v === null ? [i] : []));

  if (level === 'leicht') {
    // Faustregel: die häufigste Augenzahl behalten, bis nichts mehr geht.
    if (s.wuerfe < 3) {
      const max = Math.max(...counts);
      if (max < 5) {
        const face = counts.lastIndexOf(max) + 1;
        const halten = s.wuerfel.map((d) => d === face);
        return { type: 'wuerfeln', halten };
      }
    }
    let bestPts = -1;
    let choices: number[] = [];
    for (const feld of open) {
      const pts = scoreField(s.wuerfel, feld);
      if (pts > bestPts) {
        bestPts = pts;
        choices = [feld];
      } else if (pts === bestPts) choices.push(feld);
    }
    return { type: 'eintragen', feld: choices[nextInt(rng, choices.length)] ?? open[0] ?? 0 };
  }

  const extraBonus = s.options.extraKniffel && sheet[KNIFFEL_FIELD] === 50;
  if (s.wuerfe < 3) {
    const { keep } = bestKeep(s.wuerfel, 3 - s.wuerfe, sheet, level, extraBonus);
    if (keep.reduce((a, c) => a + c, 0) < 5) {
      return { type: 'wuerfeln', halten: holdMask(s.wuerfel, keep) };
    }
  }
  const { feld } = bestField(counts, sheet, level, extraBonus);
  return { type: 'eintragen', feld: feld >= 0 ? feld : (open[0] ?? 0) };
}

// ---------------------------------------------------------------------------

export const game: TurnGame<KniffelState, KniffelMove, KniffelOptions, KniffelView> = {
  kind: 'turn',
  id: 'kniffel',
  version: 1,
  minPlayers: 1,
  maxPlayers: 6,
  defaultOptions: { extraKniffel: false },
  hiddenInformation: false,

  parseOptions(raw) {
    if (raw === undefined || raw === null) return { extraKniffel: false };
    if (!isRecord(raw)) return null;
    if (raw.extraKniffel === undefined) return { extraKniffel: false };
    if (typeof raw.extraKniffel !== 'boolean') return null;
    return { extraKniffel: raw.extraKniffel };
  },

  setup({ players, seed, options }) {
    return {
      version: 1,
      players,
      options: { ...options },
      rng: createRng(seed),
      wuerfel: [0, 0, 0, 0, 0],
      gehalten: [false, false, false, false, false],
      wuerfe: 0,
      am: 0,
      runde: 1,
      blaetter: Array.from({ length: players }, () =>
        Array.from({ length: FIELD_COUNT }, () => null as number | null),
      ),
      extra: Array.from({ length: players }, () => 0),
      letzter: null,
      zuege: 0,
      fertig: false,
      log: [],
    };
  },

  activeSeats: (s) => (s.fertig ? [] : [s.am]),

  parseMove(raw) {
    if (!isRecord(raw)) return null;
    if (raw.type === 'wuerfeln') {
      const h = raw.halten;
      if (h === undefined) return { type: 'wuerfeln', halten: [false, false, false, false, false] };
      if (!Array.isArray(h) || h.length !== 5 || !h.every((x) => typeof x === 'boolean'))
        return null;
      return { type: 'wuerfeln', halten: h as boolean[] };
    }
    if (raw.type === 'eintragen') {
      const feld = intIn(raw.feld, 0, FIELD_COUNT - 1);
      return feld === null ? null : { type: 'eintragen', feld };
    }
    return null;
  },

  applyMove,
  outcome,
  view: (s) => view(s),
  log: (s) => s.log.slice(-50),
  bot,
};
