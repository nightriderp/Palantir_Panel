import { type Note, type Section, type Track } from '../types';

/**
 * „Mühlrad" – gemächliches Volksmusik-Stück in D-Dorisch. Die Melodie dreht
 * sich im Kreis wie ein Mühlstein; der C-Teil lässt Luft zum Nachdenken.
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
  '62.4 65.2 67.2 69.4 67.2 65.2',
  '64.4 62.2 64.2 65.6 -.2',
  '69.4 72.2 71.2 69.4 67.2 65.2',
  '67.4 64.4 62.6 -.2',
);
const melodyB = bars(
  '74.4 72.2 69.2 71.4 72.4',
  '69.6 67.2 65.4 67.4',
  '65.2 67.2 69.4 72.2 71.2 69.4',
  '67.4 69.4 62.8',
);
const melodyC = bars('69.8 67.8', '65.4 64.4 62.8', '60.4 62.4 64.4 65.4', '67.8 64.4 -.4');

const bassA = bars(
  '38.4 45.4 38.4 45.4',
  '36.4 43.4 36.4 43.4',
  '41.4 48.4 41.4 48.4',
  '38.4 45.4 38.8',
);
const bassB = bars(
  '43.4 50.4 43.4 50.4',
  '41.4 48.4 41.4 48.4',
  '36.4 43.4 36.4 43.4',
  '45.4 45.4 38.8',
);
const bassC = bars('38.16', '41.16', '36.16', '43.8 45.8');

export const track: Track = {
  title: 'Mühlrad',
  bpm: 92,
  wave: 'triangle',
  bassWave: 'sine',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  gain: 0.8,
};
