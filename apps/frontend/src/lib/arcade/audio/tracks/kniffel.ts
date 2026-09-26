import { type Note, type Section, type Track } from '../types';

/**
 * „Drei Würfe" – lässiger Lounge-Swing in F-Dur mit punktierten Figuren, wie
 * Würfel, die im Becher klackern. Der C-Teil ist die kleine Fanfare für den
 * Moment, in dem fünf gleiche liegen.
 */

/** Laufender Bass in Vierteln über einen Dreiklang mit Septime, ein Takt. */
const walk = (root: number, third: number, fifth: number, seventh: number): Note[] => [
  [root, 4],
  [root + third, 4],
  [root + fifth, 4],
  [root + seventh, 4],
];

const F = walk(41, 4, 7, 9);
const Gm = walk(43, 3, 7, 10);
const C7 = walk(36, 4, 7, 10);
const Bb = walk(46, 4, 7, 9);
const Dm = walk(38, 3, 7, 10);

// prettier-ignore -- ein Takt je Zeile
const melodyA: Section = [
  [65, 3],
  [67, 1],
  [69, 3],
  [72, 1],
  [74, 4],
  [72, 4],
  [70, 3],
  [69, 1],
  [67, 3],
  [65, 1],
  [67, 8],
  [64, 3],
  [65, 1],
  [67, 3],
  [70, 1],
  [72, 4],
  [74, 4],
  [72, 3],
  [70, 1],
  [69, 4],
  [65, 8],
];
const bassA: Section = [...F, ...Gm, ...C7, ...F];

// prettier-ignore -- ein Takt je Zeile
const melodyB: Section = [
  [74, 2],
  [74, 2],
  [72, 2],
  [70, 2],
  [74, 4],
  [77, 4],
  [76, 3],
  [74, 1],
  [72, 4],
  [69, 8],
  [70, 2],
  [70, 2],
  [69, 2],
  [67, 2],
  [70, 4],
  [74, 4],
  [72, 6],
  [null, 2],
  [67, 2],
  [69, 2],
  [70, 2],
  [71, 2],
];
const bassB: Section = [...Bb, ...F, ...Gm, ...C7];

// prettier-ignore -- ein Takt je Zeile
const melodyC: Section = [
  [77, 2],
  [null, 1],
  [77, 1],
  [77, 2],
  [81, 2],
  [84, 8],
  [82, 2],
  [81, 2],
  [79, 2],
  [77, 2],
  [79, 4],
  [76, 4],
  [74, 2],
  [null, 1],
  [74, 1],
  [74, 2],
  [77, 2],
  [81, 8],
  [79, 3],
  [77, 1],
  [76, 4],
  [77, 8],
];
const bassC: Section = [...F, ...C7, ...Dm, ...C7];

export const track: Track = {
  title: 'Drei Würfe',
  bpm: 108,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [melodyA, melodyB, melodyA, melodyC, melodyB, melodyA],
  bass: [bassA, bassB, bassA, bassC, bassB, bassA],
  drums: ['k..hs.h.k.h.s..h', 'k..hs.h.k.hhs.h.'],
  gain: 0.85,
};
