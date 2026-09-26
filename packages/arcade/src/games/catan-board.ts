/**
 * Catan – Brett-Geometrie und Aufbau.
 *
 * Das Brett ist fest: 19 Landfelder in axialen Hex-Koordinaten (Radius 2),
 * daraus 54 Kreuzungen und 72 Kanten. Die Geometrie wird beim Laden des
 * Moduls einmal berechnet und ist nicht Teil des Zustands – der Zustand führt
 * nur Arrays, deren Index die Nummer einer Kreuzung, Kante oder eines Feldes
 * ist. Die Reihenfolge ist sortiert und damit auf jedem Rechner gleich.
 *
 * Koordinaten der Kreuzungen sind ganzzahlig: `x` in Einheiten von √3/2,
 * `y` in Einheiten von 1/2 der Feldgröße (spitze Felder oben). So lassen sich
 * gemeinsame Ecken zweier Felder ohne Rundungsfehler zusammenlegen.
 */

import { type RngState, shuffled } from '../rng.js';

export const RES_COUNT = 5;
/** Rohstoffe: 0 Holz, 1 Lehm, 2 Wolle, 3 Getreide, 4 Erz; −1 = Wüste. */
export const RES_NAMES = ['Holz', 'Lehm', 'Wolle', 'Getreide', 'Erz'] as const;
export const DESERT = -1;

export interface HexCell {
  q: number;
  r: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Ecken eines Feldes (spitze Oberseite), im Uhrzeigersinn ab oben. */
const CORNERS: readonly Point[] = [
  { x: 0, y: -2 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: 0, y: 2 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

/** Axiale Nachbarrichtungen im Uhrzeigersinn ab Osten. */
const DIRS: readonly HexCell[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`catan: Index ${index} außerhalb.`);
  return value;
}

export interface Geometry {
  hexes: HexCell[];
  /** Kreuzungen je Feld, im Uhrzeigersinn ab der oberen Ecke. */
  hexVertices: number[][];
  hexNeighbors: number[][];
  vertices: Point[];
  vertexHexes: number[][];
  vertexEdges: number[][];
  vertexNeighbors: number[][];
  edges: [number, number][];
  /** Küstenkanten (gehören zu genau einem Feld), rundum geordnet. */
  coast: number[];
  /** Felder in Spiralfolge (außen im Uhrzeigersinn, dann innen, dann Mitte). */
  spiral: number[];
}

function buildGeometry(): Geometry {
  const hexes: HexCell[] = [];
  for (let r = -2; r <= 2; r += 1) {
    for (let q = -2; q <= 2; q += 1) {
      if (Math.abs(q + r) <= 2) hexes.push({ q, r });
    }
  }
  const hexIndex = (q: number, r: number): number => hexes.findIndex((h) => h.q === q && h.r === r);

  // Alle Ecken sammeln, doppelte über den ganzzahligen Schlüssel zusammenlegen.
  const keyOf = (p: Point): string => `${p.x},${p.y}`;
  const unique = new Map<string, Point>();
  const cornerPoints = hexes.map((h) =>
    CORNERS.map((c) => {
      const p = { x: 2 * h.q + h.r + c.x, y: 3 * h.r + c.y };
      unique.set(keyOf(p), p);
      return p;
    }),
  );
  const vertices = [...unique.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  const vIndex = new Map(vertices.map((p, i) => [keyOf(p), i]));
  const hexVertices = cornerPoints.map((ps) => ps.map((p) => vIndex.get(keyOf(p)) ?? -1));

  const edgeKeys = new Map<string, [number, number]>();
  for (const vs of hexVertices) {
    for (let i = 0; i < 6; i += 1) {
      const a = at(vs, i);
      const b = at(vs, (i + 1) % 6);
      const pair: [number, number] = a < b ? [a, b] : [b, a];
      edgeKeys.set(`${pair[0]}-${pair[1]}`, pair);
    }
  }
  const edges = [...edgeKeys.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const vertexHexes: number[][] = vertices.map(() => []);
  hexVertices.forEach((vs, h) => vs.forEach((v) => at(vertexHexes, v).push(h)));
  const vertexEdges: number[][] = vertices.map(() => []);
  const vertexNeighbors: number[][] = vertices.map(() => []);
  const edgeHexCount = edges.map(() => 0);
  edges.forEach(([a, b], e) => {
    at(vertexEdges, a).push(e);
    at(vertexEdges, b).push(e);
    at(vertexNeighbors, a).push(b);
    at(vertexNeighbors, b).push(a);
    for (const vs of hexVertices)
      if (vs.includes(a) && vs.includes(b)) edgeHexCount[e] = (edgeHexCount[e] ?? 0) + 1;
  });

  const hexNeighbors = hexes.map((h) =>
    DIRS.map((d) => hexIndex(h.q + d.q, h.r + d.r)).filter((i) => i >= 0),
  );

  // Küste rundum ordnen, damit Häfen gleichmäßig verteilt werden können.
  const coast = edges
    .map((_, e) => e)
    .filter((e) => edgeHexCount[e] === 1)
    .map((e) => {
      const [a, b] = at(edges, e);
      const pa = at(vertices, a);
      const pb = at(vertices, b);
      const mx = ((pa.x + pb.x) / 2) * Math.sqrt(3);
      const my = pa.y + pb.y;
      return { e, angle: Math.atan2(my, mx) };
    })
    .sort((a, b) => a.angle - b.angle)
    .map((c) => c.e);

  const spiral: number[] = [];
  for (let ring = 2; ring >= 1; ring -= 1) {
    let q = 0;
    let r = -ring;
    for (const d of DIRS) {
      for (let step = 0; step < ring; step += 1) {
        spiral.push(hexIndex(q, r));
        q += d.q;
        r += d.r;
      }
    }
  }
  spiral.push(hexIndex(0, 0));

  return {
    hexes,
    hexVertices,
    hexNeighbors,
    vertices,
    vertexHexes,
    vertexEdges,
    vertexNeighbors,
    edges,
    coast,
    spiral,
  };
}

export const GEO: Geometry = buildGeometry();

/** Punkte für die Wahrscheinlichkeit eines Zahlenchips (2 und 12 → 1, 6 und 8 → 5). */
export function pips(num: number): number {
  return num >= 2 && num <= 12 && num !== 7 ? 6 - Math.abs(7 - num) : 0;
}

/** Zahlenfolge für die Spirale – rote 6/8 liegen darin nie nebeneinander. */
const SPIRAL_NUMBERS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

/**
 * Fester Einsteiger-Aufbau, zeilenweise von oben (3-4-5-4-3 Felder). Eigene
 * Anordnung: Jeder Rohstoff kommt in mehreren Ecken des Bretts vor, die
 * Wüste liegt in der Mitte.
 */
const BEGINNER_RES = [4, 2, 0, 3, 1, 2, 1, 3, 0, DESERT, 0, 4, 0, 4, 3, 2, 1, 3, 2];
const BEGINNER_PORTS = [-1, 2, -1, 4, -1, 3, 1, -1, 0];
const PORT_KINDS = [-1, -1, -1, -1, 0, 1, 2, 3, 4];
/** Häfen auf jeder dritten bzw. vierten Küstenkante (30 = 3·(3+3+4)). */
const PORT_SLOTS = [0, 3, 7, 10, 13, 17, 20, 23, 27];

export interface Port {
  edge: number;
  /** −1 = 3:1, sonst Rohstoff mit 2:1. */
  kind: number;
}

export interface Layout {
  hexRes: number[];
  hexNum: number[];
  ports: Port[];
}

function placeSpiral(hexRes: number[]): number[] {
  const hexNum = hexRes.map(() => 0);
  let k = 0;
  for (const h of GEO.spiral) {
    if (hexRes[h] === DESERT) continue;
    hexNum[h] = at(SPIRAL_NUMBERS, k);
    k += 1;
  }
  return hexNum;
}

/** Liegen zwei rote Zahlen (6/8) nebeneinander? */
export function redNeighbors(hexNum: readonly number[]): boolean {
  return GEO.hexNeighbors.some(
    (ns, h) =>
      (hexNum[h] === 6 || hexNum[h] === 8) && ns.some((n) => hexNum[n] === 6 || hexNum[n] === 8),
  );
}

export function makeLayout(kind: 'einsteiger' | 'zufall', rng: RngState): Layout {
  const ports = (kind === 'einsteiger' ? BEGINNER_PORTS : shuffled(rng, PORT_KINDS)).map(
    (k, i) => ({
      edge: at(GEO.coast, at(PORT_SLOTS, i)),
      kind: k,
    }),
  );
  if (kind === 'einsteiger')
    return { hexRes: [...BEGINNER_RES], hexNum: placeSpiral(BEGINNER_RES), ports };

  const hexRes = shuffled(rng, BEGINNER_RES);
  const numbers = [...SPIRAL_NUMBERS];
  // Zahlen frei mischen, bis keine roten Chips aneinanderstoßen. Die Schranke
  // ist nur Absicherung; im Mittel reichen wenige Versuche. Danach fällt der
  // Aufbau auf die Spirale zurück, die das von sich aus einhält.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const mixed = shuffled(rng, numbers);
    const hexNum = hexRes.map(() => 0);
    let k = 0;
    hexRes.forEach((res, h) => {
      if (res === DESERT) return;
      hexNum[h] = at(mixed, k);
      k += 1;
    });
    if (!redNeighbors(hexNum)) return { hexRes, hexNum, ports };
  }
  return { hexRes, hexNum: placeSpiral(hexRes), ports };
}

/** Häfen an einer Kreuzung (Arten), für Tauschkurse. */
export function portsAtVertex(ports: readonly Port[], v: number): number[] {
  return ports.filter((p) => at(GEO.edges, p.edge).includes(v)).map((p) => p.kind);
}

export { at };
