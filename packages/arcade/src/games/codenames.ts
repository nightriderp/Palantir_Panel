/**
 * Codenames – zwei Teams, 25 Begriffe, ein Schlüssel, den nur die Chefs sehen.
 *
 * Ab vier Sitzen spielen Rot und Blau gegeneinander. Mit zwei oder drei Sitzen
 * gibt es kein zweites Team, deshalb läuft dann die kooperative Variante
 * „Gemeinsam gegen die Uhr": Ein Team sucht seine neun Begriffe, und nach jeder
 * Runde deckt die Uhr einen gegnerischen Begriff auf. Nach neun Runden ist
 * Schluss.
 *
 * Es gibt keinen Computergegner – Hinweise geben und deuten braucht Sprache.
 */

import { type RngState, createRng, nextInt, shuffled } from '../rng.js';
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
import {
  type CodenamesKategorie,
  CODENAMES_KATEGORIEN,
  codenamesWoerter,
} from './codenames-woerter.js';

export type CnTeam = 'rot' | 'blau';
export type CnRolle = 'chef' | 'agent';
export type CnFarbe = CnTeam | 'passant' | 'attentaeter';
export type CnAnzahl = number | 'unbegrenzt';

export interface CnSitz {
  team: CnTeam;
  rolle: CnRolle;
}

export interface CnOptions {
  /** Team und Rolle je Sitz; `null` = automatisch (abwechselnd, Erster eines Teams ist Chef). */
  teams: CnSitz[] | null;
  kategorie: CodenamesKategorie | 'alle';
}

export interface CnHinweis {
  team: CnTeam;
  seat: number;
  wort: string;
  anzahl: CnAnzahl;
}

export interface CnState {
  version: 1;
  modus: 'teams' | 'koop';
  woerter: string[];
  schluessel: CnFarbe[];
  /** Je Feld: `null` verdeckt, sonst Sitz, der getippt hat, oder -1 für die Uhr (Koop). */
  aufgedeckt: (number | null)[];
  sitze: CnSitz[];
  startTeam: CnTeam;
  amZug: CnTeam;
  phase: 'hinweis' | 'raten' | 'ende';
  hinweis: CnHinweis | null;
  /** Verbleibende Tipps im Zug; `null` = unbegrenzt. */
  tippsUebrig: number | null;
  tippsInZug: number;
  hinweise: CnHinweis[];
  /** Koop: abgeschlossene Runden. */
  runde: number;
  rundenLimit: number;
  /** Siegerteam; im Koop `rot` = gemeinsam gewonnen, `null` bei `ende` = verloren. */
  sieger: CnTeam | null;
  grund: string;
  letzte: number | null;
  rng: RngState;
  log: TurnLogEntry[];
}

export type CnMove =
  | { typ: 'hinweis'; wort: string; anzahl: CnAnzahl }
  | { typ: 'tipp'; feld: number }
  | { typ: 'passen' };

export interface CnKarte {
  wort: string;
  /** Farbe – bei verdeckten Karten nur für Chefs (und nach Spielende). */
  farbe: CnFarbe | null;
  aufgedeckt: boolean;
  /** Wer aufgedeckt hat: Sitz, -1 = die Uhr, `null` = noch verdeckt. */
  von: number | null;
}

export interface CnView {
  modus: 'teams' | 'koop';
  phase: 'hinweis' | 'raten' | 'ende';
  karten: CnKarte[];
  sitze: CnSitz[];
  meinSitz: number | null;
  /** Sieht diese Sicht den Schlüssel? */
  schluesselSichtbar: boolean;
  startTeam: CnTeam;
  amZug: CnTeam;
  hinweis: CnHinweis | null;
  tippsUebrig: number | null;
  tippsInZug: number;
  hinweise: CnHinweis[];
  /** Noch verdeckte Begriffe je Team – auch am echten Tisch öffentlich. */
  rest: Record<CnTeam, number>;
  gesamt: Record<CnTeam, number>;
  runde: number;
  rundenLimit: number;
  sieger: CnTeam | null;
  grund: string;
  letzte: number | null;
}

export const CN_FELDER = 25;
export const CN_KOOP_RUNDEN = 9;
export const CN_TEAM_NAME: Record<CnTeam, string> = { rot: 'Rot', blau: 'Blau' };
const FARB_NAME: Record<CnFarbe, string> = {
  rot: 'Rot',
  blau: 'Blau',
  passant: 'ein Passant',
  attentaeter: 'der Attentäter',
};

function anderes(team: CnTeam): CnTeam {
  return team === 'rot' ? 'blau' : 'rot';
}

/** Kleinbuchstaben, Umlaute ausgeschrieben – für den Vergleich Hinweis ↔ Begriff. */
export function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/é/g, 'e')
    .replace(/-/g, '');
}

/** Vorgabe: abwechselnd Rot/Blau, der erste Sitz eines Teams ist Chef; Koop: Sitz 0 ist Chef. */
export function autoTeams(players: number): CnSitz[] {
  if (players < 4) {
    return Array.from({ length: players }, (_, i) => ({
      team: 'rot',
      rolle: i === 0 ? 'chef' : 'agent',
    }));
  }
  return Array.from({ length: players }, (_, i) => ({
    team: i % 2 === 0 ? 'rot' : 'blau',
    rolle: i < 2 ? 'chef' : 'agent',
  }));
}

/** Prüft eine Teamaufstellung; liefert eine deutsche Begründung oder `null`, wenn sie passt. */
export function teamsFehler(teams: readonly CnSitz[]): string | null {
  if (teams.length < 4) {
    const chefs = teams.filter((s) => s.rolle === 'chef').length;
    if (chefs !== 1) return 'Im Zusammenspiel braucht es genau einen Chef.';
    if (teams.length - chefs < 1) return 'Es braucht mindestens einen Agenten.';
    return null;
  }
  for (const team of ['rot', 'blau'] as const) {
    const mitglieder = teams.filter((s) => s.team === team);
    const chefs = mitglieder.filter((s) => s.rolle === 'chef').length;
    if (chefs !== 1) return `Team ${CN_TEAM_NAME[team]} braucht genau einen Chef.`;
    if (mitglieder.length - chefs < 1)
      return `Team ${CN_TEAM_NAME[team]} braucht mindestens einen Agenten.`;
  }
  return null;
}

function parseAnzahl(value: unknown): CnAnzahl | null {
  if (value === 'unbegrenzt') return 'unbegrenzt';
  return intIn(value, 0, 9);
}

/**
 * Prüft einen Hinweis gegen die sichtbaren Begriffe. Liefert eine deutsche
 * Begründung oder `null`. Exportiert, damit die Oberfläche dieselbe Prüfung
 * vor dem Senden zeigen kann.
 */
export function hinweisFehler(wort: string, sichtbar: readonly string[]): string | null {
  if (/\s/.test(wort)) return 'Der Hinweis muss ein einziges Wort sein.';
  if (wort.length < 2 || wort.length > 30) return 'Der Hinweis braucht 2 bis 30 Zeichen.';
  if (!/^[\p{L}][\p{L}-]*$/u.test(wort)) return 'Der Hinweis darf nur aus Buchstaben bestehen.';
  const h = normalisiere(wort);
  for (const begriff of sichtbar) {
    const b = normalisiere(begriff);
    if (h === b) return `„${begriff}" liegt selbst auf dem Tisch.`;
    if (h.includes(b)) return `Der Hinweis enthält „${begriff}".`;
    if (b.includes(h)) return `Der Hinweis steckt in „${begriff}".`;
  }
  return null;
}

function unaufgedeckt(state: CnState, farbe: CnFarbe): number {
  let n = 0;
  for (let i = 0; i < state.schluessel.length; i += 1) {
    if (state.schluessel[i] === farbe && state.aufgedeckt[i] === null) n += 1;
  }
  return n;
}

function beende(state: CnState, sieger: CnTeam | null, grund: string): void {
  state.phase = 'ende';
  state.sieger = sieger;
  state.grund = grund;
  state.hinweis = null;
  state.tippsUebrig = null;
  state.log = pushLog(state.log, { seat: null, text: grund });
}

/** Zug oder Runde ist vorbei: Teams wechseln, im Koop tickt die Uhr. */
function zugEnde(state: CnState): void {
  state.hinweis = null;
  state.tippsUebrig = null;
  state.tippsInZug = 0;
  if (state.modus === 'teams') {
    state.amZug = anderes(state.amZug);
    state.phase = 'hinweis';
    state.log = pushLog(state.log, {
      seat: null,
      text: `Team ${CN_TEAM_NAME[state.amZug]} ist am Zug.`,
    });
    return;
  }
  const gegner: number[] = [];
  state.schluessel.forEach((f, i) => {
    if (f === 'blau' && state.aufgedeckt[i] === null) gegner.push(i);
  });
  if (gegner.length > 0) {
    const feld = gegner[nextInt(state.rng, gegner.length)] as number;
    state.aufgedeckt[feld] = -1;
    state.letzte = feld;
    state.log = pushLog(state.log, {
      seat: null,
      text: `Die Uhr tickt: „${state.woerter[feld] ?? ''}" wird von der Gegenseite aufgedeckt.`,
    });
  }
  state.runde += 1;
  if (state.runde >= state.rundenLimit) {
    beende(
      state,
      null,
      `Die Zeit ist abgelaufen – ${unaufgedeckt(state, 'rot')} Begriffe fehlten noch.`,
    );
    return;
  }
  state.phase = 'hinweis';
}

export const game: TurnGame<CnState, CnMove, CnOptions, CnView> = {
  kind: 'turn',
  id: 'codenames',
  version: 1,
  minPlayers: 2,
  maxPlayers: 10,
  defaultOptions: { teams: null, kategorie: 'alle' },
  hiddenInformation: true,

  parseOptions(raw) {
    if (raw === undefined || raw === null) return { teams: null, kategorie: 'alle' };
    if (!isRecord(raw)) return null;
    let kategorie: CnOptions['kategorie'] = 'alle';
    if (raw.kategorie !== undefined) {
      if (raw.kategorie !== 'alle' && !CODENAMES_KATEGORIEN.some((k) => k.id === raw.kategorie))
        return null;
      kategorie = raw.kategorie as CnOptions['kategorie'];
    }
    let teams: CnSitz[] | null = null;
    if (raw.teams !== undefined && raw.teams !== null) {
      if (!Array.isArray(raw.teams) || raw.teams.length < 2 || raw.teams.length > 10) return null;
      teams = [];
      for (const eintrag of raw.teams as unknown[]) {
        if (!isRecord(eintrag)) return null;
        if (eintrag.team !== 'rot' && eintrag.team !== 'blau') return null;
        if (eintrag.rolle !== 'chef' && eintrag.rolle !== 'agent') return null;
        teams.push({ team: eintrag.team, rolle: eintrag.rolle });
      }
      // Im Zusammenspiel gibt es nur ein Team – die Farbe wird vereinheitlicht.
      if (teams.length < 4) teams = teams.map((s) => ({ team: 'rot', rolle: s.rolle }));
      if (teamsFehler(teams) !== null) return null;
    }
    return { teams, kategorie };
  },

  setup({ players, seed, options }) {
    const rng = createRng(seed);
    const koop = players < 4;
    const pool = codenamesWoerter(options.kategorie);
    const woerter = shuffled(rng, pool).slice(0, CN_FELDER);
    const startTeam: CnTeam = koop ? 'rot' : nextInt(rng, 2) === 0 ? 'rot' : 'blau';
    const farben: CnFarbe[] = [
      ...Array<CnFarbe>(9).fill(startTeam),
      ...Array<CnFarbe>(8).fill(anderes(startTeam)),
      ...Array<CnFarbe>(7).fill('passant'),
      'attentaeter',
    ];
    const schluessel = shuffled(rng, farben);
    const sitze =
      options.teams && options.teams.length === players && teamsFehler(options.teams) === null
        ? options.teams.map((s) => ({ team: koop ? ('rot' as const) : s.team, rolle: s.rolle }))
        : autoTeams(players);
    const text = koop
      ? `Gemeinsam gegen die Uhr: 9 Begriffe in ${CN_KOOP_RUNDEN} Runden.`
      : `Team ${CN_TEAM_NAME[startTeam]} beginnt und sucht 9 Begriffe.`;
    return {
      version: 1,
      modus: koop ? 'koop' : 'teams',
      woerter,
      schluessel,
      aufgedeckt: Array<number | null>(CN_FELDER).fill(null),
      sitze,
      startTeam,
      amZug: startTeam,
      phase: 'hinweis',
      hinweis: null,
      tippsUebrig: null,
      tippsInZug: 0,
      hinweise: [],
      runde: 0,
      rundenLimit: CN_KOOP_RUNDEN,
      sieger: null,
      grund: '',
      letzte: null,
      rng,
      log: [{ seat: null, text }],
    };
  },

  activeSeats(state) {
    if (state.phase === 'ende') return [];
    const rolle: CnRolle = state.phase === 'hinweis' ? 'chef' : 'agent';
    const seats: number[] = [];
    state.sitze.forEach((s, i) => {
      if (s.rolle === rolle && (state.modus === 'koop' || s.team === state.amZug)) seats.push(i);
    });
    return seats;
  },

  parseMove(raw) {
    if (!isRecord(raw)) return null;
    switch (raw.typ) {
      case 'hinweis': {
        const wort = textUpTo(raw.wort, 30);
        const anzahl = parseAnzahl(raw.anzahl);
        if (wort === null || anzahl === null) return null;
        return { typ: 'hinweis', wort, anzahl };
      }
      case 'tipp': {
        const feld = intIn(raw.feld, 0, CN_FELDER - 1);
        return feld === null ? null : { typ: 'tipp', feld };
      }
      case 'passen':
        return { typ: 'passen' };
      default:
        return null;
    }
  },

  applyMove(prev, seat, move): MoveResult<CnState> {
    if (prev.phase === 'ende') return { ok: false, error: 'Die Partie ist vorbei.' };
    const sitz = prev.sitze[seat];
    if (!sitz) return { ok: false, error: 'Diesen Sitz gibt es nicht.' };
    const imTeam = prev.modus === 'koop' || sitz.team === prev.amZug;
    const state = cloneState(prev);

    if (move.typ === 'hinweis') {
      if (prev.phase !== 'hinweis')
        return { ok: false, error: 'Der Hinweis steht schon – jetzt wird geraten.' };
      if (sitz.rolle !== 'chef' || !imTeam)
        return { ok: false, error: 'Nur der Chef des Teams am Zug gibt den Hinweis.' };
      const sichtbar = prev.woerter.filter((_, i) => prev.aufgedeckt[i] === null);
      const fehler = hinweisFehler(move.wort, sichtbar);
      if (fehler) return { ok: false, error: fehler };
      const hinweis: CnHinweis = { team: prev.amZug, seat, wort: move.wort, anzahl: move.anzahl };
      state.hinweis = hinweis;
      state.hinweise = [...state.hinweise, hinweis].slice(-30);
      state.tippsUebrig = move.anzahl === 'unbegrenzt' ? null : move.anzahl + 1;
      state.tippsInZug = 0;
      state.phase = 'raten';
      const zahl = move.anzahl === 'unbegrenzt' ? 'unbegrenzt' : String(move.anzahl);
      state.log = pushLog(state.log, { seat, text: `gibt den Hinweis „${move.wort}" – ${zahl}.` });
      return { ok: true, state };
    }

    if (prev.phase !== 'raten') return { ok: false, error: 'Erst braucht es einen Hinweis.' };
    if (sitz.rolle !== 'agent' || !imTeam)
      return { ok: false, error: 'Nur die Agenten des Teams am Zug raten.' };

    if (move.typ === 'passen') {
      state.log = pushLog(state.log, { seat, text: 'passt.' });
      zugEnde(state);
      return { ok: true, state };
    }

    const feld = move.feld;
    if (prev.aufgedeckt[feld] !== null)
      return { ok: false, error: 'Dieser Begriff ist schon aufgedeckt.' };
    const farbe = prev.schluessel[feld] as CnFarbe;
    state.aufgedeckt[feld] = seat;
    state.letzte = feld;
    state.tippsInZug += 1;
    state.log = pushLog(state.log, {
      seat,
      text: `tippt auf „${prev.woerter[feld] ?? ''}" – ${FARB_NAME[farbe]}${farbe === 'attentaeter' ? '!' : '.'}`,
    });
    const team = prev.amZug;

    if (farbe === 'attentaeter') {
      if (state.modus === 'koop')
        beende(state, null, 'Der Attentäter wurde enttarnt – die Mission ist gescheitert.');
      else
        beende(
          state,
          anderes(team),
          `Team ${CN_TEAM_NAME[team]} erwischt den Attentäter – Team ${CN_TEAM_NAME[anderes(team)]} gewinnt.`,
        );
      return { ok: true, state };
    }
    if (farbe === team) {
      if (unaufgedeckt(state, team) === 0) {
        beende(
          state,
          team,
          state.modus === 'koop'
            ? `Alle neun Begriffe gefunden – nach ${state.runde + 1} von ${state.rundenLimit} Runden!`
            : `Team ${CN_TEAM_NAME[team]} hat alle Begriffe gefunden und gewinnt.`,
        );
        return { ok: true, state };
      }
      if (state.tippsUebrig !== null) {
        state.tippsUebrig -= 1;
        if (state.tippsUebrig <= 0) zugEnde(state);
      }
      return { ok: true, state };
    }
    if (state.modus === 'teams' && farbe === anderes(team) && unaufgedeckt(state, farbe) === 0) {
      beende(
        state,
        farbe,
        `Team ${CN_TEAM_NAME[team]} deckt den letzten Begriff von ${CN_TEAM_NAME[farbe]} auf – ${CN_TEAM_NAME[farbe]} gewinnt.`,
      );
      return { ok: true, state };
    }
    zugEnde(state);
    return { ok: true, state };
  },

  outcome(state) {
    if (state.phase !== 'ende') return null;
    const scores = state.sitze.map((s) => {
      const team = state.modus === 'koop' ? 'rot' : s.team;
      return state.schluessel.filter(
        (f, i) => f === team && state.aufgedeckt[i] !== null && state.aufgedeckt[i] !== -1,
      ).length;
    });
    if (state.sieger === null) return { winners: [], summary: state.grund, scores };
    const winners = state.sitze.flatMap((s, i) =>
      state.modus === 'koop' || s.team === state.sieger ? [i] : [],
    );
    return { winners, summary: state.grund, scores };
  },

  view(state, seat) {
    const eigener = seat === null ? undefined : state.sitze[seat];
    const schluesselSichtbar = state.phase === 'ende' || eigener?.rolle === 'chef';
    const karten: CnKarte[] = state.woerter.map((wort, i) => {
      const von = state.aufgedeckt[i] ?? null;
      const offen = von !== null;
      return {
        wort,
        farbe: offen || schluesselSichtbar ? (state.schluessel[i] ?? null) : null,
        aufgedeckt: offen,
        von,
      };
    });
    const zaehle = (team: CnTeam) => state.schluessel.filter((f) => f === team).length;
    return {
      modus: state.modus,
      phase: state.phase,
      karten,
      sitze: state.sitze.map((s) => ({ ...s })),
      meinSitz: seat,
      schluesselSichtbar,
      startTeam: state.startTeam,
      amZug: state.amZug,
      hinweis: state.hinweis ? { ...state.hinweis } : null,
      tippsUebrig: state.tippsUebrig,
      tippsInZug: state.tippsInZug,
      hinweise: state.hinweise.slice(-12).map((h) => ({ ...h })),
      rest: { rot: unaufgedeckt(state, 'rot'), blau: unaufgedeckt(state, 'blau') },
      gesamt: { rot: zaehle('rot'), blau: zaehle('blau') },
      runde: state.runde,
      rundenLimit: state.rundenLimit,
      sieger: state.sieger,
      grund: state.grund,
      letzte: state.letzte,
    };
  },

  log(state) {
    return state.log.slice(-50);
  },
};
