import { midiToFrequency, noiseBuffer } from './engine';
import { type SfxName } from './types';

/**
 * Geräusche der Spielhalle als kurze Synthesizer-Klänge.
 *
 * Jeder Klang ist eine Handvoll Töne bzw. Rauschstöße mit weicher Hüllkurve.
 * Absichtlich leise, kurz und eher tief: Geräusche wiederholen sich hundertfach
 * je Partie, ein greller Piepton nervt nach dem dritten Mal.
 */

interface Tone {
  kind: 'tone';
  /** Start relativ zum Auslösen, Sekunden. */
  at: number;
  dur: number;
  /** MIDI-Note am Anfang und optional am Ende (Gleiten). */
  from: number;
  to?: number;
  wave: OscillatorType;
  gain: number;
}

interface Noise {
  kind: 'noise';
  at: number;
  dur: number;
  filter: BiquadFilterType;
  freq: number;
  gain: number;
}

type Part = Tone | Noise;

const t = (
  at: number,
  dur: number,
  from: number,
  wave: OscillatorType,
  gain: number,
  to?: number,
): Tone => ({
  kind: 'tone',
  at,
  dur,
  from,
  to,
  wave,
  gain,
});

const n = (
  at: number,
  dur: number,
  filter: BiquadFilterType,
  freq: number,
  gain: number,
): Noise => ({
  kind: 'noise',
  at,
  dur,
  filter,
  freq,
  gain,
});

export const SFX_RECIPES: Record<SfxName, readonly Part[]> = {
  click: [t(0, 0.04, 84, 'triangle', 0.18)],
  move: [t(0, 0.06, 72, 'triangle', 0.16, 76)],
  place: [t(0, 0.08, 64, 'sine', 0.3, 60), n(0, 0.03, 'lowpass', 1200, 0.12)],
  capture: [
    t(0, 0.07, 76, 'square', 0.1),
    t(0.06, 0.1, 69, 'square', 0.1),
    n(0, 0.05, 'bandpass', 2500, 0.1),
  ],
  dice: [
    n(0, 0.04, 'bandpass', 3000, 0.16),
    n(0.06, 0.04, 'bandpass', 2600, 0.14),
    n(0.13, 0.04, 'bandpass', 3400, 0.12),
    n(0.21, 0.05, 'bandpass', 2800, 0.1),
  ],
  card: [n(0, 0.07, 'highpass', 3500, 0.14), t(0, 0.05, 90, 'sine', 0.04, 84)],
  shuffle: [
    n(0, 0.05, 'highpass', 3000, 0.1),
    n(0.05, 0.05, 'highpass', 3300, 0.1),
    n(0.1, 0.05, 'highpass', 2800, 0.1),
    n(0.15, 0.05, 'highpass', 3600, 0.1),
    n(0.2, 0.07, 'highpass', 3000, 0.1),
  ],
  eat: [t(0, 0.06, 79, 'square', 0.08, 86)],
  bounce: [t(0, 0.07, 67, 'sine', 0.25, 72)],
  hit: [t(0, 0.08, 55, 'square', 0.1, 48), n(0, 0.06, 'lowpass', 900, 0.2)],
  explode: [n(0, 0.45, 'lowpass', 700, 0.4), t(0, 0.3, 43, 'sawtooth', 0.08, 31)],
  shoot: [t(0, 0.1, 91, 'square', 0.06, 72)],
  powerup: [
    t(0, 0.07, 72, 'square', 0.07),
    t(0.07, 0.07, 76, 'square', 0.07),
    t(0.14, 0.07, 79, 'square', 0.07),
    t(0.21, 0.14, 84, 'square', 0.07),
  ],
  line: [
    t(0, 0.08, 76, 'triangle', 0.16),
    t(0.07, 0.08, 81, 'triangle', 0.16),
    t(0.14, 0.14, 88, 'triangle', 0.14),
  ],
  score: [t(0, 0.07, 81, 'sine', 0.18), t(0.07, 0.12, 88, 'sine', 0.18)],
  coin: [t(0, 0.06, 83, 'square', 0.07), t(0.06, 0.2, 88, 'square', 0.07)],
  turn: [t(0, 0.1, 74, 'sine', 0.16), t(0.1, 0.16, 79, 'sine', 0.16)],
  error: [t(0, 0.09, 50, 'square', 0.08), t(0.1, 0.14, 47, 'square', 0.08)],
  win: [
    t(0, 0.12, 72, 'triangle', 0.18),
    t(0.12, 0.12, 76, 'triangle', 0.18),
    t(0.24, 0.12, 79, 'triangle', 0.18),
    t(0.36, 0.4, 84, 'triangle', 0.2),
    t(0.36, 0.4, 76, 'sine', 0.1),
  ],
  lose: [
    t(0, 0.18, 67, 'triangle', 0.16),
    t(0.18, 0.18, 63, 'triangle', 0.16),
    t(0.36, 0.45, 58, 'triangle', 0.16, 55),
  ],
  tick: [t(0, 0.025, 96, 'sine', 0.08)],
  flap: [n(0, 0.07, 'bandpass', 1400, 0.18), t(0, 0.06, 70, 'sine', 0.06, 77)],
};

/** Einen Effekt auf `destination` spielen. Still, wenn etwas schiefgeht. */
export function playSfx(ctx: AudioContext, destination: AudioNode, name: SfxName): void {
  const parts = SFX_RECIPES[name];
  const start = ctx.currentTime + 0.005;
  try {
    for (const part of parts) {
      const at = start + part.at;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.linearRampToValueAtTime(part.gain, at + Math.min(0.01, part.dur / 4));
      env.gain.exponentialRampToValueAtTime(0.0001, at + part.dur);
      env.connect(destination);
      if (part.kind === 'tone') {
        const osc = ctx.createOscillator();
        osc.type = part.wave;
        osc.frequency.setValueAtTime(midiToFrequency(part.from), at);
        if (part.to !== undefined) {
          osc.frequency.exponentialRampToValueAtTime(midiToFrequency(part.to), at + part.dur);
        }
        osc.connect(env);
        osc.start(at);
        osc.stop(at + part.dur + 0.02);
      } else {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx);
        const filter = ctx.createBiquadFilter();
        filter.type = part.filter;
        filter.frequency.value = part.freq;
        src.connect(filter).connect(env);
        src.start(at, Math.random() * 0.5);
        src.stop(at + part.dur + 0.02);
      }
    }
  } catch {
    // Ton ist Zier – nie ein Grund, das Spiel anzuhalten.
  }
}
