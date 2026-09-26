import { type Section, type Track } from '../types';

/**
 * „Marsch der Kontinente" – eigene Komposition für Risiko.
 *
 * D-Moll, punktierte Fanfaren-Rhythmen über marschierendem Bass: A ist das
 * Hauptthema, B steigt heroisch an, C ist die gespannte Lage vor dem Angriff
 * (Orgelpunkt auf D, kurze Stöße), D der Sturm zum Schluss. Jeder Abschnitt
 * hat vier Takte à 16 Sechzehntel.
 */

// prettier-ignore
const A: Section = [
  [62, 3], [62, 1], [62, 2], [62, 2], [69, 4], [69, 4],
  [70, 3], [69, 1], [67, 2], [65, 2], [67, 4], [64, 4],
  [65, 3], [67, 1], [69, 2], [65, 2], [62, 4], [69, 4],
  [67, 3], [65, 1], [64, 2], [61, 2], [62, 8],
];

// prettier-ignore
const B: Section = [
  [69, 3], [69, 1], [74, 4], [72, 2], [70, 2], [69, 4],
  [70, 3], [70, 1], [72, 4], [70, 2], [69, 2], [67, 4],
  [65, 3], [67, 1], [69, 4], [70, 2], [72, 2], [74, 4],
  [73, 4], [69, 4], [73, 4], [null, 4],
];

// prettier-ignore
const C: Section = [
  [62, 2], [null, 2], [62, 2], [null, 2], [63, 2], [null, 2], [62, 2], [null, 2],
  [65, 2], [null, 2], [65, 2], [null, 2], [67, 2], [65, 2], [63, 2], [62, 2],
  [60, 2], [null, 2], [60, 2], [null, 2], [62, 2], [null, 2], [63, 4],
  [62, 4], [61, 4], [62, 8],
];

// prettier-ignore
const D: Section = [
  [74, 4], [72, 2], [70, 2], [69, 4], [74, 4],
  [72, 3], [70, 1], [69, 2], [67, 2], [65, 4], [69, 4],
  [70, 4], [69, 2], [67, 2], [65, 2], [64, 2], [62, 4],
  [61, 2], [64, 2], [69, 4], [62, 8],
];

// prettier-ignore
const BASS_A: Section = [
  [38, 2], [38, 2], [45, 2], [38, 2], [38, 2], [38, 2], [45, 2], [38, 2],
  [34, 2], [34, 2], [41, 2], [34, 2], [31, 2], [31, 2], [38, 2], [31, 2],
  [41, 2], [41, 2], [48, 2], [41, 2], [38, 2], [38, 2], [45, 2], [38, 2],
  [33, 2], [33, 2], [40, 2], [33, 2], [38, 8],
];

// prettier-ignore
const BASS_B: Section = [
  [33, 4], [45, 4], [33, 4], [45, 4],
  [34, 4], [46, 4], [36, 4], [48, 4],
  [41, 4], [38, 4], [43, 4], [46, 4],
  [33, 4], [45, 4], [33, 4], [null, 4],
];

/** Ein Takt Orgelpunkt: stoßweise D, wie Trommeln vor dem Angriff. */
// prettier-ignore
const PEDAL: Section = [
  [38, 1], [null, 1], [38, 1], [null, 1], [38, 1], [38, 1], [null, 2],
  [38, 1], [null, 1], [38, 1], [null, 1], [38, 1], [38, 1], [null, 2],
];

const BASS_C: Section = [...PEDAL, ...PEDAL, ...PEDAL, ...PEDAL];

// prettier-ignore
const BASS_D: Section = [
  [34, 4], [34, 4], [33, 4], [38, 4],
  [36, 4], [36, 4], [41, 4], [33, 4],
  [34, 4], [33, 4], [31, 4], [33, 4],
  [33, 4], [33, 4], [38, 8],
];

/** Gegenstimme: gehaltene Quinten, damit die Fanfare nicht dünn klingt. */
// prettier-ignore
const HARM_A: Section = [
  [57, 8], [57, 8],
  [58, 8], [55, 8],
  [57, 8], [57, 8],
  [55, 8], [57, 8],
];

// prettier-ignore
const HARM_B: Section = [
  [64, 8], [65, 8],
  [65, 8], [64, 8],
  [60, 8], [65, 8],
  [64, 16],
];

const HARM_C: Section = [[null, 64]];

// prettier-ignore
const HARM_D: Section = [
  [65, 8], [64, 8],
  [64, 8], [60, 8],
  [62, 8], [58, 8],
  [57, 8], [57, 8],
];

export const track: Track = {
  title: 'Marsch der Kontinente',
  bpm: 108,
  wave: 'square',
  bassWave: 'triangle',
  melody: [A, B, A, C, D],
  bass: [BASS_A, BASS_B, BASS_A, BASS_C, BASS_D],
  harmony: [HARM_A, HARM_B, HARM_A, HARM_C, HARM_D],
  drums: ['k...s...k.k.s...', 'k...s...k.k.s.s.', 'k.h.s.h.k.h.s.hh', 'k...s.k.k...s.ss'],
  gain: 0.8,
};
