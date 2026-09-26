/**
 * Sicht und Züge des Schachbretts – Spiegel von `SchachView`/`SchachMove` aus
 * `@palantir/arcade`. Das Paket exportiert nur das Register, nicht die Typen
 * einzelner Spiele; die Form ist hier deshalb bewusst nachgebildet.
 */

export interface SchachOutcome {
  winners: number[];
  summary: string;
}

export interface SchachView {
  /** 64 Zeichen a1 … h8, FEN-Buchstaben (Weiß groß), `.` = leer. */
  board: string;
  side: 0 | 1;
  lastMove: [number, number] | null;
  checkSquare: number;
  legal: [number, number][];
  captured: [string, string];
  san: string[];
  drawOffer: number | null;
  result: SchachOutcome | null;
}

export type SchachPromotion = 'q' | 'r' | 'b' | 'n';

export type SchachMove =
  | { type: 'zug'; from: number; to: number; promotion?: SchachPromotion }
  | { type: 'aufgeben' }
  | { type: 'remis-anbieten' }
  | { type: 'remis-annehmen' };
