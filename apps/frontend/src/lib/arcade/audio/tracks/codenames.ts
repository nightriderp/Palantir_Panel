import { type Section, type Track } from '../types';

/**
 * „Deckname Nebel" – eigene Komposition für Codenames.
 *
 * Ein schleichendes Agenten-Motiv in e-Moll mit chromatischem Abstieg und
 * gehendem Bass: spannend genug fürs Grübeln über einen Hinweis, aber ruhig
 * genug, dass niemand beim Nachdenken gestört wird. Folge A-B-A-C.
 */

// prettier-ignore
const melodieA: Section = [
  [64, 2], [null, 2], [64, 1], [64, 1], [66, 2], [67, 4], [66, 2], [64, 2],
  [71, 3], [70, 1], [69, 4], [67, 2], [66, 2], [64, 4],
  [64, 2], [null, 2], [64, 1], [64, 1], [66, 2], [67, 4], [69, 2], [70, 2],
  [71, 6], [null, 2], [76, 2], [75, 2], [74, 4],
];

// prettier-ignore
const melodieB: Section = [
  [76, 4], [74, 2], [72, 2], [71, 4], [null, 4],
  [72, 2], [71, 2], [69, 2], [67, 2], [69, 6], [null, 2],
  [74, 4], [72, 2], [71, 2], [69, 4], [67, 2], [66, 2],
  [64, 8], [63, 4], [null, 4],
];

// prettier-ignore
const melodieC: Section = [
  [67, 1], [null, 1], [67, 1], [null, 1], [69, 2], [71, 2], [72, 4], [71, 4],
  [69, 2], [67, 2], [66, 4], [64, 4], [null, 4],
  [67, 1], [null, 1], [67, 1], [null, 1], [69, 2], [71, 2], [74, 4], [76, 4],
  [75, 4], [76, 4], [71, 4], [null, 4],
];

// prettier-ignore
const bassA: Section = [
  [40, 4], [47, 4], [40, 4], [46, 4],
  [45, 4], [43, 4], [42, 4], [47, 4],
  [40, 4], [47, 4], [40, 4], [46, 4],
  [47, 4], [46, 4], [45, 4], [47, 4],
];

// prettier-ignore
const bassB: Section = [
  [48, 4], [43, 4], [48, 4], [47, 4],
  [45, 4], [40, 4], [45, 4], [47, 4],
  [50, 4], [45, 4], [50, 4], [42, 4],
  [40, 8], [39, 4], [47, 4],
];

// prettier-ignore
const bassC: Section = [
  [43, 2], [null, 2], [43, 2], [null, 2], [45, 4], [47, 4],
  [45, 4], [43, 4], [42, 4], [40, 4],
  [43, 2], [null, 2], [43, 2], [null, 2], [47, 4], [48, 4],
  [47, 4], [40, 4], [47, 4], [40, 4],
];

export const track: Track = {
  title: 'Deckname Nebel',
  bpm: 108,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodieA, melodieB, melodieA, melodieC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k.h.s.hkk.h.s.h.', 'k.h.s.h.k.hks.h.'],
  gain: 0.7,
};
