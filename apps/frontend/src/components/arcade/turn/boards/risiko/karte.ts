/**
 * Eigene, grob gezeichnete Weltkarte für das Risiko-Brett.
 *
 * Bewusst keine echten Küstenlinien: Jedes Land ist ein Vieleck aus wenigen
 * Punkten, gerade so, dass man die Welt wiedererkennt. Nachbarländer teilen
 * sich Eckpunkte exakt – daran erkennt das Brett, welche Nachbarschaften über
 * Land laufen und welche es als gestrichelte Seeverbindung zeichnen muss.
 *
 * Die Reihenfolge entspricht der Länderliste der Regeln (`risiko-karte.ts` im
 * Paket `@palantir/arcade`).
 */

export const MAP_W = 1000;
export const MAP_H = 560;

type Pt = readonly [number, number];

// Ein Land je Zeile – so liest sich der Block fast wie die Karte selbst.
// prettier-ignore
export const POLYGONS: readonly (readonly Pt[])[] = [
  // Nordamerika
  [[30, 60], [80, 45], [115, 55], [115, 125], [80, 140], [45, 130], [25, 100]],
  [[115, 55], [160, 40], [210, 45], [255, 55], [260, 110], [235, 113], [200, 115], [170, 119], [115, 125]],
  [[290, 30], [350, 15], [410, 25], [400, 70], [360, 95], [320, 80]],
  [[80, 140], [115, 125], [170, 119], [175, 190], [105, 195], [90, 170]],
  [[170, 119], [200, 115], [235, 113], [260, 110], [265, 130], [245, 190], [200, 190], [175, 190]],
  [[265, 130], [300, 110], [330, 130], [325, 175], [295, 195], [245, 190]],
  [[105, 195], [175, 190], [200, 190], [205, 262], [180, 268], [120, 262], [100, 230]],
  [[200, 190], [245, 190], [295, 195], [290, 230], [260, 255], [235, 270], [205, 262]],
  [[120, 262], [180, 268], [205, 262], [235, 270], [215, 300], [235, 330], [220, 345], [185, 315], [140, 290]],
  // Südamerika
  [[220, 345], [235, 330], [290, 335], [320, 355], [290, 375], [240, 380]],
  [[240, 380], [290, 375], [280, 430], [255, 450], [235, 420]],
  [[290, 375], [320, 355], [370, 380], [360, 430], [310, 460], [280, 430]],
  [[255, 450], [280, 430], [310, 460], [290, 510], [270, 545], [255, 520]],
  // Europa
  [[420, 90], [450, 82], [465, 98], [445, 112], [420, 106]],
  [[500, 50], [540, 40], [570, 60], [560, 110], [540, 140], [515, 130], [505, 100]],
  [[440, 140], [460, 125], [475, 140], [470, 180], [445, 185], [435, 165]],
  [[490, 160], [540, 140], [575, 160], [590, 190], [545, 200], [520, 215], [500, 200], [480, 185]],
  [[480, 185], [500, 200], [520, 215], [505, 245], [490, 275], [455, 270], [450, 230], [460, 200]],
  [[520, 215], [545, 200], [590, 190], [600, 225], [590, 250], [560, 260], [530, 275], [510, 265], [505, 245]],
  [[540, 140], [560, 110], [570, 60], [610, 50], [650, 70], [665, 120], [660, 180], [650, 210], [640, 230], [600, 225], [590, 190], [575, 160]],
  // Afrika
  [[440, 300], [490, 290], [530, 295], [545, 330], [530, 370], [500, 400], [470, 390], [445, 350]],
  [[530, 295], [590, 290], [610, 320], [580, 335], [545, 330]],
  [[545, 330], [580, 335], [610, 320], [640, 350], [620, 400], [590, 440], [565, 420], [560, 385], [530, 370]],
  [[500, 400], [530, 370], [560, 385], [565, 420], [540, 440], [510, 430]],
  [[510, 430], [540, 440], [565, 420], [590, 440], [570, 500], [540, 520], [515, 480]],
  [[610, 450], [625, 440], [635, 470], [620, 500], [605, 485]],
  // Asien
  [[650, 70], [700, 55], [720, 90], [730, 145], [745, 165], [738, 172], [715, 150], [680, 170], [665, 120]],
  [[700, 55], [760, 40], [780, 70], [770, 130], [790, 135], [790, 175], [745, 165], [730, 145], [720, 90]],
  [[760, 40], [840, 35], [850, 75], [800, 85], [780, 70]],
  [[780, 70], [800, 85], [850, 75], [855, 120], [810, 135], [790, 135], [770, 130]],
  [[840, 35], [920, 30], [970, 50], [960, 100], [900, 95], [855, 120], [850, 75]],
  [[790, 135], [810, 135], [855, 120], [900, 95], [895, 150], [850, 175], [790, 175]],
  [[930, 120], [950, 115], [960, 150], [945, 190], [925, 180], [935, 150]],
  [[665, 120], [680, 170], [715, 150], [738, 172], [720, 215], [680, 230], [650, 210], [660, 180]],
  [[745, 165], [790, 175], [850, 175], [870, 220], [830, 260], [780, 265], [745, 240], [720, 215], [738, 172]],
  [[600, 225], [640, 230], [650, 210], [680, 230], [700, 270], [670, 300], [640, 350], [610, 320], [590, 290], [590, 250]],
  [[680, 230], [720, 215], [745, 240], [760, 290], [730, 340], [705, 300], [700, 270]],
  [[745, 240], [780, 265], [800, 300], [785, 340], [760, 290]],
  // Australien
  [[770, 370], [810, 360], [840, 380], [810, 395], [775, 390]],
  [[870, 355], [920, 350], [940, 375], [900, 385], [870, 375]],
  [[810, 420], [860, 405], [880, 440], [870, 500], [820, 500], [800, 460]],
  [[860, 405], [910, 410], [950, 450], [930, 510], [870, 500], [880, 440]],
];

export const POLYGON_POINTS: readonly string[] = POLYGONS.map((poly) =>
  poly.map(([x, y]) => `${x},${y}`).join(' '),
);

/** Schwerpunkt eines Vielecks – dort sitzt das Armee-Abzeichen. */
function centroid(poly: readonly Pt[]): Pt {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const [x0, y0] = poly[i] ?? [0, 0];
    const [x1, y1] = poly[(i + 1) % poly.length] ?? [0, 0];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (area === 0) return poly[0] ?? [0, 0];
  return [Math.round(cx / (3 * area)), Math.round(cy / (3 * area))];
}

/** Handverschobene Abzeichen, wo der Schwerpunkt ungünstig liegt. */
const CENTER_OVERRIDES: Record<number, Pt> = {
  8: [185, 285],
  19: [615, 130],
  35: [640, 270],
};

export const CENTERS: readonly Pt[] = POLYGONS.map(
  (poly, i) => CENTER_OVERRIDES[i] ?? centroid(poly),
);

function sharesVertex(a: readonly Pt[], b: readonly Pt[]): boolean {
  return a.some(([x, y]) => b.some(([u, v]) => u === x && v === y));
}

/**
 * Seeverbindungen: Nachbarn, deren Flächen sich nicht berühren. `wrap` markiert
 * die Verbindung über den Kartenrand (Alaska – Kamtschatka).
 */
export function seaLinks(
  adjacency: readonly (readonly number[])[],
): { a: number; b: number; wrap: boolean }[] {
  const out: { a: number; b: number; wrap: boolean }[] = [];
  adjacency.forEach((list, a) => {
    for (const b of list) {
      if (b <= a) continue;
      const pa = POLYGONS[a];
      const pb = POLYGONS[b];
      if (!pa || !pb || sharesVertex(pa, pb)) continue;
      const ca = CENTERS[a] ?? [0, 0];
      const cb = CENTERS[b] ?? [0, 0];
      out.push({ a, b, wrap: Math.abs(ca[0] - cb[0]) > MAP_W / 2 });
    }
  });
  return out;
}
