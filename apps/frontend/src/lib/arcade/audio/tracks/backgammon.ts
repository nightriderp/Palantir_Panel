import { type Note, type Section, type Track } from '../types';

/**
 * „Levantewürfel" – kreisende Melodie in E-Phrygisch-Dominant über einem
 * Borduntonbass, dazu ein Handtrommel-Muster. Klingt nach Hafencafé und
 * klappernden Steinen.
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
  '64.2 65.2 68.4 69.2 68.2 65.4',
  '64.3 65.1 64.2 62.2 64.8',
  '69.2 71.2 72.4 71.2 69.2 68.4',
  '69.2 68.2 65.2 68.2 64.8',
);
const melodyB = bars(
  '76.4 74.2 72.2 71.4 72.4',
  '71.2 69.2 68.2 69.2 71.8',
  '72.3 71.1 69.2 68.2 65.4 64.4',
  '65.2 68.2 64.12',
);
const melodyC = bars(
  '64.1 64.1 -.2 65.2 64.2 68.2 -.2 69.4',
  '68.2 65.2 64.4 -.8',
  '71.1 71.1 -.2 72.2 71.2 69.2 -.2 68.4',
  '69.2 68.2 65.2 64.2 64.8',
);

const bassA = bars(
  '40.6 40.2 47.4 40.4',
  '40.6 40.2 47.4 40.4',
  '45.6 45.2 52.4 45.4',
  '41.4 41.4 40.8',
);
const bassB = bars('45.6 45.2 52.4 45.4', '40.6 40.2 47.4 40.4', '41.6 41.2 48.4 41.4', '40.16');
const bassC = bars(
  '40.3 40.3 40.2 40.4 47.4',
  '40.3 40.3 40.2 40.4 47.4',
  '40.3 40.3 40.2 40.4 47.4',
  '40.8 41.4 40.4',
);

export const track: Track = {
  title: 'Levantewürfel',
  bpm: 100,
  wave: 'triangle',
  bassWave: 'triangle',
  melody: [melodyA, melodyB, melodyA, melodyC],
  bass: [bassA, bassB, bassA, bassC],
  drums: ['k..s..k.k..s.h..', 'k..s..k.k.ks.hh.'],
  gain: 0.8,
};
