import { type Note, type Section, type Track } from '../types';

/**
 * „Stapelwerk" – treibendes Stück in e-Moll. Gebrochene Akkorde in Achteln
 * klingen wie Steine, die Reihe um Reihe einrasten; der C-Teil lässt Luft,
 * bevor der D-Teil eine Oktave höher Druck macht.
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

/** Ein Takt Bass: stur pumpende Achtel zwischen Grundton und Oktave. */
const pump = (root: number): Note[] => [
  [root, 2],
  [root + 12, 2],
  [root, 2],
  [root + 12, 2],
  [root, 2],
  [root + 12, 2],
  [root, 2],
  [root + 12, 2],
];

const bass = (...roots: number[]): Section => roots.flatMap(pump);

const E = 40;
const D = 38;
const C = 36;
const B = 35;
const A = 33;
const G = 43;

const melodyA = seq(`
  E5:2 G5:2 B5:2 G5:2 A5:2 G5:2 F#5:2 E5:2
  D5:2 F#5:2 A5:2 F#5:2 G5:4 F#5:4
  E5:2 G5:2 B5:2 G5:2 C6:2 B5:2 A5:2 G5:2
  F#5:2 E5:2 D#5:2 F#5:2 E5:8
`);

const melodyB = seq(`
  C6:4 B5:2 A5:2 G5:4 E5:4
  A5:4 G5:2 F#5:2 E5:4 D5:4
  G5:2 A5:2 B5:4 D6:2 C6:2 B5:4
  A5:2 B5:2 C6:2 B5:2 A5:4 F#5:4
`);

const melodyC = seq(`
  E5:1 r:1 E5:1 r:1 E5:2 B4:2 r:4 D5:2 E5:2
  G5:1 r:1 G5:1 r:1 G5:2 D5:2 r:4 F#5:2 G5:2
  A5:1 r:1 A5:1 r:1 A5:2 E5:2 r:2 G5:2 A5:2 B5:2
  B5:4 A5:4 G5:4 F#5:4
`);

const melodyD = seq(`
  B5:2 E6:2 B5:2 G5:2 E5:2 G5:2 B5:2 E6:2
  D6:2 A5:2 F#5:2 A5:2 D6:4 C6:4
  C6:2 G5:2 E5:2 G5:2 C6:2 E6:2 D6:2 C6:2
  B5:4 D#6:4 E6:8
`);

export const track: Track = {
  title: 'Stapelwerk',
  bpm: 140,
  wave: 'square',
  bassWave: 'sawtooth',
  melody: [melodyA, melodyB, melodyA, melodyC, melodyD],
  bass: [
    bass(E, D, C, B),
    bass(C, A, G - 12, B),
    bass(E, D, C, B),
    bass(E, G - 12, A, B),
    bass(E, D, C, B),
  ],
  drums: ['k.h.s.h.k.h.s.h.', 'k.h.s.h.k.k.s.hs'],
  gain: 0.75,
};
