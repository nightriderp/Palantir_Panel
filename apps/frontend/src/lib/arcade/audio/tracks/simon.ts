import { type Section, type Track } from '../types';

/**
 * Farbenspiel – eigene Komposition für Simon.
 *
 * Verspielt in A-Dur-Pentatonik. Das Leitmotiv besteht aus vier Tönen,
 * einer für jedes Farbfeld, und wird von Abschnitt zu Abschnitt länger –
 * genau wie die Folge im Spiel.
 */

const melodyA: Section = [
  [76, 4],
  [73, 4],
  [69, 4],
  [64, 4],
  [76, 2],
  [73, 2],
  [69, 2],
  [64, 2],
  [69, 4],
  [null, 4],
  [78, 2],
  [76, 2],
  [73, 2],
  [71, 2],
  [69, 4],
  [71, 4],
  [73, 2],
  [76, 2],
  [78, 2],
  [76, 2],
  [81, 8],
];

const bassA: Section = [
  [45, 4],
  [52, 4],
  [45, 4],
  [52, 4],
  [42, 4],
  [49, 4],
  [42, 4],
  [49, 4],
  [50, 4],
  [57, 4],
  [50, 4],
  [57, 4],
  [52, 4],
  [59, 4],
  [45, 8],
];

const harmonyA: Section = [
  [61, 16],
  [57, 16],
  [66, 16],
  [64, 8],
  [61, 8],
];

const melodyB: Section = [
  [81, 2],
  [78, 2],
  [76, 2],
  [73, 2],
  [76, 2],
  [73, 2],
  [71, 2],
  [69, 2],
  [71, 4],
  [73, 4],
  [76, 8],
  [78, 2],
  [81, 2],
  [78, 2],
  [76, 2],
  [73, 2],
  [76, 2],
  [73, 2],
  [71, 2],
  [69, 4],
  [64, 4],
  [69, 8],
];

const bassB: Section = [
  [50, 4],
  [57, 4],
  [50, 4],
  [57, 4],
  [52, 4],
  [59, 4],
  [52, 4],
  [59, 4],
  [42, 4],
  [49, 4],
  [50, 4],
  [57, 4],
  [52, 4],
  [40, 4],
  [45, 8],
];

const harmonyB: Section = [
  [66, 16],
  [68, 16],
  [69, 16],
  [64, 16],
];

const melodyC: Section = [
  [76, 2],
  [null, 2],
  [73, 2],
  [null, 2],
  [69, 2],
  [null, 2],
  [64, 2],
  [null, 2],
  [64, 2],
  [69, 2],
  [73, 2],
  [76, 2],
  [81, 8],
  [76, 1],
  [73, 1],
  [69, 1],
  [64, 1],
  [76, 1],
  [73, 1],
  [69, 1],
  [64, 1],
  [69, 8],
  [null, 16],
];

const bassC: Section = [
  [45, 8],
  [45, 8],
  [45, 4],
  [49, 4],
  [52, 8],
  [40, 8],
  [45, 8],
  [null, 16],
];

const harmonyC: Section = [
  [64, 32],
  [61, 16],
  [null, 16],
];

export const track: Track = {
  title: 'Farbenspiel',
  bpm: 116,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  harmony: [harmonyA, harmonyB, harmonyA, harmonyC],
  drums: ['k...s...k.k.s...', 'k.h.s.h.k.h.s.h.', 'k...s...k.k.s...', 'k.k.s.k.k...s.ss'],
  gain: 0.6,
};
