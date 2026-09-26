/**
 * Sicht und Züge von UNO, wie sie `packages/arcade/src/games/uno.ts` liefert.
 *
 * Das Paket exportiert nur das Register, nicht die Typen je Spiel. Die Form
 * steht deshalb hier noch einmal; ändert sich die Sicht, zeigt der Typcheck
 * spätestens beim Zugriff im Brett, wo nachzuziehen ist.
 */

export type UnoColor = 'rot' | 'gelb' | 'gruen' | 'blau';
export type UnoKind = 'zahl' | 'aussetzen' | 'richtung' | 'plus2' | 'farbwahl' | 'plus4';

export interface UnoCard {
  id: number;
  farbe: UnoColor | 'schwarz';
  art: UnoKind;
  zahl: number;
}

export interface UnoOptions {
  stapeln: boolean;
  punktspiel: boolean;
}

export type UnoMove =
  | { type: 'legen'; karte: number; farbe: UnoColor | null; uno: boolean }
  | { type: 'ziehen' }
  | { type: 'behalten' }
  | { type: 'erwischt' }
  | { type: 'weiter' };

export interface UnoView {
  players: number;
  mySeat: number | null;
  hand: UnoCard[];
  handCounts: number[];
  top: UnoCard;
  farbe: UnoColor | null;
  richtung: 1 | -1;
  am: number;
  phase: 'legen' | 'gezogen' | 'ende';
  gezogen: number | null;
  strafe: number;
  stapelAnzahl: number;
  ablageAnzahl: number;
  unoOffen: number | null;
  darfErwischen: boolean;
  gerufen: boolean[];
  options: UnoOptions;
  punkte: number[];
  runde: number;
  letzteRunde: { sieger: number; punkte: number } | null;
  spielbar: number[];
  zuege: number;
  sieger: number[] | null;
}

export const COLOR_NAMES: Record<UnoColor, string> = {
  rot: 'Rot',
  gelb: 'Gelb',
  gruen: 'Grün',
  blau: 'Blau',
};

export const UNO_COLORS: readonly UnoColor[] = ['rot', 'gelb', 'gruen', 'blau'];
