import { type Note, type Section, type Track } from '../types';

/**
 * „Die Formation" – düsterer Marsch in e-Moll. Der Bass schreitet in Vierteln
 * unerbittlich voran, die Melodie darüber klingt wie ein fernes Warnsignal.
 * Im C-Teil heult ein Alarm auf.
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

/** Ein Takt Marschbass: vier schwere Viertel. */
const march = (a: number, b: number, c: number, d: number): Note[] => [
  [a, 4],
  [b, 4],
  [c, 4],
  [d, 4],
];

const E2 = 40;
const G2 = 43;
const FS2 = 42;
const B1 = 35;
const A1 = 33;
const C2 = 36;
const D2 = 38;

const melodyA = seq(`
  E4:4 r:4 G4:2 F#4:2 E4:4
  B4:6 A4:2 G4:4 F#4:4
  E4:4 r:4 G4:2 A4:2 B4:4
  C5:4 B4:4 A4:4 F#4:4
`);

const melodyB = seq(`
  B4:2 B4:2 r:2 B4:2 C5:4 B4:4
  A4:2 A4:2 r:2 A4:2 B4:4 A4:4
  G4:2 A4:2 B4:2 D5:2 E5:4 D5:4
  B4:8 r:8
`);

const melodyC = seq(`
  E5:1 r:1 E5:1 r:1 E5:1 r:1 E5:1 r:1 E5:1 r:1 E5:1 r:1 E5:1 r:1 E5:1 r:1
  D#5:1 r:1 D#5:1 r:1 D#5:1 r:1 D#5:1 r:1 D#5:1 r:1 D#5:1 r:1 D#5:1 r:1 D#5:1 r:1
  E5:2 G5:2 F#5:2 D#5:2 E5:8
  r:16
`);

const bassA: Section = [
  ...march(E2, G2, FS2, B1),
  ...march(E2, G2, FS2, B1),
  ...march(E2, G2, FS2, B1),
  ...march(A1, C2, B1, B1),
];
const bassB: Section = [
  ...march(A1, C2, B1, E2),
  ...march(A1, C2, B1, E2),
  ...march(G2, FS2, E2, D2),
  ...march(B1, B1, FS2, B1),
];
const bassC: Section = [
  ...march(E2, E2, E2, E2),
  ...march(B1, B1, B1, B1),
  ...march(E2, G2, FS2, B1),
  ...march(E2, D2, C2, B1),
];

export const track: Track = {
  title: 'Die Formation',
  bpm: 112,
  wave: 'square',
  bassWave: 'sawtooth',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k...k...k...k...', 'k...k...k...k.s.'],
  gain: 0.7,
};
