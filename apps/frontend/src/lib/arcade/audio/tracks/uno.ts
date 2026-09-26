import { type Note, type Section, type Track } from '../types';

/**
 * „Farbwechsel" – flottes Stück in C-Dur, hüpfend wie ein Kartenstapel, der
 * auf den Tisch klatscht. Der D-Teil lässt Lücken für die „UNO!"-Rufe am Tisch.
 */

/** Wechselbass Grundton–Quinte in Achteln, ein Takt. */
const alt = (root: number): Note[] => [
  [root, 2],
  [root + 7, 2],
  [root, 2],
  [root + 7, 2],
  [root, 2],
  [root + 7, 2],
  [root, 2],
  [root + 7, 2],
];

const C = 48;
const D = 50;
const F = 41;
const G = 43;
const A = 45;

// prettier-ignore -- ein Takt je Zeile
const melodyA: Section = [
  [72, 2],
  [76, 2],
  [79, 2],
  [76, 2],
  [72, 2],
  [76, 2],
  [79, 4],
  [81, 2],
  [79, 2],
  [77, 2],
  [76, 2],
  [74, 4],
  [null, 4],
  [71, 2],
  [74, 2],
  [77, 2],
  [74, 2],
  [71, 2],
  [74, 2],
  [77, 4],
  [79, 2],
  [77, 2],
  [76, 2],
  [74, 2],
  [72, 6],
  [null, 2],
];
const bassA: Section = [...alt(C), ...alt(D), ...alt(G), ...alt(C)];

// prettier-ignore -- ein Takt je Zeile
const melodyB: Section = [
  [76, 3],
  [76, 1],
  [77, 2],
  [79, 2],
  [81, 4],
  [79, 4],
  [77, 3],
  [77, 1],
  [76, 2],
  [74, 2],
  [76, 8],
  [74, 3],
  [74, 1],
  [76, 2],
  [77, 2],
  [79, 4],
  [84, 4],
  [83, 2],
  [81, 2],
  [79, 2],
  [77, 2],
  [79, 8],
];
const bassB: Section = [...alt(F), ...alt(C), ...alt(G), ...alt(G)];

// prettier-ignore -- ein Takt je Zeile
const melodyC: Section = [
  [69, 2],
  [72, 2],
  [76, 4],
  [74, 2],
  [72, 2],
  [71, 4],
  [69, 2],
  [71, 2],
  [72, 2],
  [74, 2],
  [76, 8],
  [77, 2],
  [76, 2],
  [74, 2],
  [72, 2],
  [71, 2],
  [72, 2],
  [74, 4],
  [76, 2],
  [79, 2],
  [84, 4],
  [83, 4],
  [null, 4],
];
const bassC: Section = [...alt(A), ...alt(F), ...alt(G), ...alt(C)];

// prettier-ignore -- ein Takt je Zeile
const melodyD: Section = [
  [84, 1],
  [null, 1],
  [84, 1],
  [null, 5],
  [79, 2],
  [81, 2],
  [83, 4],
  [84, 2],
  [null, 2],
  [79, 2],
  [null, 2],
  [76, 2],
  [null, 2],
  [72, 4],
  [74, 2],
  [76, 2],
  [77, 2],
  [79, 2],
  [81, 2],
  [83, 2],
  [84, 4],
  [84, 4],
  [null, 4],
  [72, 2],
  [null, 6],
];
// prettier-ignore -- ein Takt je Zeile
const bassD: Section = [
  [48, 1],
  [null, 1],
  [48, 1],
  [null, 5],
  [43, 4],
  [43, 4],
  [48, 2],
  [null, 2],
  [43, 2],
  [null, 2],
  [40, 2],
  [null, 2],
  [36, 4],
  [43, 2],
  [45, 2],
  [47, 2],
  [48, 2],
  [50, 2],
  [52, 2],
  [53, 2],
  [55, 2],
  [48, 4],
  [null, 4],
  [36, 2],
  [null, 6],
];

export const track: Track = {
  title: 'Farbwechsel',
  bpm: 136,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC, melodyA, melodyB, melodyD, melodyC],
  bass: [bassA, bassB, bassA, bassC, bassA, bassB, bassD, bassC],
  drums: ['k.h.s.h.k.h.s.h.', 'k.h.s.h.k.k.s.hh', 'k.h.s.h.k.h.s.h.', 'k.h.s.hsk.hks.ss'],
  gain: 0.8,
};
