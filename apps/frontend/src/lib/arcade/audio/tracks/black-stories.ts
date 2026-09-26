import { type Section, type Track } from '../types';

/**
 * „Kerzenwachs" – eigene Komposition für Black Stories.
 *
 * Langsam, düster, d-Moll mit harmonischem Leitton: eine Spieluhr-Melodie über
 * lang liegenden Basstönen und ein leiser Herzschlag. Im C-Teil rutscht die
 * Oberstimme chromatisch abwärts – das Gefühl, dass etwas nicht stimmt.
 * Folge A-B-A-C.
 */

// prettier-ignore
const melodieA: Section = [
  [62, 4], [65, 4], [64, 2], [62, 2], [61, 4],
  [62, 8], [null, 4], [57, 4],
  [62, 4], [65, 4], [69, 4], [70, 2], [69, 2],
  [67, 6], [65, 2], [64, 8],
];

// prettier-ignore
const melodieB: Section = [
  [69, 4], [70, 4], [69, 4], [67, 4],
  [65, 6], [64, 2], [62, 8],
  [70, 4], [69, 2], [67, 2], [65, 4], [64, 4],
  [61, 8], [null, 8],
];

// prettier-ignore
const melodieC: Section = [
  [74, 8], [73, 8],
  [72, 8], [71, 4], [null, 4],
  [70, 4], [69, 4], [68, 4], [67, 4],
  [66, 8], [62, 8],
];

// prettier-ignore
const bassA: Section = [[38, 16], [34, 16], [38, 8], [41, 8], [33, 16]];
// prettier-ignore
const bassB: Section = [[41, 16], [34, 8], [38, 8], [43, 8], [41, 8], [33, 16]];
// prettier-ignore
const bassC: Section = [[38, 16], [36, 16], [35, 16], [33, 8], [38, 8]];

// prettier-ignore
const harmonieA: Section = [[57, 16], [58, 16], [57, 8], [60, 8], [57, 16]];
// prettier-ignore
const harmonieB: Section = [[60, 16], [58, 8], [57, 8], [58, 8], [57, 8], [57, 16]];
// prettier-ignore
const harmonieC: Section = [[65, 16], [64, 16], [63, 16], [62, 16]];

export const track: Track = {
  title: 'Kerzenwachs',
  bpm: 68,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [melodieA, melodieB, melodieA, melodieC],
  bass: [bassA, bassB, bassA, bassC],
  harmony: [harmonieA, harmonieB, harmonieA, harmonieC],
  drums: ['k..k............'],
  gain: 0.8,
};
