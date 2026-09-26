import { type Section, type Track } from '../types';

/**
 * Kachelkaskade – eigene Komposition für 2048.
 *
 * Heiter und hüpfend in C-Dur. Das Motiv springt immer eine Stufe höher,
 * wie Kacheln, die sich verdoppeln; Teil C bleibt stehen und atmet durch.
 */

const melodyA: Section = [
  [72, 2],
  [76, 2],
  [79, 4],
  [72, 2],
  [76, 2],
  [79, 4],
  [74, 2],
  [77, 2],
  [81, 4],
  [74, 2],
  [77, 2],
  [81, 4],
  [76, 2],
  [79, 2],
  [83, 2],
  [84, 2],
  [83, 2],
  [79, 2],
  [76, 4],
  [74, 2],
  [76, 2],
  [77, 2],
  [74, 2],
  [72, 8],
];

const bassA: Section = [
  [48, 4],
  [55, 4],
  [48, 4],
  [55, 4],
  [50, 4],
  [57, 4],
  [50, 4],
  [57, 4],
  [52, 4],
  [59, 4],
  [52, 4],
  [55, 4],
  [43, 4],
  [50, 4],
  [48, 8],
];

const harmonyA: Section = [
  [64, 8],
  [64, 8],
  [65, 8],
  [65, 8],
  [67, 8],
  [67, 8],
  [65, 8],
  [64, 8],
];

const melodyB: Section = [
  [81, 4],
  [79, 2],
  [76, 2],
  [77, 4],
  [76, 2],
  [72, 2],
  [74, 2],
  [76, 2],
  [77, 2],
  [79, 2],
  [81, 8],
  [77, 4],
  [76, 2],
  [74, 2],
  [76, 4],
  [74, 2],
  [72, 2],
  [71, 2],
  [72, 2],
  [74, 2],
  [67, 2],
  [72, 8],
];

const bassB: Section = [
  [53, 4],
  [60, 4],
  [53, 4],
  [60, 4],
  [50, 4],
  [57, 4],
  [53, 4],
  [57, 4],
  [55, 4],
  [62, 4],
  [48, 4],
  [55, 4],
  [43, 4],
  [50, 4],
  [48, 8],
];

const harmonyB: Section = [
  [69, 8],
  [69, 8],
  [65, 8],
  [65, 8],
  [71, 8],
  [67, 8],
  [65, 8],
  [64, 8],
];

const melodyC: Section = [
  [79, 6],
  [76, 2],
  [72, 8],
  [81, 6],
  [77, 2],
  [74, 8],
  [79, 4],
  [81, 4],
  [83, 4],
  [86, 4],
  [84, 12],
  [null, 4],
];

const bassC: Section = [
  [48, 8],
  [52, 8],
  [53, 8],
  [57, 8],
  [55, 8],
  [43, 8],
  [48, 12],
  [null, 4],
];

const harmonyC: Section = [
  [64, 16],
  [65, 16],
  [62, 16],
  [64, 12],
  [null, 4],
];

export const track: Track = {
  title: 'Kachelkaskade',
  bpm: 124,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  harmony: [harmonyA, harmonyB, harmonyA, harmonyC],
  drums: ['k.h.s.h.k.h.s.h.', 'k.h.s.h.k.k.s.h.', 'k.h.s.h.k.h.s.h.', 'k.h.s.hkk.hs.s.h'],
  gain: 0.8,
};
