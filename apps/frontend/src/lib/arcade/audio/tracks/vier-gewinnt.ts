import { type Note, type Section, type Track } from '../types';

/**
 * „Viererkette" – flotter Pop in C-Dur. Im Schlussteil klopft das Motiv
 * viermal auf denselben Ton: vier in einer Reihe, nur zum Hören.
 */

/** Pumpender Achtelbass: Grundton und Oktave im Wechsel. */
function pump(root: number, eighths = 8): Note[] {
  return Array.from({ length: eighths }, (_, i): Note => [i % 2 === 0 ? root : root + 12, 2]);
}

const A: Section = [
  [72, 2],
  [72, 2],
  [76, 2],
  [79, 2],
  [76, 4],
  [72, 4],
  [74, 2],
  [74, 2],
  [77, 2],
  [81, 2],
  [79, 8],
  [76, 2],
  [79, 2],
  [84, 4],
  [83, 2],
  [81, 2],
  [79, 4],
  [77, 2],
  [76, 2],
  [74, 4],
  [72, 8],
];
const B: Section = [
  [81, 4],
  [79, 2],
  [77, 2],
  [76, 4],
  [74, 4],
  [72, 2],
  [74, 2],
  [76, 2],
  [77, 2],
  [79, 8],
  [81, 4],
  [83, 2],
  [84, 2],
  [83, 4],
  [79, 4],
  [81, 6],
  [79, 2],
  [null, 8],
];
const C: Section = [
  [79, 2],
  [79, 2],
  [79, 2],
  [79, 2],
  [null, 8],
  [84, 2],
  [84, 2],
  [84, 2],
  [84, 2],
  [null, 8],
  [76, 2],
  [77, 2],
  [79, 2],
  [81, 2],
  [83, 2],
  [84, 2],
  [86, 4],
  [84, 12],
  [null, 4],
];

const bassA: Section = [...pump(36), ...pump(43), ...pump(45), ...pump(41, 4), ...pump(43, 4)];
const bassB: Section = [...pump(41), ...pump(36), ...pump(45), ...pump(43)];
const bassC: Section = [...pump(43), ...pump(41), ...pump(45, 4), ...pump(43, 4), ...pump(36)];

export const track: Track = {
  title: 'Viererkette',
  bpm: 128,
  wave: 'square',
  bassWave: 'triangle',
  melody: [A, B, A, C],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k.h.s.h.k.h.s.hh', 'k.h.s.h.k.k.s.h.'],
  gain: 0.7,
};
