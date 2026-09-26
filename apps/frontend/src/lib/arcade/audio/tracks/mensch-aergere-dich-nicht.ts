import { type Note, type Section, type Track } from '../types';

/**
 * „Hüpfkegel" – fröhliche Polka in C-Dur mit Umm-ta-Bass. Der B-Teil ist der
 * freche Rauswurf, der C-Teil ein Würfelwirbel aus Tonleiterläufen.
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
  '72.2 -.2 76.2 -.2 79.2 76.2 72.4',
  '74.2 -.2 77.2 -.2 81.2 77.2 74.4',
  '76.2 77.2 79.2 81.2 79.2 77.2 76.2 74.2',
  '72.4 67.4 72.6 -.2',
);
const melodyB = bars(
  '79.1 -.1 79.1 -.1 78.2 79.2 84.4 -.4',
  '81.2 79.2 77.2 76.2 74.4 -.4',
  '77.1 -.1 77.1 -.1 76.2 77.2 81.4 79.4',
  '76.2 74.2 72.2 71.2 72.8',
);
const melodyC = bars(
  '72.1 74.1 76.1 77.1 79.4 72.1 74.1 76.1 77.1 79.4',
  '81.2 79.2 77.2 76.2 74.8',
  '71.1 72.1 74.1 76.1 77.4 71.1 72.1 74.1 76.1 77.4',
  '79.2 77.2 76.2 74.2 72.8',
);

const bassA = bars(
  '36.4 43.4 36.4 43.4',
  '41.4 48.4 41.4 48.4',
  '36.4 43.4 36.4 43.4',
  '43.4 38.4 36.8',
);
const bassB = bars(
  '43.4 50.4 43.4 50.4',
  '41.4 48.4 41.4 48.4',
  '38.4 45.4 38.4 45.4',
  '43.4 43.4 36.8',
);
const bassC = bars(
  '36.4 43.4 36.4 43.4',
  '41.4 48.4 41.4 48.4',
  '43.4 50.4 43.4 50.4',
  '36.4 43.4 36.8',
);

export const track: Track = {
  title: 'Hüpfkegel',
  bpm: 138,
  wave: 'square',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k...s...k.k.s...', 'k...s...k...s.hh'],
  gain: 0.8,
};
