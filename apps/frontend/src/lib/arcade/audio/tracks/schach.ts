import { type Section, type Track } from '../types';

/**
 * „Stille Diagonale" – ruhig und nachdenklich in d-Moll: lange Töne, viel
 * Luft zwischen den Phrasen, damit man beim Grübeln nicht gehetzt wird.
 */

const A: Section = [
  [69, 4],
  [67, 2],
  [65, 2],
  [64, 4],
  [62, 4],
  [65, 6],
  [64, 2],
  [62, 4],
  [null, 4],
  [70, 4],
  [69, 2],
  [67, 2],
  [65, 4],
  [69, 4],
  [64, 8],
  [61, 4],
  [null, 4],
];
const B: Section = [
  [74, 6],
  [72, 2],
  [70, 4],
  [69, 4],
  [67, 4],
  [70, 4],
  [69, 8],
  [65, 4],
  [67, 2],
  [69, 2],
  [70, 4],
  [72, 4],
  [69, 12],
  [null, 4],
];
const C: Section = [
  [62, 4],
  [65, 4],
  [69, 4],
  [74, 4],
  [72, 6],
  [70, 2],
  [69, 8],
  [67, 4],
  [65, 4],
  [64, 4],
  [61, 4],
  [62, 12],
  [null, 4],
];

const bassA: Section = [
  [38, 8],
  [45, 8],
  [38, 8],
  [41, 8],
  [43, 8],
  [46, 8],
  [45, 8],
  [33, 8],
];
const bassB: Section = [
  [46, 8],
  [41, 8],
  [43, 8],
  [38, 8],
  [41, 8],
  [45, 8],
  [45, 16],
];
const bassC: Section = [
  [38, 8],
  [45, 8],
  [43, 8],
  [46, 8],
  [43, 8],
  [45, 8],
  [38, 16],
];

// Zweite Stimme: gehaltene Terzen/Quinten über dem Bass, ganz leise Wärme.
const harmA: Section = [
  [57, 16],
  [57, 16],
  [58, 16],
  [57, 8],
  [55, 8],
];
const harmB: Section = [
  [62, 16],
  [58, 16],
  [57, 16],
  [61, 16],
];
const harmC: Section = [
  [57, 16],
  [58, 16],
  [55, 8],
  [57, 8],
  [57, 16],
];

export const track: Track = {
  title: 'Stille Diagonale',
  bpm: 72,
  wave: 'sine',
  bassWave: 'triangle',
  melody: [A, B, A, C],
  bass: [bassA, bassB, bassA, bassC],
  harmony: [harmA, harmB, harmA, harmC],
  gain: 0.8,
};
