/**
 * Weltkarte für Risiko: 42 Länder in sechs Kontinenten.
 *
 * Die Reihenfolge der Länder ist die Kennung im Zustand (`owner[i]`,
 * `armies[i]`) und die Zeichenordnung im Frontend – sie darf sich deshalb nicht
 * ändern, ohne `version` hochzuzählen. Nachbarschaften stehen als Kantenliste
 * da, weil jede Kante so genau einmal geschrieben wird und die Symmetrie nicht
 * von Hand gepflegt werden muss.
 */

export interface RisikoContinent {
  name: string;
  bonus: number;
  members: number[];
}

export const TERRITORY_NAMES: readonly string[] = [
  // Nordamerika 0–8
  'Alaska',
  'Nordwest-Territorium',
  'Grönland',
  'Alberta',
  'Ontario',
  'Quebec',
  'Weststaaten',
  'Oststaaten',
  'Mittelamerika',
  // Südamerika 9–12
  'Venezuela',
  'Peru',
  'Brasilien',
  'Argentinien',
  // Europa 13–19
  'Island',
  'Skandinavien',
  'Großbritannien',
  'Nordeuropa',
  'Westeuropa',
  'Südeuropa',
  'Ukraine',
  // Afrika 20–25
  'Nordwestafrika',
  'Ägypten',
  'Ostafrika',
  'Kongo',
  'Südafrika',
  'Madagaskar',
  // Asien 26–37
  'Ural',
  'Sibirien',
  'Jakutien',
  'Irkutsk',
  'Kamtschatka',
  'Mongolei',
  'Japan',
  'Afghanistan',
  'China',
  'Mittlerer Osten',
  'Indien',
  'Siam',
  // Australien 38–41
  'Indonesien',
  'Neuguinea',
  'Westaustralien',
  'Ostaustralien',
];

export const TERRITORY_COUNT = TERRITORY_NAMES.length;

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i += 1) out.push(i);
  return out;
}

export const CONTINENTS: readonly RisikoContinent[] = [
  { name: 'Nordamerika', bonus: 5, members: range(0, 8) },
  { name: 'Südamerika', bonus: 2, members: range(9, 12) },
  { name: 'Europa', bonus: 5, members: range(13, 19) },
  { name: 'Afrika', bonus: 3, members: range(20, 25) },
  { name: 'Asien', bonus: 7, members: range(26, 37) },
  { name: 'Australien', bonus: 2, members: range(38, 41) },
];

/** Kontinent je Land. */
export const TERRITORY_CONTINENT: readonly number[] = (() => {
  const out = new Array<number>(TERRITORY_NAMES.length).fill(0);
  CONTINENTS.forEach((c, ci) => {
    for (const t of c.members) out[t] = ci;
  });
  return out;
})();

/** Jede Nachbarschaft genau einmal (Land- und Seeverbindungen). */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  // Nordamerika
  [0, 1],
  [0, 3],
  [0, 30], // Alaska – Kamtschatka über die Beringstraße
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 4],
  [2, 5],
  [2, 13], // Grönland – Island
  [3, 4],
  [3, 6],
  [4, 5],
  [4, 6],
  [4, 7],
  [5, 7],
  [6, 7],
  [6, 8],
  [7, 8],
  [8, 9],
  // Südamerika
  [9, 10],
  [9, 11],
  [10, 11],
  [10, 12],
  [11, 12],
  [11, 20], // Brasilien – Nordwestafrika
  // Europa
  [13, 14],
  [13, 15],
  [14, 15],
  [14, 16],
  [14, 19],
  [15, 16],
  [15, 17],
  [16, 17],
  [16, 18],
  [16, 19],
  [17, 18],
  [17, 20],
  [18, 19],
  [18, 20],
  [18, 21],
  [18, 35],
  [19, 26],
  [19, 33],
  [19, 35],
  // Afrika
  [20, 21],
  [20, 22],
  [20, 23],
  [21, 22],
  [21, 35],
  [22, 23],
  [22, 24],
  [22, 25],
  [22, 35],
  [23, 24],
  [24, 25],
  // Asien
  [26, 27],
  [26, 33],
  [26, 34],
  [27, 28],
  [27, 29],
  [27, 31],
  [27, 34],
  [28, 29],
  [28, 30],
  [29, 30],
  [29, 31],
  [30, 31],
  [30, 32],
  [31, 32],
  [31, 34],
  [33, 34],
  [33, 35],
  [33, 36],
  [34, 36],
  [34, 37],
  [35, 36],
  [36, 37],
  [37, 38], // Siam – Indonesien
  // Australien
  [38, 39],
  [38, 40],
  [39, 40],
  [39, 41],
  [40, 41],
];

/** Nachbarn je Land, aufsteigend sortiert. */
export const ADJACENCY: readonly (readonly number[])[] = (() => {
  const out: number[][] = TERRITORY_NAMES.map(() => []);
  for (const [a, b] of EDGES) {
    out[a]?.push(b);
    out[b]?.push(a);
  }
  for (const list of out) list.sort((x, y) => x - y);
  return out;
})();

export function isAdjacent(a: number, b: number): boolean {
  return ADJACENCY[a]?.includes(b) ?? false;
}
