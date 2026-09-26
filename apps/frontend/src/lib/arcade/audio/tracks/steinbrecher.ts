import { type Note, type Section, type Track } from '../types';

/**
 * „Mauerbrecher" – treibendes Stück in a-Moll. Die Melodie hämmert in
 * Achteln wie ein Ball gegen die Mauer, der C-Teil zerfällt in schnelle
 * Arpeggien – so klingt es, wenn eine ganze Reihe auf einmal fällt.
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

/** Ein halber Takt Bass: Grundton und Oktave im Achtelwechsel. */
const halfPump = (root: number): Note[] => [
  [root, 2],
  [root + 12, 2],
  [root, 2],
  [root + 12, 2],
];
const pump = (root: number): Note[] => [...halfPump(root), ...halfPump(root)];

const A = 45;
const D = 38;
const F = 41;
const E = 40;
const C = 36;
const G = 43;

const melodyA = seq(`
  A4:2 C5:2 E5:2 A5:2 G5:2 E5:2 C5:2 E5:2
  D5:2 F5:2 A5:2 F5:2 E5:4 r:4
  A4:2 C5:2 E5:2 A5:2 B5:2 A5:2 G5:2 E5:2
  F5:2 E5:2 D5:2 B4:2 C5:4 A4:4
`);

const melodyB = seq(`
  F5:4 E5:2 D5:2 C5:4 D5:4
  E5:2 E5:2 G5:2 E5:2 D5:4 C5:4
  F5:4 A5:2 G5:2 F5:4 E5:4
  D5:2 E5:2 F5:2 G#5:2 A5:8
`);

const melodyC = seq(`
  A5:1 E5:1 C5:1 E5:1 A5:1 E5:1 C5:1 E5:1 A5:1 E5:1 C5:1 E5:1 A5:1 E5:1 C5:1 E5:1
  G5:1 D5:1 B4:1 D5:1 G5:1 D5:1 B4:1 D5:1 G5:1 D5:1 B4:1 D5:1 G5:1 D5:1 B4:1 D5:1
  F5:1 C5:1 A4:1 C5:1 F5:1 C5:1 A4:1 C5:1 F5:1 C5:1 A4:1 C5:1 F5:1 C5:1 A4:1 C5:1
  E5:2 G#5:2 B5:2 E6:2 r:8
`);

const bassA: Section = [...pump(A), ...pump(D), ...pump(A), ...halfPump(F), ...halfPump(E)];
const bassB: Section = [...pump(F), ...pump(C), ...pump(D), ...pump(E)];
const bassC: Section = [...pump(A), ...pump(G), ...pump(F), ...pump(E)];

export const track: Track = {
  title: 'Mauerbrecher',
  bpm: 148,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k.h.s.h.k.h.s.h.', 'k.h.s.h.k.k.s.hh'],
  gain: 0.8,
};
