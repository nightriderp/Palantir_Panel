import { type Note, type Section, type Track } from '../types';

/**
 * „Schlängelgroove" – lässiges Stück in a-Moll-Pentatonik. Die Melodie
 * schlängelt sich in kurzen Bögen auf und ab, der Bass springt in Oktaven wie
 * ein Schwanz, der hinterherwackelt.
 */

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Kurzschrift für Noten: „E5:2 r:2 F#5:4" – Name mit Oktave (oder `r` für
 * Pause), Doppelpunkt, Länge in Sechzehnteln. Liest sich beim Komponieren
 * leichter als MIDI-Zahlen.
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

/** Ein Takt Bass: Grundton, Oktave, Quinte und kleine Septime im Wechsel. */
const wiggle = (root: number): Note[] => [
  [root, 2],
  [root + 12, 2],
  [root, 2],
  [root + 7, 2],
  [root, 2],
  [root + 12, 2],
  [root + 7, 2],
  [root + 10, 2],
];

const bass = (...roots: number[]): Section => roots.flatMap(wiggle);

const A = 45;
const G = 43;
const C = 48;
const E = 40;
const F = 41;

const melodyA = seq(`
  A4:2 C5:2 r:1 A4:1 E5:2 D5:2 C5:2 A4:4
  G4:2 A4:2 r:2 C5:2 D5:3 C5:1 A4:4
  A4:2 C5:2 r:1 A4:1 E5:2 G5:2 E5:2 D5:4
  C5:2 D5:2 C5:2 A4:2 G4:4 r:4
`);

const melodyB = seq(`
  E5:3 D5:1 E5:2 G5:2 A5:4 G5:2 E5:2
  D5:3 C5:1 D5:2 E5:2 G5:4 r:4
  E5:3 D5:1 E5:2 G5:2 A5:2 C6:2 A5:2 G5:2
  E5:2 D5:2 C5:2 D5:2 E5:8
`);

const melodyC = seq(`
  F5:4 E5:2 C5:2 A4:4 C5:4
  G5:4 F5:2 D5:2 B4:4 D5:4
  E5:2 F5:2 G5:2 A5:2 G5:2 F5:2 E5:2 D5:2
  E5:6 r:2 G#4:4 B4:4
`);

const melodyD = seq(`
  A5:1 r:1 A5:1 r:1 G5:2 E5:2 r:2 D5:2 E5:4
  C5:2 D5:2 E5:2 G5:2 E5:4 D5:4
  A5:1 r:1 A5:1 r:1 G5:2 E5:2 r:2 C6:2 A5:4
  G5:2 E5:2 D5:2 C5:2 A4:8
`);

const bassA = bass(A, G, A, G);
const bassB = bass(C, G, A, E);
const bassC = bass(F, G, C, E);
const bassD = bass(A, C, A, A);

export const track: Track = {
  title: 'Schlängelgroove',
  bpm: 126,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC, melodyD, melodyB],
  bass: [bassA, bassB, bassA, bassC, bassD, bassB],
  drums: ['k..hs.h.k.khs.h.', 'k..hs.h.k..hs.hh'],
  gain: 0.8,
};
