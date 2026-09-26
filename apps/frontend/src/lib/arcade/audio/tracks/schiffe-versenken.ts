import { type Note, type Section, type Track } from '../types';

/**
 * „Nebelhorn" – Seemannslied in d-Moll mit punktierten Schritten wie ein
 * schwankendes Deck. Der C-Teil ist Nebel auf See: lange Töne, gespanntes
 * Warten auf den nächsten Treffer.
 */

/** Ein Takt je Zeichenkette: „72.4" = MIDI 72 für vier Sechzehntel, „-.2" = Pause. */
function bars(...lines: string[]): Section {
  return lines.flatMap((line) =>
    line
      .trim()
      .split(/\s+/)
      .map((token): Note => {
        const [pitch, length] = token.split('.');
        return [pitch === '-' ? null : Number(pitch), Number(length)];
      }),
  );
}

const melodyA = bars(
  '69.3 69.1 74.4 72.3 70.1 69.4',
  '67.3 65.1 64.4 62.8',
  '69.3 69.1 74.4 76.3 77.1 76.4',
  '74.3 73.1 74.8 -.4',
);
const melodyB = bars(
  '77.4 76.2 74.2 72.4 70.4',
  '69.3 70.1 69.4 65.8',
  '67.3 69.1 70.4 72.3 70.1 69.4',
  '67.3 65.1 64.4 62.8',
);
const melodyC = bars('62.12 -.4', '65.8 64.8', '62.12 -.4', '57.8 61.8');

const bassA = bars(
  '38.6 45.2 38.6 45.2',
  '36.6 43.2 36.6 43.2',
  '38.6 45.2 38.6 45.2',
  '33.6 40.2 45.8',
);
const bassB = bars(
  '34.6 41.2 34.6 41.2',
  '41.6 48.2 41.6 48.2',
  '43.6 50.2 43.6 50.2',
  '45.8 38.8',
);
const bassC = bars('38.16', '41.8 40.8', '38.16', '33.16');

export const track: Track = {
  title: 'Nebelhorn',
  bpm: 108,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k.....s.k.k...s.', 'k..h..s.k..h..s.'],
  gain: 0.8,
};
