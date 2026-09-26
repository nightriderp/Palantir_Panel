import { type Section, type Track } from '../types';

/**
 * Galgenhumor – eigene Komposition für Galgenmännchen.
 *
 * Schelmisch in d-Moll: ein schleichendes Motiv mit chromatischen
 * Stolperern, als würde jemand auf Zehenspitzen um das Wort herumschleichen.
 * Teil C klingt nach einem Schulterzucken.
 */

const melodyA: Section = [
  [62, 3],
  [65, 1],
  [69, 4],
  [68, 2],
  [69, 2],
  [null, 4],
  [74, 3],
  [72, 1],
  [69, 4],
  [65, 2],
  [64, 2],
  [null, 4],
  [62, 3],
  [65, 1],
  [69, 4],
  [70, 2],
  [69, 2],
  [67, 2],
  [65, 2],
  [64, 2],
  [61, 2],
  [62, 8],
  [null, 4],
];

const bassA: Section = [
  [38, 4],
  [45, 4],
  [38, 4],
  [45, 4],
  [34, 4],
  [41, 4],
  [34, 4],
  [41, 4],
  [31, 4],
  [38, 4],
  [33, 4],
  [40, 4],
  [38, 4],
  [45, 4],
  [38, 8],
];

const harmonyA: Section = [
  [53, 16],
  [50, 16],
  [58, 8],
  [61, 8],
  [57, 16],
];

const melodyB: Section = [
  [77, 2],
  [76, 2],
  [75, 2],
  [74, 2],
  [72, 4],
  [69, 4],
  [70, 2],
  [69, 2],
  [68, 2],
  [69, 2],
  [65, 8],
  [67, 2],
  [69, 2],
  [70, 2],
  [71, 2],
  [72, 4],
  [64, 4],
  [65, 2],
  [64, 2],
  [62, 2],
  [61, 2],
  [62, 8],
];

const bassB: Section = [
  [34, 4],
  [41, 4],
  [34, 4],
  [41, 4],
  [33, 4],
  [40, 4],
  [38, 4],
  [45, 4],
  [36, 4],
  [43, 4],
  [36, 4],
  [43, 4],
  [33, 4],
  [40, 4],
  [38, 8],
];

const harmonyB: Section = [
  [62, 16],
  [61, 16],
  [64, 16],
  [65, 8],
  [62, 8],
];

const melodyC: Section = [
  [69, 2],
  [null, 2],
  [69, 2],
  [null, 2],
  [69, 2],
  [70, 2],
  [69, 4],
  [67, 2],
  [null, 2],
  [67, 2],
  [null, 2],
  [67, 2],
  [69, 2],
  [67, 4],
  [65, 4],
  [64, 4],
  [62, 4],
  [61, 4],
  [62, 2],
  [null, 2],
  [57, 2],
  [null, 2],
  [62, 8],
];

const bassC: Section = [
  [38, 8],
  [38, 8],
  [36, 8],
  [36, 8],
  [34, 8],
  [33, 8],
  [38, 4],
  [33, 4],
  [38, 8],
];

const harmonyC: Section = [
  [53, 16],
  [52, 16],
  [50, 8],
  [52, 8],
  [53, 16],
];

export const track: Track = {
  title: 'Galgenhumor',
  bpm: 104,
  wave: 'sawtooth',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  harmony: [harmonyA, harmonyB, harmonyA, harmonyC],
  drums: ['k..hs..hk..hs..h', 'k..hs..hk.khs..h', 'k..hs..hk..hs..h', 'k..hs.s.k.k.s...'],
  gain: 0.55,
};
