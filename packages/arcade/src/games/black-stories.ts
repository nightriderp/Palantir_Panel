/**
 * Black Stories – rabenschwarze Rätsel mit Ja/Nein-Fragen.
 *
 * Reihum ist ein Sitz Rätselmeister, kennt die Lösung und beantwortet Fragen;
 * die anderen raten. Online tippen die Rater ihre Fragen ein. Am selben Gerät
 * sitzt meist nur der Meister am Bildschirm und die anderen fragen mündlich –
 * dafür gibt es die Züge `muendlich` (Zähler für gestellte Fragen) und
 * `geloest` („Sitz X hat es herausgefunden").
 *
 * Punkte: Wer löst, bekommt einen. Der Meister bekommt einen, wenn die Runde
 * erst nach 20 oder mehr Fragen gelöst wurde oder er auflösen musste – ein
 * gut gehütetes Geheimnis soll sich lohnen.
 */

import { type RngState, createRng, nextInt } from '../rng.js';
import {
  type MoveResult,
  type TurnGame,
  type TurnLogEntry,
  cloneState,
  intIn,
  isRecord,
  pushLog,
  textUpTo,
} from '../turn.js';
import { BLACK_STORIES, type BlackStory } from './black-stories-raetsel.js';

export type BsAntwort = 'ja' | 'nein' | 'irrelevant' | 'gut';
export type BsUrteil = 'richtig' | 'falsch' | 'fast';

export interface BsFrage {
  id: number;
  seat: number;
  text: string;
  antwort: BsAntwort | null;
}

export interface BsVersuch {
  id: number;
  seat: number;
  text: string;
  urteil: BsUrteil | null;
}

export interface BsErgebnis {
  runde: number;
  meister: number;
  raetsel: number;
  geloestVon: number | null;
  meisterPunkt: boolean;
  fragen: number;
}

export interface BsOptions {
  /** Anzahl Runden; `null` = so viele wie Sitze (jeder ist einmal Meister). */
  runden: number | null;
}

export interface BsState {
  version: 1;
  spieler: number;
  runden: number;
  /** Laufende Runde, 0-basiert. Meister ist `runde % spieler`. */
  runde: number;
  phase: 'waehlen' | 'raten' | 'ende';
  raetsel: number | null;
  benutzt: number[];
  fragen: BsFrage[];
  versuche: BsVersuch[];
  muendlich: Record<BsAntwort, number>;
  naechsteId: number;
  punkte: number[];
  ergebnisse: BsErgebnis[];
  rng: RngState;
  log: TurnLogEntry[];
}

export type BsMove =
  | { typ: 'waehle'; raetsel: number | null }
  | { typ: 'frage'; text: string }
  | { typ: 'antwort'; frage: number; antwort: BsAntwort }
  | { typ: 'muendlich'; antwort: BsAntwort }
  | { typ: 'loesung'; text: string }
  | { typ: 'bewerte'; versuch: number; urteil: BsUrteil }
  | { typ: 'geloest'; sitz: number }
  | { typ: 'aufloesen' };

export interface BsKarte {
  id: number;
  titel: string;
  text: string;
  stufe: 1 | 2 | 3;
}

export interface BsAufloesung extends BsKarte {
  loesung: string;
  runde: number;
  meister: number;
  geloestVon: number | null;
  meisterPunkt: boolean;
  fragen: number;
}

export interface BsView {
  phase: 'waehlen' | 'raten' | 'ende';
  runde: number;
  runden: number;
  spieler: number;
  meister: number;
  meinSitz: number | null;
  binMeister: boolean;
  karte: BsKarte | null;
  /** Nur für den Meister der laufenden Runde. */
  loesung: string | null;
  /** Nur für den Meister in der Wahl: noch nicht gespielte Rätsel (ohne Lösung). */
  auswahl: BsKarte[] | null;
  fragen: BsFrage[];
  versuche: BsVersuch[];
  muendlich: Record<BsAntwort, number>;
  fragenGesamt: number;
  punkte: number[];
  /** Die zuletzt beendete Runde – dann für alle mit Lösung. */
  letzte: BsAufloesung | null;
}

export const BS_MAX_OFFENE_FRAGEN = 3;
export const BS_FRAGEN_FUER_MEISTER = 20;
const MAX_FRAGEN = 120;
const MAX_VERSUCHE = 40;
const MAX_MUENDLICH = 999;

export const BS_ANTWORT_TEXT: Record<BsAntwort, string> = {
  ja: 'Ja',
  nein: 'Nein',
  irrelevant: 'Irrelevant',
  gut: 'Gute Frage!',
};
const URTEIL_TEXT: Record<BsUrteil, string> = {
  richtig: 'richtig',
  falsch: 'falsch',
  fast: 'fast richtig',
};

const ANTWORTEN: readonly BsAntwort[] = ['ja', 'nein', 'irrelevant', 'gut'];
const URTEILE: readonly BsUrteil[] = ['richtig', 'falsch', 'fast'];

function raetsel(id: number): BlackStory | undefined {
  return BLACK_STORIES.find((r) => r.id === id);
}

function karte(r: BlackStory): BsKarte {
  return { id: r.id, titel: r.titel, text: r.text, stufe: r.stufe };
}

export function meisterVon(state: Pick<BsState, 'runde' | 'spieler'>): number {
  return state.runde % state.spieler;
}

/** Gestellte Fragen: beantwortete getippte plus mündlich gezählte. */
export function fragenGesamt(state: Pick<BsState, 'fragen' | 'muendlich'>): number {
  const getippt = state.fragen.filter((f) => f.antwort !== null).length;
  return (
    getippt +
    state.muendlich.ja +
    state.muendlich.nein +
    state.muendlich.irrelevant +
    state.muendlich.gut
  );
}

function offeneFragen(state: BsState, seat: number): number {
  return state.fragen.filter((f) => f.seat === seat && f.antwort === null).length;
}

function offenerVersuch(state: BsState, seat: number): boolean {
  return state.versuche.some((v) => v.seat === seat && v.urteil === null);
}

function leererZaehler(): Record<BsAntwort, number> {
  return { ja: 0, nein: 0, irrelevant: 0, gut: 0 };
}

/** Runde abschließen, Punkte verteilen, nächste Runde oder Spielende. */
function rundeEnde(state: BsState, geloestVon: number | null): void {
  const meister = meisterVon(state);
  const anzahl = fragenGesamt(state);
  const meisterPunkt = geloestVon === null || anzahl >= BS_FRAGEN_FUER_MEISTER;
  if (geloestVon !== null) state.punkte[geloestVon] = (state.punkte[geloestVon] ?? 0) + 1;
  if (meisterPunkt) state.punkte[meister] = (state.punkte[meister] ?? 0) + 1;
  const r = raetsel(state.raetsel ?? -1);
  state.ergebnisse = [
    ...state.ergebnisse,
    {
      runde: state.runde,
      meister,
      raetsel: state.raetsel ?? -1,
      geloestVon,
      meisterPunkt,
      fragen: anzahl,
    },
  ];
  state.log = pushLog(state.log, {
    seat: null,
    text: `Auflösung „${r?.titel ?? ''}": ${r?.loesung ?? ''}`,
  });
  state.runde += 1;
  state.raetsel = null;
  state.fragen = [];
  state.versuche = [];
  state.muendlich = leererZaehler();
  if (state.runde >= state.runden) {
    state.phase = 'ende';
    state.log = pushLog(state.log, {
      seat: null,
      text: 'Alle Runden gespielt – die Punkte entscheiden.',
    });
  } else {
    state.phase = 'waehlen';
  }
}

export const game: TurnGame<BsState, BsMove, BsOptions, BsView> = {
  kind: 'turn',
  id: 'black-stories',
  version: 1,
  minPlayers: 2,
  maxPlayers: 10,
  defaultOptions: { runden: null },
  hiddenInformation: true,

  parseOptions(raw) {
    if (raw === undefined || raw === null) return { runden: null };
    if (!isRecord(raw)) return null;
    if (raw.runden === undefined || raw.runden === null) return { runden: null };
    const runden = intIn(raw.runden, 1, 20);
    return runden === null ? null : { runden };
  },

  setup({ players, seed, options }) {
    return {
      version: 1,
      spieler: players,
      runden: options.runden ?? players,
      runde: 0,
      phase: 'waehlen',
      raetsel: null,
      benutzt: [],
      fragen: [],
      versuche: [],
      muendlich: leererZaehler(),
      naechsteId: 1,
      punkte: Array<number>(players).fill(0),
      ergebnisse: [],
      rng: createRng(seed),
      log: [{ seat: 0, text: 'ist als Erstes Rätselmeister.' }],
    };
  },

  activeSeats(state) {
    if (state.phase === 'ende') return [];
    const meister = meisterVon(state);
    if (state.phase === 'waehlen') return [meister];
    const seats: number[] = [];
    for (let seat = 0; seat < state.spieler; seat += 1) {
      if (seat === meister) seats.push(seat);
      else if (offeneFragen(state, seat) < BS_MAX_OFFENE_FRAGEN || !offenerVersuch(state, seat))
        seats.push(seat);
    }
    return seats;
  },

  parseMove(raw) {
    if (!isRecord(raw)) return null;
    switch (raw.typ) {
      case 'waehle': {
        if (raw.raetsel === null) return { typ: 'waehle', raetsel: null };
        const id = intIn(raw.raetsel, 1, 100_000);
        return id === null ? null : { typ: 'waehle', raetsel: id };
      }
      case 'frage': {
        const text = textUpTo(raw.text, 200);
        return text === null ? null : { typ: 'frage', text };
      }
      case 'antwort': {
        const frage = intIn(raw.frage, 1, 1_000_000);
        const antwort = ANTWORTEN.find((a) => a === raw.antwort);
        return frage === null || !antwort ? null : { typ: 'antwort', frage, antwort };
      }
      case 'muendlich': {
        const antwort = ANTWORTEN.find((a) => a === raw.antwort);
        return antwort ? { typ: 'muendlich', antwort } : null;
      }
      case 'loesung': {
        const text = textUpTo(raw.text, 300);
        return text === null ? null : { typ: 'loesung', text };
      }
      case 'bewerte': {
        const versuch = intIn(raw.versuch, 1, 1_000_000);
        const urteil = URTEILE.find((u) => u === raw.urteil);
        return versuch === null || !urteil ? null : { typ: 'bewerte', versuch, urteil };
      }
      case 'geloest': {
        const sitz = intIn(raw.sitz, 0, 9);
        return sitz === null ? null : { typ: 'geloest', sitz };
      }
      case 'aufloesen':
        return { typ: 'aufloesen' };
      default:
        return null;
    }
  },

  applyMove(prev, seat, move): MoveResult<BsState> {
    if (prev.phase === 'ende') return { ok: false, error: 'Die Partie ist vorbei.' };
    if (seat < 0 || seat >= prev.spieler) return { ok: false, error: 'Diesen Sitz gibt es nicht.' };
    const meister = meisterVon(prev);
    const binMeister = seat === meister;
    const state = cloneState(prev);

    if (prev.phase === 'waehlen') {
      if (move.typ !== 'waehle')
        return { ok: false, error: 'Zuerst wählt der Rätselmeister ein Rätsel.' };
      if (!binMeister) return { ok: false, error: 'Nur der Rätselmeister wählt das Rätsel.' };
      let id: number;
      if (move.raetsel === null) {
        const frei = BLACK_STORIES.filter((r) => !prev.benutzt.includes(r.id));
        const pool = frei.length > 0 ? frei : BLACK_STORIES;
        id = (pool[nextInt(state.rng, pool.length)] as BlackStory).id;
      } else {
        if (!raetsel(move.raetsel)) return { ok: false, error: 'Dieses Rätsel gibt es nicht.' };
        if (prev.benutzt.includes(move.raetsel))
          return { ok: false, error: 'Dieses Rätsel wurde schon gespielt.' };
        id = move.raetsel;
      }
      state.raetsel = id;
      state.benutzt = [...state.benutzt, id];
      state.phase = 'raten';
      state.log = pushLog(state.log, {
        seat,
        text: `legt das Rätsel „${raetsel(id)?.titel ?? ''}" auf den Tisch.`,
      });
      return { ok: true, state };
    }

    switch (move.typ) {
      case 'waehle':
        return { ok: false, error: 'Das Rätsel liegt schon auf dem Tisch.' };

      case 'frage': {
        if (binMeister) return { ok: false, error: 'Der Rätselmeister stellt keine Fragen.' };
        if (offeneFragen(prev, seat) >= BS_MAX_OFFENE_FRAGEN)
          return {
            ok: false,
            error: `Höchstens ${BS_MAX_OFFENE_FRAGEN} offene Fragen – warte auf Antworten.`,
          };
        if (prev.fragen.length >= MAX_FRAGEN)
          return { ok: false, error: 'Genug gefragt – Zeit für einen Lösungsversuch.' };
        state.fragen = [
          ...state.fragen,
          { id: state.naechsteId, seat, text: move.text, antwort: null },
        ];
        state.naechsteId += 1;
        state.log = pushLog(state.log, { seat, text: `fragt: „${move.text}"` });
        return { ok: true, state };
      }

      case 'antwort': {
        if (!binMeister) return { ok: false, error: 'Nur der Rätselmeister antwortet.' };
        const frage = state.fragen.find((f) => f.id === move.frage);
        if (!frage) return { ok: false, error: 'Diese Frage gibt es nicht.' };
        if (frage.antwort !== null)
          return { ok: false, error: 'Diese Frage ist schon beantwortet.' };
        frage.antwort = move.antwort;
        state.log = pushLog(state.log, {
          seat,
          text: `antwortet „${BS_ANTWORT_TEXT[move.antwort]}" auf „${frage.text}"`,
        });
        return { ok: true, state };
      }

      case 'muendlich': {
        if (!binMeister)
          return { ok: false, error: 'Nur der Rätselmeister zählt mündliche Fragen.' };
        if (state.muendlich[move.antwort] >= MAX_MUENDLICH)
          return { ok: false, error: 'Der Zähler ist voll.' };
        state.muendlich[move.antwort] += 1;
        state.log = pushLog(state.log, {
          seat,
          text: `beantwortet eine mündliche Frage mit „${BS_ANTWORT_TEXT[move.antwort]}".`,
        });
        return { ok: true, state };
      }

      case 'loesung': {
        if (binMeister) return { ok: false, error: 'Der Rätselmeister kennt die Lösung schon.' };
        if (offenerVersuch(prev, seat))
          return { ok: false, error: 'Dein letzter Versuch ist noch nicht bewertet.' };
        if (prev.versuche.length >= MAX_VERSUCHE)
          return { ok: false, error: 'Zu viele Versuche in dieser Runde.' };
        state.versuche = [
          ...state.versuche,
          { id: state.naechsteId, seat, text: move.text, urteil: null },
        ];
        state.naechsteId += 1;
        state.log = pushLog(state.log, { seat, text: `wagt eine Lösung: „${move.text}"` });
        return { ok: true, state };
      }

      case 'bewerte': {
        if (!binMeister) return { ok: false, error: 'Nur der Rätselmeister bewertet Lösungen.' };
        const versuch = state.versuche.find((v) => v.id === move.versuch);
        if (!versuch) return { ok: false, error: 'Diesen Lösungsversuch gibt es nicht.' };
        if (versuch.urteil !== null)
          return { ok: false, error: 'Dieser Versuch ist schon bewertet.' };
        versuch.urteil = move.urteil;
        state.log = pushLog(state.log, {
          seat: versuch.seat,
          text: `liegt mit der Lösung ${URTEIL_TEXT[move.urteil]}.`,
        });
        if (move.urteil === 'richtig') rundeEnde(state, versuch.seat);
        return { ok: true, state };
      }

      case 'geloest': {
        if (!binMeister)
          return { ok: false, error: 'Nur der Rätselmeister erklärt ein Rätsel für gelöst.' };
        if (move.sitz === meister || move.sitz >= prev.spieler)
          return { ok: false, error: 'Nur ein Rater kann das Rätsel lösen.' };
        state.log = pushLog(state.log, { seat: move.sitz, text: 'hat das Rätsel gelöst!' });
        rundeEnde(state, move.sitz);
        return { ok: true, state };
      }

      case 'aufloesen': {
        if (!binMeister) return { ok: false, error: 'Nur der Rätselmeister löst auf.' };
        state.log = pushLog(state.log, { seat, text: 'löst auf – niemand ist draufgekommen.' });
        rundeEnde(state, null);
        return { ok: true, state };
      }
    }
    return { ok: false, error: 'Unbekannter Zug.' };
  },

  outcome(state) {
    if (state.phase !== 'ende') return null;
    const best = Math.max(...state.punkte);
    const winners = state.punkte.flatMap((p, i) => (p === best ? [i] : []));
    const summary =
      best === 0
        ? 'Kein einziger Punkt – die Geheimnisse blieben dunkel.'
        : winners.length === 1
          ? `Mit ${best} ${best === 1 ? 'Punkt' : 'Punkten'} vorn.`
          : `Gleichstand mit je ${best} ${best === 1 ? 'Punkt' : 'Punkten'}.`;
    return { winners, summary, scores: [...state.punkte] };
  },

  view(state, seat) {
    const meister = meisterVon(state);
    const binMeister = seat !== null && seat === meister && state.phase !== 'ende';
    const r = state.raetsel === null ? undefined : raetsel(state.raetsel);
    const letztesErgebnis = state.ergebnisse[state.ergebnisse.length - 1];
    const letztesRaetsel = letztesErgebnis ? raetsel(letztesErgebnis.raetsel) : undefined;
    return {
      phase: state.phase,
      runde: state.runde,
      runden: state.runden,
      spieler: state.spieler,
      meister,
      meinSitz: seat,
      binMeister,
      karte: r ? karte(r) : null,
      loesung: binMeister && r ? r.loesung : null,
      auswahl:
        binMeister && state.phase === 'waehlen'
          ? BLACK_STORIES.filter((x) => !state.benutzt.includes(x.id)).map(karte)
          : null,
      fragen: state.fragen.map((f) => ({ ...f })),
      versuche: state.versuche.map((v) => ({ ...v })),
      muendlich: { ...state.muendlich },
      fragenGesamt: fragenGesamt(state),
      punkte: [...state.punkte],
      letzte:
        letztesErgebnis && letztesRaetsel
          ? {
              ...karte(letztesRaetsel),
              loesung: letztesRaetsel.loesung,
              runde: letztesErgebnis.runde,
              meister: letztesErgebnis.meister,
              geloestVon: letztesErgebnis.geloestVon,
              meisterPunkt: letztesErgebnis.meisterPunkt,
              fragen: letztesErgebnis.fragen,
            }
          : null,
    };
  },

  log(state) {
    return state.log.slice(-50);
  },
};
