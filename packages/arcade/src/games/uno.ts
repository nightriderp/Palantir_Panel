/**
 * UNO – Ablegen nach Farbe oder Zahl, mit Aktionskarten und „UNO"-Ruf.
 *
 * Das Blatt folgt der klassischen Zusammensetzung (108 Karten). Die Kartentexte
 * und die Gestaltung stammen aus diesem Projekt, nur die Regelmechanik ist die
 * bekannte.
 *
 * Der „UNO"-Ruf ist der heikle Teil: Wer seine vorletzte Karte legt, ohne zu
 * rufen, ist angreifbar, bis der nächste reguläre Zug fällt. In diesem Fenster
 * sind alle anderen Sitze zusätzlich aktiv und dürfen „erwischt" melden. Damit
 * Computergegner das Fenster nicht endlos offen halten, lehnen sie mit „weiter"
 * ab und fallen aus der Liste – so wird jeder Bot-Sitz höchstens einmal
 * gefragt, und die Partie läuft sicher weiter.
 */

import { type RngState, createRng, nextInt, nextRandom, shuffled } from '../rng.js';
import {
  type BotLevel,
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  cloneState,
  intIn,
  isRecord,
  pushLog,
} from '../turn.js';

export type UnoColor = 'rot' | 'gelb' | 'gruen' | 'blau';
export type UnoKind = 'zahl' | 'aussetzen' | 'richtung' | 'plus2' | 'farbwahl' | 'plus4';

export interface UnoCard {
  id: number;
  farbe: UnoColor | 'schwarz';
  art: UnoKind;
  /** Ziffer bei Zahlenkarten, sonst -1. */
  zahl: number;
}

export const UNO_COLORS: readonly UnoColor[] = ['rot', 'gelb', 'gruen', 'blau'];

const COLOR_NAMES: Record<UnoColor, string> = {
  rot: 'Rot',
  gelb: 'Gelb',
  gruen: 'Grün',
  blau: 'Blau',
};

export interface UnoOptions {
  /** +2 und +4 dürfen weitergereicht werden; wer nicht kann, zieht die Summe. */
  stapeln: boolean;
  /** Mehrere Runden mit klassischer Punktezählung bis 500. */
  punktspiel: boolean;
}

export type UnoMove =
  | { type: 'legen'; karte: number; farbe: UnoColor | null; uno: boolean }
  | { type: 'ziehen' }
  | { type: 'behalten' }
  | { type: 'erwischt' }
  | { type: 'weiter' };

export interface UnoState {
  version: 1;
  players: number;
  options: UnoOptions;
  rng: RngState;
  hands: UnoCard[][];
  stapel: UnoCard[];
  /** Ablage, oberste Karte zuletzt. */
  ablage: UnoCard[];
  /** Gültige Farbe; `null` = frei (Farbwahl als Startkarte). */
  farbe: UnoColor | null;
  am: number;
  richtung: 1 | -1;
  phase: 'legen' | 'gezogen' | 'ende';
  /** Karte, die der Sitz am Zug gerade gezogen hat und noch legen darf. */
  gezogen: number | null;
  /** Aufgestaute Strafkarten (nur mit „Stapeln"). */
  strafe: number;
  /** Offenes Erwisch-Fenster: angreifbarer Sitz und wer noch melden darf. */
  uno: { sitz: number; offen: number[] } | null;
  /** Sitz hat bei seiner letzten Karte „UNO" gerufen. */
  gerufen: boolean[];
  /** Gesamtpunkte im Punktspiel. */
  punkte: number[];
  runde: number;
  geber: number;
  letzteRunde: { sieger: number; punkte: number } | null;
  /** Leere Züge hintereinander bei erschöpftem Stapel – Schutz vor Stillstand. */
  stillstand: number;
  zuege: number;
  sieger: number[] | null;
  zusammenfassung: string;
  log: TurnLogEntry[];
}

export interface UnoView {
  players: number;
  mySeat: number | null;
  /** Eigene Hand; leer für Zuschauer. */
  hand: UnoCard[];
  handCounts: number[];
  top: UnoCard;
  farbe: UnoColor | null;
  richtung: 1 | -1;
  am: number;
  phase: 'legen' | 'gezogen' | 'ende';
  /** Gezogene Karte – nur für den eigenen Sitz. */
  gezogen: number | null;
  strafe: number;
  stapelAnzahl: number;
  ablageAnzahl: number;
  /** Sitz, der „UNO" vergessen hat und gerade angreifbar ist. */
  unoOffen: number | null;
  darfErwischen: boolean;
  gerufen: boolean[];
  options: UnoOptions;
  punkte: number[];
  runde: number;
  letzteRunde: { sieger: number; punkte: number } | null;
  /** Legbare Karten der eigenen Hand (nur wenn am Zug). */
  spielbar: number[];
  zuege: number;
  sieger: number[] | null;
}

const HAND_SIZE = 7;
const ZIELPUNKTE = 500;
/** Obergrenze fürs Punktspiel, damit auch zähe Bot-Runden sicher enden. */
const MAX_RUNDEN = 40;

// ---------------------------------------------------------------------------
// Karten
// ---------------------------------------------------------------------------

function buildDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  let id = 0;
  for (const farbe of UNO_COLORS) {
    deck.push({ id: id++, farbe, art: 'zahl', zahl: 0 });
    for (let n = 1; n <= 9; n += 1) {
      deck.push({ id: id++, farbe, art: 'zahl', zahl: n });
      deck.push({ id: id++, farbe, art: 'zahl', zahl: n });
    }
    for (const art of ['aussetzen', 'richtung', 'plus2'] as const) {
      deck.push({ id: id++, farbe, art, zahl: -1 });
      deck.push({ id: id++, farbe, art, zahl: -1 });
    }
  }
  for (let i = 0; i < 4; i += 1)
    deck.push({ id: id++, farbe: 'schwarz', art: 'farbwahl', zahl: -1 });
  for (let i = 0; i < 4; i += 1) deck.push({ id: id++, farbe: 'schwarz', art: 'plus4', zahl: -1 });
  return deck;
}

export function cardLabel(card: UnoCard): string {
  switch (card.art) {
    case 'farbwahl':
      return 'Farbwahl';
    case 'plus4':
      return '+4';
    default: {
      const farbe = COLOR_NAMES[card.farbe as UnoColor];
      if (card.art === 'zahl') return `${farbe} ${card.zahl}`;
      if (card.art === 'aussetzen') return `${farbe} Aussetzen`;
      if (card.art === 'richtung') return `${farbe} Richtungswechsel`;
      return `${farbe} +2`;
    }
  }
}

/** Punktwert einer Handkarte beim Rundenende. */
export function cardPoints(card: UnoCard): number {
  if (card.art === 'zahl') return card.zahl;
  if (card.art === 'farbwahl' || card.art === 'plus4') return 50;
  return 20;
}

function topCard(s: UnoState): UnoCard {
  const top = s.ablage[s.ablage.length - 1];
  if (!top) throw new Error('uno: leere Ablage');
  return top;
}

/** Darf `card` jetzt auf die Ablage? (Ohne Prüfung der Phase.) */
function canPlay(s: UnoState, card: UnoCard): boolean {
  const top = topCard(s);
  if (s.strafe > 0) {
    // Beim Stapeln bleibt nur Weiterreichen: +2 auf +2, +4 auf alles.
    return card.art === 'plus4' || (card.art === 'plus2' && top.art === 'plus2');
  }
  if (card.art === 'farbwahl' || card.art === 'plus4') return true;
  if (s.farbe === null || card.farbe === s.farbe) return true;
  if (card.art === 'zahl') return top.art === 'zahl' && top.zahl === card.zahl;
  return card.art === top.art;
}

function playableIds(s: UnoState, seat: number): number[] {
  if (s.phase === 'ende' || seat !== s.am) return [];
  const hand = s.hands[seat] ?? [];
  if (s.phase === 'gezogen') {
    const card = hand.find((c) => c.id === s.gezogen);
    return card && canPlay(s, card) ? [card.id] : [];
  }
  return hand.filter((c) => canPlay(s, c)).map((c) => c.id);
}

function seatAfter(s: UnoState, from: number, steps = 1): number {
  const n = s.players;
  return (((from + s.richtung * steps) % n) + n) % n;
}

/** Zieht bis zu `count` Karten; mischt die Ablage (ohne oberste Karte) neu ein, wenn nötig. */
function drawCards(s: UnoState, seat: number, count: number): UnoCard[] {
  const drawn: UnoCard[] = [];
  const hand = s.hands[seat];
  if (!hand) return drawn;
  for (let i = 0; i < count; i += 1) {
    if (s.stapel.length === 0 && s.ablage.length > 1) {
      const top = s.ablage.pop() as UnoCard;
      s.stapel = shuffled(s.rng, s.ablage);
      s.ablage = [top];
      s.log = pushLog(s.log, { seat: null, text: 'Die Ablage wird zum neuen Stapel gemischt.' });
    }
    const card = s.stapel.pop();
    if (!card) break;
    hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

// ---------------------------------------------------------------------------
// Runden
// ---------------------------------------------------------------------------

function dealRound(s: UnoState): void {
  s.stapel = shuffled(s.rng, buildDeck());
  s.hands = Array.from({ length: s.players }, () => [] as UnoCard[]);
  s.ablage = [];
  for (let r = 0; r < HAND_SIZE; r += 1) {
    for (let p = 0; p < s.players; p += 1) {
      const card = s.stapel.pop() as UnoCard;
      (s.hands[p] as UnoCard[]).push(card);
    }
  }
  // Eine +4 als Startkarte wandert zurück in den Stapel, wie in der klassischen Regel.
  let start = s.stapel.pop() as UnoCard;
  while (start.art === 'plus4') {
    s.stapel.splice(nextInt(s.rng, s.stapel.length + 1), 0, start);
    start = s.stapel.pop() as UnoCard;
  }
  s.ablage.push(start);
  s.richtung = 1;
  s.strafe = 0;
  s.uno = null;
  s.gerufen = Array.from({ length: s.players }, () => false);
  s.phase = 'legen';
  s.gezogen = null;
  s.stillstand = 0;
  s.farbe = start.farbe === 'schwarz' ? null : start.farbe;
  s.am = seatAfter(s, s.geber);
  s.log = pushLog(s.log, {
    seat: null,
    text: `Runde ${s.runde}: Startkarte ist ${cardLabel(start)}.`,
  });

  // Aktionskarten als Startkarte wirken auf den ersten Sitz.
  if (start.art === 'aussetzen') {
    s.log = pushLog(s.log, { seat: s.am, text: 'muss gleich aussetzen.' });
    s.am = seatAfter(s, s.am);
  } else if (start.art === 'richtung') {
    if (s.players === 2) {
      s.am = seatAfter(s, s.am);
    } else {
      s.richtung = -1;
      s.am = s.geber;
    }
  } else if (start.art === 'plus2') {
    drawCards(s, s.am, 2);
    s.log = pushLog(s.log, { seat: s.am, text: 'zieht zum Start 2 Karten und setzt aus.' });
    s.am = seatAfter(s, s.am);
  }
}

function handPoints(hand: UnoCard[]): number {
  return hand.reduce((sum, c) => sum + cardPoints(c), 0);
}

/** Runde beendet: Punkte werten, Partie beenden oder nächste Runde geben. */
function finishRound(s: UnoState, winner: number, reason: string): void {
  let pts = 0;
  for (let p = 0; p < s.players; p += 1) {
    if (p !== winner) pts += handPoints(s.hands[p] ?? []);
  }
  if (!s.options.punktspiel) {
    s.phase = 'ende';
    s.sieger = [winner];
    s.zusammenfassung = reason;
    s.uno = null;
    s.log = pushLog(s.log, { seat: winner, text: 'gewinnt die Runde.' });
    return;
  }
  s.punkte[winner] = (s.punkte[winner] ?? 0) + pts;
  s.log = pushLog(s.log, {
    seat: winner,
    text: `gewinnt Runde ${s.runde} und bekommt ${pts} Punkte.`,
  });
  s.letzteRunde = { sieger: winner, punkte: pts };
  const best = Math.max(...s.punkte);
  if ((s.punkte[winner] ?? 0) >= ZIELPUNKTE || s.runde >= MAX_RUNDEN) {
    s.phase = 'ende';
    s.uno = null;
    s.sieger = s.punkte.flatMap((p, i) => (p === best ? [i] : []));
    s.zusammenfassung =
      (s.punkte[winner] ?? 0) >= ZIELPUNKTE
        ? `${best} Punkte – das Ziel von ${ZIELPUNKTE} ist erreicht.`
        : `Nach ${MAX_RUNDEN} Runden entscheidet der Punktestand (${best}).`;
    return;
  }
  s.runde += 1;
  s.geber = (s.geber + 1) % s.players;
  dealRound(s);
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

function parseColor(value: unknown): UnoColor | null {
  return typeof value === 'string' && (UNO_COLORS as readonly string[]).includes(value)
    ? (value as UnoColor)
    : null;
}

function activeSeats(s: UnoState): number[] {
  if (s.phase === 'ende') return [];
  if (!s.uno) return [s.am];
  // Melder zuerst: Der Wirt fragt Bots in dieser Reihenfolge, und ein Zug des
  // Sitzes am Zug schließt das Fenster.
  return [...s.uno.offen.filter((p) => p !== s.am), s.am];
}

function applyMove(
  state: UnoState,
  seat: number,
  move: UnoMove,
): { ok: true; state: UnoState } | { ok: false; error: string } {
  if (state.phase === 'ende') return { ok: false, error: 'Die Partie ist vorbei.' };
  if (!activeSeats(state).includes(seat)) return { ok: false, error: 'Du bist nicht am Zug.' };
  const s = cloneState(state);

  if (move.type === 'erwischt') {
    if (!s.uno || !s.uno.offen.includes(seat)) {
      return { ok: false, error: 'Da gibt es gerade niemanden zu erwischen.' };
    }
    const target = s.uno.sitz;
    drawCards(s, target, 2);
    s.log = pushLog(s.log, { seat, text: 'erwischt einen vergessenen „UNO"-Ruf – 2 Strafkarten.' });
    s.uno = null;
    s.zuege += 1;
    return { ok: true, state: s };
  }
  if (move.type === 'weiter') {
    if (!s.uno || !s.uno.offen.includes(seat) || seat === s.am) {
      return { ok: false, error: 'Hier gibt es nichts zu überspringen.' };
    }
    s.uno.offen = s.uno.offen.filter((p) => p !== seat);
    return { ok: true, state: s };
  }

  if (seat !== s.am) return { ok: false, error: 'Du bist nicht am Zug.' };
  const hand = s.hands[seat] as UnoCard[];

  if (move.type === 'ziehen') {
    if (s.phase !== 'legen') return { ok: false, error: 'Du hast schon gezogen.' };
    s.uno = null;
    s.zuege += 1;
    if (s.strafe > 0) {
      const n = drawCards(s, seat, s.strafe).length;
      s.log = pushLog(s.log, { seat, text: `zieht ${n} Strafkarten.` });
      s.strafe = 0;
      s.am = seatAfter(s, seat);
      return { ok: true, state: s };
    }
    const drawn = drawCards(s, seat, 1)[0];
    if (!drawn) {
      s.stillstand += 1;
      s.log = pushLog(s.log, { seat, text: 'kann nicht ziehen – der Stapel ist leer.' });
      if (s.stillstand >= s.players) {
        // Niemand kann mehr etwas tun: Die kleinste Hand gewinnt die Runde.
        let best = 0;
        for (let p = 1; p < s.players; p += 1) {
          if (handPoints(s.hands[p] ?? []) < handPoints(s.hands[best] ?? [])) best = p;
        }
        finishRound(s, best, 'Alles blockiert – die kleinste Hand gewinnt.');
        return { ok: true, state: s };
      }
      s.am = seatAfter(s, seat);
      return { ok: true, state: s };
    }
    s.stillstand = 0;
    if (canPlay(s, drawn)) {
      s.phase = 'gezogen';
      s.gezogen = drawn.id;
      s.log = pushLog(s.log, { seat, text: 'zieht eine Karte, die passt.' });
    } else {
      s.log = pushLog(s.log, { seat, text: 'zieht eine Karte.' });
      s.am = seatAfter(s, seat);
    }
    return { ok: true, state: s };
  }

  if (move.type === 'behalten') {
    if (s.phase !== 'gezogen') return { ok: false, error: 'Du hast noch nicht gezogen.' };
    s.uno = null;
    s.zuege += 1;
    s.phase = 'legen';
    s.gezogen = null;
    s.log = pushLog(s.log, { seat, text: 'behält die Karte.' });
    s.am = seatAfter(s, seat);
    return { ok: true, state: s };
  }

  // legen
  const index = hand.findIndex((c) => c.id === move.karte);
  const card = hand[index];
  if (!card) return { ok: false, error: 'Diese Karte hast du nicht.' };
  if (s.phase === 'gezogen' && card.id !== s.gezogen) {
    return { ok: false, error: 'Du darfst nur die gerade gezogene Karte legen.' };
  }
  if (!canPlay(s, card)) {
    return {
      ok: false,
      error:
        s.strafe > 0
          ? 'Du musst eine Ziehkarte weiterreichen oder ziehen.'
          : 'Diese Karte passt nicht.',
    };
  }
  const wild = card.farbe === 'schwarz';
  if (wild && !move.farbe) return { ok: false, error: 'Wähle eine Farbe.' };

  s.uno = null;
  s.zuege += 1;
  s.stillstand = 0;
  hand.splice(index, 1);
  s.ablage.push(card);
  s.farbe = wild ? (move.farbe as UnoColor) : (card.farbe as UnoColor);
  s.phase = 'legen';
  s.gezogen = null;
  s.log = pushLog(s.log, {
    seat,
    text: wild
      ? `legt ${cardLabel(card)} und wünscht ${COLOR_NAMES[s.farbe]}.`
      : `legt ${cardLabel(card)}.`,
  });

  if (hand.length === 1) {
    if (move.uno) {
      s.gerufen[seat] = true;
      s.log = pushLog(s.log, { seat, text: 'ruft „UNO!"' });
    } else {
      s.gerufen[seat] = false;
      s.uno = {
        sitz: seat,
        offen: Array.from({ length: s.players }, (_, p) => p).filter((p) => p !== seat),
      };
    }
  } else {
    s.gerufen[seat] = false;
  }

  // Wirkung der Karte
  const next = seatAfter(s, seat);
  let advance = 1;
  if (card.art === 'aussetzen') {
    s.log = pushLog(s.log, { seat: next, text: 'setzt aus.' });
    advance = 2;
  } else if (card.art === 'richtung') {
    if (s.players === 2) {
      advance = 2;
    } else {
      s.richtung = s.richtung === 1 ? -1 : 1;
    }
  } else if (card.art === 'plus2' || card.art === 'plus4') {
    const n = card.art === 'plus2' ? 2 : 4;
    if (s.options.stapeln && hand.length > 0) {
      s.strafe += n;
    } else {
      const total = s.strafe + n;
      s.strafe = 0;
      const got = drawCards(s, next, total).length;
      s.log = pushLog(s.log, { seat: next, text: `zieht ${got} Karten und setzt aus.` });
      advance = 2;
    }
  }

  if (hand.length === 0) {
    s.uno = null;
    finishRound(s, seat, 'Alle Karten abgelegt.');
    return { ok: true, state: s };
  }
  s.am = seatAfter(s, seat, advance);
  return { ok: true, state: s };
}

function outcome(s: UnoState): TurnOutcome | null {
  if (s.phase !== 'ende' || !s.sieger) return null;
  const result: TurnOutcome = { winners: s.sieger, summary: s.zusammenfassung };
  if (s.options.punktspiel) result.scores = [...s.punkte];
  return result;
}

function view(s: UnoState, seat: number | null): UnoView {
  const own = seat !== null && seat >= 0 && seat < s.players;
  return {
    players: s.players,
    mySeat: own ? seat : null,
    hand: own ? (s.hands[seat] ?? []).map((c) => ({ ...c })) : [],
    handCounts: s.hands.map((h) => h.length),
    top: { ...topCard(s) },
    farbe: s.farbe,
    richtung: s.richtung,
    am: s.am,
    phase: s.phase,
    gezogen: own && seat === s.am ? s.gezogen : null,
    strafe: s.strafe,
    stapelAnzahl: s.stapel.length,
    ablageAnzahl: s.ablage.length,
    unoOffen: s.uno ? s.uno.sitz : null,
    darfErwischen: own && s.uno !== null && s.uno.offen.includes(seat),
    gerufen: s.gerufen.map((g, i) => g && (s.hands[i]?.length ?? 0) === 1),
    options: { ...s.options },
    punkte: [...s.punkte],
    runde: s.runde,
    letzteRunde: s.letzteRunde ? { ...s.letzteRunde } : null,
    spielbar: own ? playableIds(s, seat) : [],
    zuege: s.zuege,
    sieger: s.sieger ? [...s.sieger] : null,
  };
}

// ---------------------------------------------------------------------------
// Computergegner
// ---------------------------------------------------------------------------

/** Farbe, von der die Hand am meisten hat (ohne schwarze Karten). */
function favouriteColor(hand: UnoCard[], rng: RngState, randomTie: boolean): UnoColor {
  const counts = UNO_COLORS.map((c) => hand.filter((k) => k.farbe === c).length);
  const max = Math.max(...counts);
  const best = UNO_COLORS.filter((_, i) => counts[i] === max);
  if (randomTie) return best[nextInt(rng, best.length)] ?? 'rot';
  return best[0] ?? 'rot';
}

function bot(s: UnoState, seat: number, level: BotLevel, rng: RngState): UnoMove {
  // Erwischen ist öffentliche Information – das darf jeder Sitz.
  if (s.uno && s.uno.offen.includes(seat)) {
    if (level === 'schwer') return { type: 'erwischt' };
    if (seat !== s.am) return { type: 'weiter' };
  }
  const hand = s.hands[seat] ?? [];
  const ids = playableIds(s, seat);
  const opponents = Array.from({ length: s.players }, (_, p) => p).filter((p) => p !== seat);
  const next = seatAfter(s, seat);
  const nextCount = s.hands[next]?.length ?? 0;
  const minOpp = Math.min(...opponents.map((p) => s.hands[p]?.length ?? 0));
  const threat = nextCount <= 2 || (level === 'schwer' && nextCount === minOpp && nextCount <= 4);

  const callUno = (): boolean => {
    if (hand.length !== 2) return false;
    return level === 'leicht' ? nextRandom(rng) >= 0.3 : true;
  };
  const colorFor = (card: UnoCard): UnoColor | null => {
    if (card.farbe !== 'schwarz') return null;
    const rest = hand.filter((c) => c.id !== card.id);
    if (level === 'leicht') return UNO_COLORS[nextInt(rng, 4)] ?? 'rot';
    return favouriteColor(rest, rng, false);
  };

  if (ids.length === 0) {
    return s.phase === 'gezogen' ? { type: 'behalten' } : { type: 'ziehen' };
  }

  let chosen: UnoCard | undefined;
  if (level === 'leicht') {
    chosen = hand.find((c) => c.id === ids[nextInt(rng, ids.length)]);
  } else {
    const fav = favouriteColor(hand, rng, false);
    let bestScore = -Infinity;
    for (const id of ids) {
      const card = hand.find((c) => c.id === id) as UnoCard;
      let score = 0;
      switch (card.art) {
        case 'zahl':
          score = 10 + card.zahl * 0.4 + (card.farbe === fav ? 2 : 0);
          break;
        case 'aussetzen':
        case 'plus2':
          score = threat ? 35 : level === 'schwer' ? 8 : 11;
          if (card.art === 'plus2' && s.strafe > 0) score = 30;
          break;
        case 'richtung': {
          if (s.players === 2) {
            score = threat ? 34 : 9;
          } else {
            // Umdrehen macht den Vorgänger zum Nächsten – nur gut, wenn der schwächer droht.
            const prev = seatAfter(s, seat, -1);
            const prevCount = s.hands[prev]?.length ?? 0;
            score = prevCount > nextCount ? (threat ? 30 : 10) : 6;
          }
          break;
        }
        case 'farbwahl':
          score = threat ? 14 : 3;
          break;
        case 'plus4':
          // Aufsparen, solange niemand kurz vor dem Ziel steht.
          score = threat ? 40 : s.strafe > 0 ? 20 : 1;
          break;
      }
      // Mit wenigen Karten die teuren zuerst loswerden (Punktspiel).
      if (level === 'schwer' && hand.length <= 3) score += cardPoints(card) / 25;
      if (score > bestScore) {
        bestScore = score;
        chosen = card;
      }
    }
    // Die gerade gezogene +4 behält „schwer" lieber für später.
    if (
      level === 'schwer' &&
      s.phase === 'gezogen' &&
      chosen?.art === 'plus4' &&
      !threat &&
      s.strafe === 0
    ) {
      return { type: 'behalten' };
    }
  }
  if (!chosen) return s.phase === 'gezogen' ? { type: 'behalten' } : { type: 'ziehen' };
  return { type: 'legen', karte: chosen.id, farbe: colorFor(chosen), uno: callUno() };
}

// ---------------------------------------------------------------------------

export const game: TurnGame<UnoState, UnoMove, UnoOptions, UnoView> = {
  kind: 'turn',
  id: 'uno',
  version: 1,
  minPlayers: 2,
  maxPlayers: 8,
  defaultOptions: { stapeln: false, punktspiel: false },
  hiddenInformation: true,

  parseOptions(raw) {
    if (raw === undefined || raw === null) return { stapeln: false, punktspiel: false };
    if (!isRecord(raw)) return null;
    const out: UnoOptions = { stapeln: false, punktspiel: false };
    for (const key of ['stapeln', 'punktspiel'] as const) {
      const value = raw[key];
      if (value === undefined) continue;
      if (typeof value !== 'boolean') return null;
      out[key] = value;
    }
    return out;
  },

  setup({ players, seed, options }) {
    const s: UnoState = {
      version: 1,
      players,
      options: { ...options },
      rng: createRng(seed),
      hands: [],
      stapel: [],
      ablage: [],
      farbe: null,
      am: 0,
      richtung: 1,
      phase: 'legen',
      gezogen: null,
      strafe: 0,
      uno: null,
      gerufen: [],
      punkte: Array.from({ length: players }, () => 0),
      runde: 1,
      geber: players - 1,
      letzteRunde: null,
      stillstand: 0,
      zuege: 0,
      sieger: null,
      zusammenfassung: '',
      log: [],
    };
    dealRound(s);
    return s;
  },

  activeSeats,

  parseMove(raw) {
    if (!isRecord(raw)) return null;
    switch (raw.type) {
      case 'legen': {
        const karte = intIn(raw.karte, 0, 107);
        if (karte === null) return null;
        let farbe: UnoColor | null = null;
        if (raw.farbe !== undefined && raw.farbe !== null) {
          farbe = parseColor(raw.farbe);
          if (farbe === null) return null;
        }
        if (raw.uno !== undefined && typeof raw.uno !== 'boolean') return null;
        return { type: 'legen', karte, farbe, uno: raw.uno === true };
      }
      case 'ziehen':
      case 'behalten':
      case 'erwischt':
      case 'weiter':
        return { type: raw.type };
      default:
        return null;
    }
  },

  applyMove,
  outcome,
  view,
  log: (s) => s.log.slice(-50),
  bot,
};
