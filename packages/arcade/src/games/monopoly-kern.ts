/**
 * Monopoly – Zustand, Züge und reine Hilfsfunktionen, die Regeln, Sicht und
 * Computergegner gemeinsam brauchen (Miete, Bauregeln, Hypotheken, Handel).
 */

import { type RngState } from '../rng.js';
import { type TurnLogEntry } from '../turn.js';
import { BAHNHOEFE, FELDER, GRUPPEN, WERKE, kaeuflich, type StapelName } from './monopoly-daten.js';

export interface MonopolyOptionen {
  startgeld: number;
  /** Abgelehnte Grundstücke werden versteigert. */
  versteigerung: boolean;
  /** Steuern und Strafen landen im Topf, Frei Parken räumt ihn ab. */
  freiParkenTopf: boolean;
  /** 0 = aus; sonst endet die Partie nach so vielen Runden, das höchste Vermögen gewinnt. */
  rundenlimit: number;
}

export interface Spieler {
  geld: number;
  pos: number;
  gefaengnis: boolean;
  /** Fehlversuche, im Gefängnis einen Pasch zu würfeln. */
  versuche: number;
  /** Gefängnisfrei-Karten, jeweils mit dem Stapel, aus dem sie stammen. */
  freiKarten: StapelName[];
  bankrott: boolean;
}

export interface Schuld {
  von: number;
  /** `null` = Bank. */
  an: number | null;
  betrag: number;
  grund: string;
  /** Geht bei Zahlung an die Bank in den Frei-Parken-Topf (Steuern, Strafen). */
  topf: boolean;
}

/** Was nach dem Begleichen aller Schulden mit dem Spieler am Zug passiert. */
export type Weiter = { art: 'zugEnde' } | { art: 'bewegen'; schritte: number };

export interface Versteigerung {
  feld: number;
  gebot: number;
  bieter: number | null;
  /** Feste Bietreihenfolge (Sitze), beginnend beim Sitz nach dem Ablehnenden. */
  reihenfolge: number[];
  /** Sitze, die noch mitbieten. */
  aktiv: number[];
  dran: number;
}

export interface Angebot {
  von: number;
  an: number;
  gebeFelder: number[];
  nehmeFelder: number[];
  gebeGeld: number;
  nehmeGeld: number;
  gebeKarten: number;
  nehmeKarten: number;
}

export type Phase =
  'wuerfeln' | 'kaufen' | 'versteigerung' | 'zahlen' | 'zugEnde' | 'handel' | 'ende';

export type EreignisArt =
  | 'wuerfel'
  | 'kauf'
  | 'karte'
  | 'miete'
  | 'bau'
  | 'gefaengnis'
  | 'bankrott'
  | 'handel'
  | 'gebot'
  | 'geld'
  | 'zug'
  | 'ende';

export interface MonopolyZustand {
  version: 1;
  optionen: MonopolyOptionen;
  spieler: Spieler[];
  besitzer: (number | null)[];
  haeuser: number[];
  hypothek: boolean[];
  am: number;
  phase: Phase;
  runde: number;
  /** Zählt die Züge (Spielerwechsel) – verknüpft z. B. die gezogene Karte mit dem Zug. */
  zugNr: number;
  wuerfel: [number, number] | null;
  paschZahl: number;
  paschNochmal: boolean;
  kaufFeld: number | null;
  versteigerung: Versteigerung | null;
  schulden: Schuld[];
  weiter: Weiter;
  angebot: Angebot | null;
  /** Phase, in die nach einem Handelsangebot zurückgekehrt wird. */
  rueckPhase: Phase | null;
  handelZahl: number;
  stapel: { ereignis: number[]; gemeinschaft: number[] };
  letzteKarte: { stapel: StapelName; id: number; seat: number; zugNr: number } | null;
  topf: number;
  bankHaeuser: number;
  bankHotels: number;
  letzteBewegung: { seat: number; von: number; nach: number } | null;
  /** Was der letzte Zug ausgelöst hat – die Oberfläche spielt passende Geräusche. */
  letztes: { nr: number; arten: EreignisArt[] };
  log: TurnLogEntry[];
  rng: RngState;
  sieger: number[] | null;
  endeText: string | null;
}

export type MonopolyZug =
  | { type: 'wuerfeln' }
  | { type: 'freikaufen' }
  | { type: 'karteNutzen' }
  | { type: 'kaufen' }
  | { type: 'ablehnen' }
  | { type: 'bieten'; betrag: number }
  | { type: 'passen' }
  | { type: 'bauen'; feld: number }
  | { type: 'verkaufen'; feld: number }
  | { type: 'hypothek'; feld: number }
  | { type: 'abloesen'; feld: number }
  | ({ type: 'handel' } & Omit<Angebot, 'von'>)
  | { type: 'handelAnnehmen' }
  | { type: 'handelAblehnen' }
  | { type: 'bezahlen' }
  | { type: 'aufgeben' }
  | { type: 'zugEnde' };

export const MINDEST_SCHRITT = 10;
export const MAX_HANDEL_PRO_ZUG = 3;

export function lebende(s: MonopolyZustand): number[] {
  return s.spieler.flatMap((p, i) => (p.bankrott ? [] : [i]));
}

export function gruppeVon(feld: number): readonly number[] {
  const g = FELDER[feld]?.gruppe ?? -1;
  return g >= 0 ? (GRUPPEN[g] ?? []) : [];
}

export function besitztGruppe(s: MonopolyZustand, seat: number, gruppe: number): boolean {
  const felder = GRUPPEN[gruppe] ?? [];
  return felder.length > 0 && felder.every((f) => s.besitzer[f] === seat);
}

export function gruppeHatHaeuser(s: MonopolyZustand, feld: number): boolean {
  return gruppeVon(feld).some((f) => (s.haeuser[f] ?? 0) > 0);
}

export function anzahlIn(s: MonopolyZustand, seat: number, felder: readonly number[]): number {
  return felder.filter((f) => s.besitzer[f] === seat).length;
}

export function hypothekWert(feld: number): number {
  return Math.floor((FELDER[feld]?.preis ?? 0) / 2);
}

/** Ablösen kostet den Hypothekenwert plus 10 % Zinsen (aufgerundet). */
export function abloeseBetrag(feld: number): number {
  const h = hypothekWert(feld);
  return h + Math.ceil(h / 10);
}

/**
 * Miete für `feld`. `augen` ist die Augensumme (für Werke); die Kartenwirkung
 * „doppelte Bahnhofsmiete" bzw. „Werk ×10" kommt über `mod`.
 */
export function miete(
  s: MonopolyZustand,
  feld: number,
  augen: number,
  mod: { bahnhofDoppelt?: boolean; werkZehn?: boolean } = {},
): number {
  const f = FELDER[feld];
  const owner = s.besitzer[feld];
  if (!f || owner === null || owner === undefined || s.hypothek[feld]) return 0;
  if (f.typ === 'strasse') {
    const h = s.haeuser[feld] ?? 0;
    if (h > 0) return f.miete[h] ?? 0;
    const basis = f.miete[0] ?? 0;
    return besitztGruppe(s, owner, f.gruppe) ? basis * 2 : basis;
  }
  if (f.typ === 'bahnhof') {
    const n = anzahlIn(s, owner, BAHNHOEFE);
    const m = 25 * 2 ** Math.max(0, n - 1);
    return mod.bahnhofDoppelt ? m * 2 : m;
  }
  if (f.typ === 'werk') {
    const n = anzahlIn(s, owner, WERKE);
    return (mod.werkZehn || n >= 2 ? 10 : 4) * augen;
  }
  return 0;
}

/** Fehlertext oder `null`, wenn `seat` auf `feld` ein Haus (bzw. das Hotel) bauen darf. */
export function kannBauen(s: MonopolyZustand, seat: number, feld: number): string | null {
  const f = FELDER[feld];
  if (!f || f.typ !== 'strasse') return 'Bauen geht nur auf Straßen.';
  if (s.besitzer[feld] !== seat) return 'Die Straße gehört dir nicht.';
  if (!besitztGruppe(s, seat, f.gruppe)) return 'Dafür brauchst du die ganze Farbgruppe.';
  const gruppe = gruppeVon(feld);
  if (gruppe.some((g) => s.hypothek[g])) return 'In der Farbgruppe liegt noch eine Hypothek.';
  const h = s.haeuser[feld] ?? 0;
  if (h >= 5) return 'Hier steht schon ein Hotel.';
  const min = Math.min(...gruppe.map((g) => s.haeuser[g] ?? 0));
  if (h > min) return 'Gleichmäßig bauen: erst die anderen Straßen der Gruppe.';
  if ((s.spieler[seat]?.geld ?? 0) < f.hauspreis) return 'Dafür reicht dein Geld nicht.';
  if (h === 4 && s.bankHotels <= 0) return 'Die Bank hat keine Hotels mehr.';
  if (h < 4 && s.bankHaeuser <= 0) return 'Die Bank hat keine Häuser mehr.';
  return null;
}

export function kannVerkaufen(s: MonopolyZustand, seat: number, feld: number): string | null {
  const f = FELDER[feld];
  if (!f || f.typ !== 'strasse' || s.besitzer[feld] !== seat) return 'Die Straße gehört dir nicht.';
  const h = s.haeuser[feld] ?? 0;
  if (h <= 0) return 'Hier steht nichts zum Verkaufen.';
  const max = Math.max(...gruppeVon(feld).map((g) => s.haeuser[g] ?? 0));
  if (h < max) return 'Gleichmäßig verkaufen: erst die höher bebauten Straßen.';
  return null;
}

export function kannHypothek(s: MonopolyZustand, seat: number, feld: number): string | null {
  if (!kaeuflich(feld) || s.besitzer[feld] !== seat) return 'Das Grundstück gehört dir nicht.';
  if (s.hypothek[feld]) return 'Das Grundstück ist schon belastet.';
  if (gruppeHatHaeuser(s, feld)) return 'Verkaufe zuerst die Häuser der Farbgruppe.';
  return null;
}

export function kannAbloesen(s: MonopolyZustand, seat: number, feld: number): string | null {
  if (!kaeuflich(feld) || s.besitzer[feld] !== seat) return 'Das Grundstück gehört dir nicht.';
  if (!s.hypothek[feld]) return 'Auf dem Grundstück liegt keine Hypothek.';
  if ((s.spieler[seat]?.geld ?? 0) < abloeseBetrag(feld)) return 'Dafür reicht dein Geld nicht.';
  return null;
}

/** Vermögen: Bargeld + Grundstücke (belastet zum halben Wert) + Häuser zum Baupreis. */
export function vermoegen(s: MonopolyZustand, seat: number): number {
  const p = s.spieler[seat];
  if (!p || p.bankrott) return 0;
  let w = p.geld;
  FELDER.forEach((f, i) => {
    if (s.besitzer[i] !== seat) return;
    w += s.hypothek[i] ? Math.floor(f.preis / 2) : f.preis;
    w += (s.haeuser[i] ?? 0) * f.hauspreis;
  });
  return w;
}

/** Prüft ein Handelsangebot gegen den aktuellen Stand; Fehlertext oder `null`. */
export function pruefeAngebot(s: MonopolyZustand, a: Angebot): string | null {
  const von = s.spieler[a.von];
  const an = s.spieler[a.an];
  if (!von || !an || a.von === a.an) return 'Ungültiger Handelspartner.';
  if (von.bankrott || an.bankrott) return 'Mit bankrotten Spielern wird nicht gehandelt.';
  const alle = [...a.gebeFelder, ...a.nehmeFelder];
  if (new Set(alle).size !== alle.length) return 'Ein Grundstück steht doppelt im Angebot.';
  for (const f of a.gebeFelder) {
    if (!kaeuflich(f) || s.besitzer[f] !== a.von)
      return 'Du bietest ein Grundstück an, das dir nicht gehört.';
  }
  for (const f of a.nehmeFelder) {
    if (!kaeuflich(f) || s.besitzer[f] !== a.an)
      return 'Das gewünschte Grundstück gehört dem Partner nicht.';
  }
  if (alle.some((f) => gruppeHatHaeuser(s, f))) {
    return 'Grundstücke aus bebauten Farbgruppen lassen sich nicht handeln.';
  }
  if (a.gebeGeld > von.geld) return 'So viel Geld hast du nicht.';
  if (a.nehmeGeld > an.geld) return 'So viel Geld hat der Partner nicht.';
  if (a.gebeKarten > von.freiKarten.length) return 'So viele Freikarten hast du nicht.';
  if (a.nehmeKarten > an.freiKarten.length) return 'So viele Freikarten hat der Partner nicht.';
  const leer =
    alle.length === 0 &&
    a.gebeGeld === 0 &&
    a.nehmeGeld === 0 &&
    a.gebeKarten === 0 &&
    a.nehmeKarten === 0;
  if (leer) return 'Das Angebot ist leer.';
  return null;
}

/** Führt einen (geprüften) Handel aus – schreibt in `s`. */
export function handelAnwenden(s: MonopolyZustand, a: Angebot): void {
  const von = s.spieler[a.von];
  const an = s.spieler[a.an];
  if (!von || !an) return;
  for (const f of a.gebeFelder) s.besitzer[f] = a.an;
  for (const f of a.nehmeFelder) s.besitzer[f] = a.von;
  von.geld += a.nehmeGeld - a.gebeGeld;
  an.geld += a.gebeGeld - a.nehmeGeld;
  const kartenVon = von.freiKarten.splice(0, a.gebeKarten);
  const kartenAn = an.freiKarten.splice(0, a.nehmeKarten);
  an.freiKarten.push(...kartenVon);
  von.freiKarten.push(...kartenAn);
}
