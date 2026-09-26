/**
 * Sicht und Züge von Kniffel, wie sie `packages/arcade/src/games/kniffel.ts`
 * liefert. Das Paket exportiert die Typen je Spiel nicht, deshalb die Kopie.
 */

export interface KniffelOptions {
  extraKniffel: boolean;
}

export type KniffelMove =
  { type: 'wuerfeln'; halten: boolean[] } | { type: 'eintragen'; feld: number };

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
  vorschau: (number | null)[];
  letzter: { sitz: number; feld: number; punkte: number } | null;
  zuege: number;
  fertig: boolean;
}

export const FIELDS: readonly { name: string; hint: string }[] = [
  { name: 'Einser', hint: 'nur Einsen zählen' },
  { name: 'Zweier', hint: 'nur Zweien zählen' },
  { name: 'Dreier', hint: 'nur Dreien zählen' },
  { name: 'Vierer', hint: 'nur Vieren zählen' },
  { name: 'Fünfer', hint: 'nur Fünfen zählen' },
  { name: 'Sechser', hint: 'nur Sechsen zählen' },
  { name: 'Dreierpasch', hint: 'alle Augen' },
  { name: 'Viererpasch', hint: 'alle Augen' },
  { name: 'Full House', hint: '25' },
  { name: 'Kleine Straße', hint: '30' },
  { name: 'Große Straße', hint: '40' },
  { name: 'Kniffel', hint: '50' },
  { name: 'Chance', hint: 'alle Augen' },
];
