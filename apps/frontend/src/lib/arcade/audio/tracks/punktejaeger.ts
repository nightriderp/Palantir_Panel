import { type Note, type Section, type Track } from '../types';

/**
 * „Pillenhüpfer" – hüpfendes Stück in C-Dur. Kurze, abgesetzte Töne wie
 * Schritte durchs Labyrinth; der D-Teil klettert chromatisch hoch, als wäre
 * gerade eine Kraftpille verschluckt worden.
 */

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Kurzschrift für Noten: „E5:2 r:2 F#5:4" – Name mit Oktave (oder `r` für
 * Pause), Doppelpunkt, Länge in Sechzehnteln.
 */
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

/** Ein Takt Bass: federnder Sprung Grundton–Quinte–Oktave–Quinte. */
const hop = (root: number): Note[] => [
  [root, 2],
  [root + 7, 2],
  [root + 12, 2],
  [root + 7, 2],
  [root, 2],
  [root + 7, 2],
  [root + 12, 2],
  [root + 7, 2],
];

const bass = (...roots: number[]): Section => roots.flatMap(hop);

const C = 36;
const D = 38;
const F = 41;
const G = 43;
const A = 45;

const melodyA = seq(`
  C5:1 r:1 E5:1 r:1 G5:1 r:1 E5:1 r:1 C6:2 r:2 G5:2 r:2
  F5:1 r:1 A5:1 r:1 C6:1 r:1 A5:1 r:1 F5:4 r:4
  G5:1 r:1 B5:1 r:1 D6:1 r:1 B5:1 r:1 G5:2 A5:2 B5:2 r:2
  C6:2 G5:2 E5:2 G5:2 C6:4 r:4
`);

const melodyB = seq(`
  E5:2 F5:2 G5:3 r:1 E5:2 F5:2 G5:4
  A5:2 G5:2 F5:2 E5:2 D5:4 r:4
  D5:2 E5:2 F5:3 r:1 D5:2 E5:2 F5:4
  G5:2 F5:2 E5:2 D5:2 C5:4 r:4
`);

const melodyC = seq(`
  A5:1 r:1 A5:1 r:1 G5:1 r:1 A5:1 r:1 C6:2 A5:2 G5:2 E5:2
  F5:1 r:1 F5:1 r:1 E5:1 r:1 F5:1 r:1 A5:4 r:4
  G5:1 r:1 G5:1 r:1 F#5:1 r:1 G5:1 r:1 B5:2 D6:2 B5:2 G5:2
  C6:1 r:1 B5:1 r:1 C6:1 r:1 D6:1 r:1 E6:4 r:4
`);

const melodyD = seq(`
  C5:1 C#5:1 D5:1 D#5:1 E5:2 r:2 E5:1 F5:1 F#5:1 G5:1 G5:2 r:2
  G5:1 G#5:1 A5:1 A#5:1 B5:2 r:2 C6:4 r:4
  B5:1 r:1 A5:1 r:1 G5:1 r:1 F5:1 r:1 E5:1 r:1 D5:1 r:1 C5:2 r:2
  G4:2 C5:2 E5:2 G5:2 C6:2 r:2 C5:2 r:2
`);

export const track: Track = {
  title: 'Pillenhüpfer',
  bpm: 152,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC, melodyD],
  bass: [bass(C, F, G, C), bass(C, A, D, G), bass(C, F, G, C), bass(F, F, G, C), bass(C, G, G, C)],
  drums: ['k.hhs.h.k.hhs.hh', 'k.hhs.h.kkhhs.h.'],
  gain: 0.8,
};
