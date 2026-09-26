/**
 * Sicht und Züge von Monopoly, wie sie `@palantir/arcade` liefert bzw. erwartet.
 *
 * Das Paket exportiert nur das Register, nicht die spielinternen Typen; hier
 * steht deshalb ihr Abbild. Weicht die Regel-Datei ab, fällt das beim
 * Spielen sofort auf (die Sicht ist reines JSON).
 */

export type FeldTyp =
  | 'los'
  | 'strasse'
  | 'bahnhof'
  | 'werk'
  | 'steuer'
  | 'ereignis'
  | 'gemeinschaft'
  | 'gefaengnis'
  | 'parken'
  | 'gehGefaengnis';

export interface Feld {
  name: string;
  typ: FeldTyp;
  gruppe: number;
  preis: number;
  hauspreis: number;
  miete: number[];
  steuer: number;
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

export interface MonopolyOptionen {
  startgeld: number;
  versteigerung: boolean;
  freiParkenTopf: boolean;
  rundenlimit: number;
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

export interface MonopolyAktionen {
  wuerfeln: boolean;
  freikaufen: boolean;
  karteNutzen: boolean;
  kaufen: boolean;
  ablehnen: boolean;
  bieten: boolean;
  passen: boolean;
  bezahlen: boolean;
  aufgeben: boolean;
  zugEnde: boolean;
  handel: boolean;
  handelAntwort: boolean;
  bauen: number[];
  verkaufen: number[];
  hypothek: number[];
  abloesen: number[];
}

export interface SpielerSicht {
  geld: number;
  pos: number;
  gefaengnis: boolean;
  versuche: number;
  freiKarten: number;
  bankrott: boolean;
  vermoegen: number;
}

export interface MonopolyView {
  felder: Feld[];
  optionen: MonopolyOptionen;
  spieler: SpielerSicht[];
  besitzer: (number | null)[];
  haeuser: number[];
  hypothek: boolean[];
  am: number;
  phase: Phase;
  runde: number;
  zugNr: number;
  wuerfel: [number, number] | null;
  paschNochmal: boolean;
  kaufFeld: number | null;
  versteigerung: {
    feld: number;
    gebot: number;
    bieter: number | null;
    reihenfolge: number[];
    aktiv: number[];
    dran: number;
  } | null;
  mindestGebot: number;
  schuld: { von: number; an: number | null; betrag: number; grund: string } | null;
  angebot: Angebot | null;
  letzteKarte: {
    stapel: 'ereignis' | 'gemeinschaft';
    text: string;
    seat: number;
    zugNr: number;
  } | null;
  topf: number;
  bankHaeuser: number;
  bankHotels: number;
  letzteBewegung: { seat: number; von: number; nach: number } | null;
  letztes: { nr: number; arten: EreignisArt[] };
  sieger: number[] | null;
  aktionen: MonopolyAktionen;
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
