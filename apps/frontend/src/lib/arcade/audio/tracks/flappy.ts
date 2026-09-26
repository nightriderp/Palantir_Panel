import { type Note, type Section, type Track } from '../types';

/**
 * „Federleicht" – fröhliches Stück in G-Dur mit hüpfenden punktierten
 * Rhythmen, als hebe der Vogel bei jedem Flügelschlag kurz ab. Der Bass macht
 * Hm-ta wie eine kleine Tuba.
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

/** Ein Takt Hm-ta: Grundton, Pause, Quinte, Pause. */
const oompah = (root: number): Note[] => [
  [root, 2],
  [null, 2],
  [root + 7, 2],
  [null, 2],
  [root, 2],
  [null, 2],
  [root + 7, 2],
  [null, 2],
];

const G = 43;
const C = 36;
const E = 40;
const D = 38;
const A = 45;

const melodyA = seq(`
  G4:3 B4:1 D5:2 G5:2 E5:3 D5:1 B4:4
  C5:3 E5:1 G5:2 E5:2 D5:4 r:4
  G4:3 B4:1 D5:2 G5:2 A5:3 G5:1 E5:4
  F#5:2 E5:2 D5:2 A4:2 G4:8
`);

const melodyB = seq(`
  E5:2 E5:2 D5:2 E5:2 G5:4 E5:4
  D5:2 D5:2 C5:2 D5:2 F#5:4 D5:4
  C5:2 D5:2 E5:2 G5:2 A5:2 G5:2 E5:2 C5:2
  D5:12 r:4
`);

const melodyC = seq(`
  B5:1 A5:1 G5:1 D5:1 B5:1 A5:1 G5:1 D5:1 B5:1 A5:1 G5:1 D5:1 B5:1 A5:1 G5:1 D5:1
  C6:1 B5:1 A5:1 E5:1 C6:1 B5:1 A5:1 E5:1 C6:1 B5:1 A5:1 E5:1 C6:1 B5:1 A5:1 E5:1
  A5:2 G5:2 F#5:2 E5:2 D5:2 C5:2 B4:2 A4:2
  G4:4 D5:4 G5:8
`);

const bassA: Section = [G, C, E, D].flatMap(oompah);
const bassB: Section = [C, D, A, D].flatMap(oompah);
const bassC: Section = [G, A, D, G].flatMap(oompah);

export const track: Track = {
  title: 'Federleicht',
  bpm: 140,
  wave: 'triangle',
  bassWave: 'square',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k..h..s.k..h..s.', 'k..h..s.k.hh.ss.'],
  gain: 0.8,
};
