/**
 * Zufall aus einem Startwert.
 *
 * Jede Spielregel in diesem Paket zieht ihren Zufall **ausschließlich** von
 * hier. Der Generatorzustand ist eine einzige Ganzzahl und liegt im
 * Spielzustand. So läuft dieselbe Partie im Browser und beim Nachrechnen im
 * Backend Zug für Zug gleich, und ein Online-Raum kann seinen Zustand als JSON
 * ablegen, ohne dass der Zufall verloren geht.
 *
 * `Math.random()` ist in `src/games` deshalb tabu. Ein Test prüft das.
 */

/** Serialisierbarer Zustand des Generators (mulberry32). */
export interface RngState {
  s: number;
}

/** Neuer Generator aus einem Startwert. */
export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Nächste Zahl in [0, 1). Schreibt den Zustand fort. */
export function nextRandom(rng: RngState): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Ganzzahl in [0, max). */
export function nextInt(rng: RngState, max: number): number {
  return Math.floor(nextRandom(rng) * max);
}

/** Würfel mit `sides` Seiten: 1 … sides. */
export function rollDie(rng: RngState, sides = 6): number {
  return nextInt(rng, sides) + 1;
}

/** Mischt eine Kopie des Arrays (Fisher-Yates). */
export function shuffled<T>(rng: RngState, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, i + 1);
    const tmp = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = tmp;
  }
  return copy;
}

/** Zufälliges Element; `undefined` bei leerem Array. */
export function pick<T>(rng: RngState, items: readonly T[]): T | undefined {
  if (items.length === 0) return undefined;
  return items[nextInt(rng, items.length)];
}

/** Funktion `() => number` über einem Generatorzustand, für Stellen, die das erwarten. */
export function randomFn(rng: RngState): () => number {
  return () => nextRandom(rng);
}

/**
 * Leitet aus mehreren Zahlen einen neuen Startwert ab (FNV-1a über die Werte).
 *
 * Gebraucht für den Zufall der Computergegner: Er hängt an Startwert, Zugnummer
 * und Sitz, damit ein Bot beim Nachrechnen denselben Zug wählt wie im Browser,
 * ohne den Zufall des Spiels selbst weiterzudrehen.
 */
export function deriveSeed(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const part of parts) {
    let v = part >>> 0;
    for (let i = 0; i < 4; i += 1) {
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      v >>>= 8;
    }
  }
  return h >>> 0;
}
