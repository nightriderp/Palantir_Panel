import { midiToFrequency, noiseBuffer } from './engine';
import { SECTION_SIXTEENTHS, type Section, type Track } from './types';

/**
 * Spielt einen Notenzettel (`Track`) über WebAudio.
 *
 * Planung mit Vorlauf („lookahead scheduling"): Ein Zeitgeber schaut alle
 * 25 ms nach, welche Sechzehntel in den nächsten ~120 ms fällig werden, und
 * legt deren Töne sample-genau auf die Uhr des AudioContext. `setInterval`
 * allein wäre zu ungenau – der Takt würde bei jeder Last auf der Seite
 * stolpern.
 *
 * Musik ist reine Zier: Jeder Fehler hier endet still, nie in einer Ausnahme,
 * die ein Spiel anhalten könnte.
 */

type Voice = 'melody' | 'bass' | 'harmony';

export interface CompiledNote {
  voice: Voice;
  midi: number;
  /** Länge in Sechzehnteln. */
  length: number;
}

export interface CompiledTrack {
  /** Länge des ganzen Stücks in Sechzehnteln (Abschnitte × 64). */
  length: number;
  /** Je Sechzehntel die dort beginnenden Töne. */
  steps: CompiledNote[][];
  /** Schlagzeug je Sechzehntel des Stücks (`k`, `s`, `h` oder `.`). */
  drums: string[];
}

/** Notenzettel in eine Zeitleiste übersetzen. Rein – im Test prüfbar. */
export function compileTrack(track: Track): CompiledTrack {
  const sections = Math.max(1, track.melody.length);
  const length = sections * SECTION_SIXTEENTHS;
  const steps: CompiledNote[][] = Array.from({ length }, () => []);

  const place = (voice: Voice, list: readonly Section[] | undefined) => {
    if (!list) return;
    list.forEach((section, sectionIndex) => {
      let at = sectionIndex * SECTION_SIXTEENTHS;
      for (const [midi, dauer] of section) {
        if (midi !== null && at < length && dauer > 0) {
          steps[at]?.push({ voice, midi, length: dauer });
        }
        at += Math.max(0, dauer);
      }
    });
  };
  place('melody', track.melody);
  place('bass', track.bass);
  place('harmony', track.harmony);

  const drums: string[] = [];
  const patterns = track.drums ?? [];
  for (let i = 0; i < length; i += 1) {
    if (patterns.length === 0) {
      drums.push('.');
      continue;
    }
    const pattern = patterns[Math.floor(i / 16) % patterns.length] ?? '';
    drums.push(pattern[i % 16] ?? '.');
  }
  return { length, steps, drums };
}

/** Etwas, das Musik macht und sich weich beenden lässt. */
export interface MusicPlayer {
  stop(fadeSeconds?: number): void;
}

const LOOKAHEAD_S = 0.12;
const TIMER_MS = 25;

/** Lautstärke und Hüllkurve je Stimme – Melodie vorn, Begleitung dahinter. */
const VOICE_GAIN: Record<Voice, number> = { melody: 0.16, bass: 0.2, harmony: 0.08 };

export class TrackPlayer implements MusicPlayer {
  private readonly out: GainNode;
  private readonly compiled: CompiledTrack;
  private readonly sixteenth: number;
  private position = 0;
  private nextTime: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly track: Track,
    fadeInSeconds = 0.6,
  ) {
    this.compiled = compileTrack(track);
    const bpm = Math.min(240, Math.max(40, track.bpm));
    this.sixteenth = 60 / bpm / 4;
    this.out = ctx.createGain();
    const ziel = Math.min(1, Math.max(0, track.gain ?? 1));
    const now = ctx.currentTime;
    this.out.gain.setValueAtTime(0.0001, now);
    this.out.gain.linearRampToValueAtTime(ziel, now + fadeInSeconds);
    this.out.connect(destination);
    this.nextTime = now + 0.05;
    this.timer = setInterval(() => this.schedule(), TIMER_MS);
    this.schedule();
  }

  stop(fadeSeconds = 0.5): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
    } catch {
      // Kontext geschlossen – dann ist ohnehin Ruhe.
    }
    setTimeout(
      () => {
        try {
          this.out.disconnect();
        } catch {
          // schon getrennt
        }
      },
      (fadeSeconds + 0.2) * 1000,
    );
  }

  private schedule(): void {
    if (this.stopped) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_S;
    // Nach einer langen Pause (Tab im Hintergrund) nicht alles Versäumte
    // nachholen, sondern ab jetzt weiterspielen.
    if (this.nextTime < this.ctx.currentTime - 0.25) this.nextTime = this.ctx.currentTime + 0.02;
    while (this.nextTime < horizon) {
      const step = this.position % this.compiled.length;
      for (const note of this.compiled.steps[step] ?? []) this.playNote(note, this.nextTime);
      const drum = this.compiled.drums[step];
      if (drum && drum !== '.') this.playDrum(drum, this.nextTime);
      this.position += 1;
      this.nextTime += this.sixteenth;
    }
  }

  private playNote(note: CompiledNote, at: number): void {
    const ctx = this.ctx;
    const dauer = Math.max(0.05, note.length * this.sixteenth);
    const osc = ctx.createOscillator();
    osc.type =
      note.voice === 'melody'
        ? this.track.wave
        : note.voice === 'bass'
          ? (this.track.bassWave ?? 'triangle')
          : 'triangle';
    osc.frequency.setValueAtTime(midiToFrequency(note.midi), at);
    const env = ctx.createGain();
    const peak = VOICE_GAIN[note.voice];
    const attack = Math.min(0.02, dauer / 4);
    const release = Math.min(0.08, dauer / 3);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.exponentialRampToValueAtTime(peak * 0.6, at + Math.max(attack + 0.01, dauer * 0.5));
    env.gain.setValueAtTime(peak * 0.6, at + dauer - release);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dauer);
    osc.connect(env).connect(this.out);
    osc.start(at);
    osc.stop(at + dauer + 0.02);
  }

  private playDrum(kind: string, at: number): void {
    const ctx = this.ctx;
    if (kind === 'k') {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, at);
      osc.frequency.exponentialRampToValueAtTime(42, at + 0.14);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.5, at);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.connect(env).connect(this.out);
      osc.start(at);
      osc.stop(at + 0.2);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    const snare = kind === 's';
    filter.type = snare ? 'bandpass' : 'highpass';
    filter.frequency.value = snare ? 1800 : 7000;
    const dauer = snare ? 0.13 : 0.04;
    env.gain.setValueAtTime(snare ? 0.22 : 0.07, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dauer);
    src.connect(filter).connect(env).connect(this.out);
    src.start(at, Math.random() * 0.5);
    src.stop(at + dauer + 0.01);
  }
}

/** Hochgeladenes Stück als Schleife. */
export class BufferLoopPlayer implements MusicPlayer {
  private readonly out: GainNode;
  private readonly source: AudioBufferSourceNode;
  private stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    buffer: AudioBuffer,
    fadeInSeconds = 0.8,
  ) {
    this.out = ctx.createGain();
    const now = ctx.currentTime;
    this.out.gain.setValueAtTime(0.0001, now);
    // Hochgeladene Stücke sind meist fertig gemastert und lauter als die
    // Synthesizer-Melodien – etwas zurücknehmen, damit der Regler passt.
    this.out.gain.linearRampToValueAtTime(0.7, now + fadeInSeconds);
    this.out.connect(destination);
    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.connect(this.out);
    this.source.start(now);
  }

  stop(fadeSeconds = 0.5): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    try {
      this.out.gain.cancelScheduledValues(now);
      this.out.gain.setValueAtTime(this.out.gain.value, now);
      this.out.gain.linearRampToValueAtTime(0.0001, now + fadeSeconds);
      this.source.stop(now + fadeSeconds + 0.05);
    } catch {
      // Kontext geschlossen
    }
    setTimeout(
      () => {
        try {
          this.out.disconnect();
        } catch {
          // schon getrennt
        }
      },
      (fadeSeconds + 0.2) * 1000,
    );
  }
}
