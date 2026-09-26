/**
 * Sicht, Züge und Hinweisprüfung von Codenames für die Oberfläche.
 *
 * Das Paket `@palantir/arcade` exportiert nur das Register, nicht die Typen
 * einzelner Spiele. Die Formen hier spiegeln `packages/arcade/src/games/
 * codenames.ts` – ändert sich dort die Sicht, muss sie hier mitziehen. Die
 * Hinweisprüfung ist dieselbe wie in den Regeln, damit der Chef den Fehler
 * schon beim Tippen sieht statt erst nach dem Senden.
 */

export type CnTeam = 'rot' | 'blau';
export type CnRolle = 'chef' | 'agent';
export type CnFarbe = CnTeam | 'passant' | 'attentaeter';
export type CnAnzahl = number | 'unbegrenzt';

export interface CnSitz {
  team: CnTeam;
  rolle: CnRolle;
}

export interface CnHinweis {
  team: CnTeam;
  seat: number;
  wort: string;
  anzahl: CnAnzahl;
}

export interface CnKarte {
  wort: string;
  farbe: CnFarbe | null;
  aufgedeckt: boolean;
  von: number | null;
}

export interface CnView {
  modus: 'teams' | 'koop';
  phase: 'hinweis' | 'raten' | 'ende';
  karten: CnKarte[];
  sitze: CnSitz[];
  meinSitz: number | null;
  schluesselSichtbar: boolean;
  startTeam: CnTeam;
  amZug: CnTeam;
  hinweis: CnHinweis | null;
  tippsUebrig: number | null;
  tippsInZug: number;
  hinweise: CnHinweis[];
  rest: Record<CnTeam, number>;
  gesamt: Record<CnTeam, number>;
  runde: number;
  rundenLimit: number;
  sieger: CnTeam | null;
  grund: string;
  letzte: number | null;
}

export type CnMove =
  | { typ: 'hinweis'; wort: string; anzahl: CnAnzahl }
  | { typ: 'tipp'; feld: number }
  | { typ: 'passen' };

export interface CnOptions {
  teams: CnSitz[] | null;
  kategorie: 'alle' | 'natur' | 'alltag' | 'orte' | 'wesen' | 'technik' | 'kultur';
}

export const CN_KATEGORIEN: { id: CnOptions['kategorie']; name: string }[] = [
  { id: 'alle', name: 'Alle Begriffe' },
  { id: 'natur', name: 'Natur & Tiere' },
  { id: 'alltag', name: 'Alltag & Küche' },
  { id: 'orte', name: 'Orte & Gebäude' },
  { id: 'wesen', name: 'Berufe & Wesen' },
  { id: 'technik', name: 'Technik & Werkzeug' },
  { id: 'kultur', name: 'Spiel, Sport & Kultur' },
];

function normalisiere(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/é/g, 'e')
    .replace(/-/g, '');
}

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

/** Vorgabe-Aufstellung – dieselbe Regel wie `autoTeams` in den Spielregeln. */
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
