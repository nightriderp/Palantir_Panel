/**
 * Sicht und Züge von Black Stories für die Oberfläche.
 *
 * Spiegelt `packages/arcade/src/games/black-stories.ts` – das Paket
 * exportiert die Typen einzelner Spiele nicht. Ändert sich dort die Sicht,
 * muss sie hier mitziehen.
 */

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
  loesung: string | null;
  auswahl: BsKarte[] | null;
  fragen: BsFrage[];
  versuche: BsVersuch[];
  muendlich: Record<BsAntwort, number>;
  fragenGesamt: number;
  punkte: number[];
  letzte: BsAufloesung | null;
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

export const ANTWORTEN: { id: BsAntwort; text: string; klasse: string }[] = [
  { id: 'ja', text: 'Ja', klasse: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' },
  { id: 'nein', text: 'Nein', klasse: 'border-rose-500/50 bg-rose-500/15 text-rose-300' },
  {
    id: 'irrelevant',
    text: 'Irrelevant',
    klasse: 'border-zinc-500/50 bg-zinc-500/15 text-zinc-300',
  },
  { id: 'gut', text: 'Gute Frage!', klasse: 'border-amber-400/60 bg-amber-400/15 text-amber-200' },
];

export const URTEILE: { id: BsUrteil; text: string; klasse: string }[] = [
  {
    id: 'richtig',
    text: 'Richtig',
    klasse: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
  },
  { id: 'fast', text: 'Fast', klasse: 'border-amber-400/60 bg-amber-400/15 text-amber-200' },
  { id: 'falsch', text: 'Falsch', klasse: 'border-rose-500/50 bg-rose-500/15 text-rose-300' },
];

export const STUFE_NAME: Record<1 | 2 | 3, string> = { 1: 'leicht', 2: 'mittel', 3: 'schwer' };

/** Ab so vielen Fragen punktet auch der Meister – wie in den Regeln. */
export const FRAGEN_FUER_MEISTER = 20;
export const MAX_OFFENE_FRAGEN = 3;
