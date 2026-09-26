import { type Section, type Track } from '../types';

/**
 * „Inselmarkt" – eigene Komposition für Catan.
 *
 * Ein fröhlicher Volkstanz in G-Dur: Man sitzt am Hafen, handelt Wolle gegen
 * Erz und freut sich über jede Siedlung. Der C-Teil kippt kurz nach e-Moll –
 * der Räuber war da –, bevor das Thema wieder heimkehrt.
 */

// Melodie (je Takt 16 Sechzehntel, je Abschnitt vier Takte)
// prettier-ignore
const A: Section = [
  [67, 4], [71, 2], [74, 2], [79, 4], [74, 4],
  [76, 2], [74, 2], [72, 2], [71, 2], [69, 4], [74, 4],
  [71, 2], [72, 2], [74, 4], [76, 2], [74, 2], [71, 4],
  [69, 2], [71, 2], [69, 2], [66, 2], [67, 8],
];

// prettier-ignore
const B: Section = [
  [74, 4], [78, 2], [76, 2], [74, 4], [71, 4],
  [72, 4], [76, 2], [74, 2], [72, 4], [69, 4],
  [71, 2], [74, 2], [79, 4], [78, 2], [76, 2], [74, 4],
  [76, 2], [74, 2], [72, 2], [69, 2], [74, 8],
];

// prettier-ignore
const C: Section = [
  [76, 6], [74, 2], [71, 4], [67, 4],
  [69, 6], [71, 2], [72, 4], [76, 4],
  [74, 4], [71, 2], [67, 2], [69, 4], [71, 4],
  [69, 4], [66, 4], [67, 8],
];

// Begleitung: Grundton und Quinte im Viertelschritt, wie eine Laute im Wirtshaus.
// prettier-ignore
const BA: Section = [
  [43, 4], [50, 4], [43, 4], [50, 4],
  [48, 4], [43, 4], [50, 4], [45, 4],
  [43, 4], [50, 4], [52, 4], [50, 4],
  [50, 4], [45, 4], [43, 8],
];

// prettier-ignore
const BB: Section = [
  [50, 4], [45, 4], [50, 4], [45, 4],
  [45, 4], [52, 4], [45, 4], [52, 4],
  [43, 4], [50, 4], [43, 4], [47, 4],
  [48, 4], [45, 4], [50, 8],
];

// prettier-ignore
const BC: Section = [
  [40, 4], [47, 4], [52, 4], [47, 4],
  [45, 4], [52, 4], [45, 4], [48, 4],
  [43, 4], [50, 4], [43, 4], [50, 4],
  [50, 4], [38, 4], [43, 8],
];

export const track: Track = {
  title: 'Inselmarkt',
  bpm: 112,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [A, B, A, C],
  bass: [BA, BB, BA, BC],
  drums: ['k...h.h.s...h.h.', 'k...h.h.s...h.k.', 'k...h.h.s...h.h.', 'k.k.h.h.s...s.h.'],
  gain: 0.8,
};
