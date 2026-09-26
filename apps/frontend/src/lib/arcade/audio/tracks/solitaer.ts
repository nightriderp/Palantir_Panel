import { type Section, type Track } from '../types';

/**
 * Kaminfeuer-Karten – eigene Komposition für Solitär.
 *
 * Gemütlich in F-Dur mit ein paar jazzigen Farben (große Septimen,
 * Nonen). Nichts drängt: Man legt Karte um Karte, die Musik tut es auch.
 */

const melodyA: Section = [
  [69, 6],
  [72, 2],
  [76, 4],
  [74, 4],
  [72, 6],
  [69, 2],
  [67, 8],
  [70, 6],
  [74, 2],
  [77, 4],
  [76, 4],
  [74, 4],
  [72, 4],
  [69, 8],
];

const bassA: Section = [
  [41, 8],
  [48, 8],
  [38, 8],
  [45, 8],
  [43, 8],
  [48, 8],
  [41, 8],
  [41, 8],
];

const harmonyA: Section = [
  [64, 16],
  [65, 8],
  [64, 8],
  [62, 16],
  [64, 8],
  [60, 8],
];

const melodyB: Section = [
  [72, 4],
  [74, 2],
  [76, 2],
  [77, 8],
  [76, 4],
  [74, 4],
  [72, 8],
  [74, 4],
  [72, 2],
  [70, 2],
  [69, 4],
  [67, 4],
  [69, 12],
  [null, 4],
];

const bassB: Section = [
  [46, 8],
  [53, 8],
  [45, 8],
  [50, 8],
  [43, 8],
  [48, 8],
  [41, 12],
  [null, 4],
];

const harmonyB: Section = [
  [62, 16],
  [60, 16],
  [64, 16],
  [60, 12],
  [null, 4],
];

const melodyC: Section = [
  [77, 8],
  [76, 4],
  [72, 4],
  [74, 8],
  [69, 8],
  [70, 4],
  [69, 4],
  [67, 4],
  [64, 4],
  [65, 16],
];

const bassC: Section = [
  [38, 8],
  [45, 8],
  [46, 8],
  [41, 8],
  [48, 8],
  [36, 8],
  [41, 16],
];

const harmonyC: Section = [
  [69, 16],
  [65, 16],
  [64, 16],
  [57, 16],
];

export const track: Track = {
  title: 'Kaminfeuer-Karten',
  bpm: 88,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  harmony: [harmonyA, harmonyB, harmonyA, harmonyC],
  drums: ['h...h...h...h...', 'h...h...h.h.h...', 'h...h...h...h...', 'h...h...h...hhh.'],
  gain: 0.75,
};
