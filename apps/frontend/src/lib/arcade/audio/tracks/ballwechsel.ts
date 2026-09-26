import { type Note, type Section, type Track } from '../types';

/**
 * „Hin und her" – verspieltes Stück in C-Dur mit viel Luft zwischen den
 * Tönen, wie der Ball zwischen zwei Schlägern. Im C-Teil springt die Melodie
 * zwischen zwei Oktaven hin und her.
 */

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Kurzschrift: „E5:2 r:2 F#5:4" – Note mit Oktave oder `r` für Pause, dann Länge in Sechzehnteln. */
function seq(text: string): Note[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token): Note => {
      const [name = '', len = '0'] = token.split(':');
      const duration = Number(len);
      if (name === 'r') return [null, duration];
      const match = /^([A-G])([#b]?)(\d)$/.exec(name);
      if (!match) throw new Error(`Unlesbare Note ${token}`);
      const [, letter = 'C', accidental, octave = '4'] = match;
      const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
      return [12 * (Number(octave) + 1) + (PITCH[letter] ?? 0) + shift, duration];
    });
}

/** Ein Takt Bass: Grundton und Quinte in Vierteln. */
const bounce = (root: number): Note[] => [
  [root, 4],
  [root + 7, 4],
  [root, 4],
  [root + 7, 4],
];

const C = 36;
const F = 41;
const G = 43;
const A = 45;
const D = 38;
const E = 40;

const melodyA = seq(`
  C5:2 r:2 G4:2 r:2 C5:2 E5:2 G5:4
  A5:2 r:2 G5:2 r:2 E5:2 C5:2 D5:4
  C5:2 r:2 G4:2 r:2 C5:2 E5:2 G5:2 C6:2
  B5:2 G5:2 D5:2 F5:2 E5:4 C5:4
`);

const melodyB = seq(`
  F5:3 E5:1 D5:2 C5:2 A4:4 C5:4
  G5:3 F5:1 E5:2 D5:2 B4:4 D5:4
  E5:2 F5:2 G5:2 A5:2 G5:2 F5:2 E5:2 D5:2
  C5:4 G4:4 C5:8
`);

const melodyC = seq(`
  E5:1 r:1 E6:1 r:1 E5:1 r:1 E6:1 r:1 E5:1 r:1 E6:1 r:1 E5:1 r:1 E6:1 r:1
  D5:1 r:1 D6:1 r:1 D5:1 r:1 D6:1 r:1 D5:1 r:1 D6:1 r:1 D5:1 r:1 D6:1 r:1
  C5:1 r:1 C6:1 r:1 C5:1 r:1 C6:1 r:1 C5:1 r:1 C6:1 r:1 C5:1 r:1 C6:1 r:1
  G4:2 B4:2 D5:2 F5:2 G5:8
`);

const bassA: Section = [C, A, C, G].flatMap(bounce);
const bassB: Section = [F, G, A, C].flatMap(bounce);
const bassC: Section = [E, D, C, G].flatMap(bounce);

export const track: Track = {
  title: 'Hin und her',
  bpm: 132,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k...s...k.k.s...', 'k...s...k...s.h.'],
  gain: 0.75,
};
