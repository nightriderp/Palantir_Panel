/**
 * Ein einziger AudioContext für die ganze Spielhalle.
 *
 * Browser erlauben Ton erst nach einer Nutzerhandlung. Der Kontext entsteht
 * deshalb lazy in `unlock()`, das der Provider beim ersten Tipp/Tastendruck
 * aufruft – nie beim Laden der Seite. Bis dahin gibt `context()` `null` zurück,
 * und Musik/Effekte schweigen still, statt eine Warnung in die Konsole zu
 * schreiben.
 *
 * Signalweg: Musik → musicGain ┐
 *            Effekte → sfxGain ┴→ master → Ausgang
 * Die Musik läuft zusätzlich durch einen sanften Tiefpass: Rechteck- und
 * Sägezahnwellen klingen ungefiltert auf Dauer schrill.
 */

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export class ArcadeAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGainNode: GainNode | null = null;
  private sfxGainNode: GainNode | null = null;
  private musicLevel = 0.4;
  private sfxLevel = 0.7;
  /** Vom Nutzer gewollt pausiert (Tab verborgen) – `resume` nur dann. */
  private suspendedByVisibility = false;

  /** Kontext anlegen bzw. fortsetzen. Nur aus einer Nutzerhandlung heraus aufrufen. */
  unlock(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = audioContextCtor();
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
      const ctx = this.ctx;
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(ctx.destination);

      const tiefpass = ctx.createBiquadFilter();
      tiefpass.type = 'lowpass';
      tiefpass.frequency.value = 4200;
      tiefpass.Q.value = 0.4;
      tiefpass.connect(this.masterGain);

      this.musicGainNode = ctx.createGain();
      this.musicGainNode.gain.value = this.musicLevel;
      this.musicGainNode.connect(tiefpass);

      this.sfxGainNode = ctx.createGain();
      this.sfxGainNode.gain.value = this.sfxLevel;
      this.sfxGainNode.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended' && !this.suspendedByVisibility) {
      void this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /** Der Kontext, falls schon freigeschaltet und lauffähig. */
  context(): AudioContext | null {
    return this.ctx;
  }

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  musicBus(): GainNode | null {
    return this.musicGainNode;
  }

  sfxBus(): GainNode | null {
    return this.sfxGainNode;
  }

  /** Lautstärke 0…1; weich nachgezogen, damit ein Regler nicht knackt. */
  setMusicVolume(level: number): void {
    this.musicLevel = clamp01(level);
    this.ramp(this.musicGainNode, this.musicLevel);
  }

  setSfxVolume(level: number): void {
    this.sfxLevel = clamp01(level);
    this.ramp(this.sfxGainNode, this.sfxLevel);
  }

  /** Tab verborgen ⇒ alles anhalten. Der Sequencer plant an `currentTime`, das steht dann still. */
  setHidden(hidden: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden && ctx.state === 'running') {
      this.suspendedByVisibility = true;
      void ctx.suspend().catch(() => undefined);
    } else if (!hidden && this.suspendedByVisibility) {
      this.suspendedByVisibility = false;
      void ctx.resume().catch(() => undefined);
    }
  }

  private ramp(node: GainNode | null, value: number): void {
    const ctx = this.ctx;
    if (!node || !ctx) return;
    const now = ctx.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(value, now, 0.05);
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

let shared: ArcadeAudioEngine | null = null;

/** Die eine Engine der Seite. */
export function getArcadeAudioEngine(): ArcadeAudioEngine {
  shared ??= new ArcadeAudioEngine();
  return shared;
}

/** MIDI-Note → Frequenz (69 = A4 = 440 Hz). */
export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Weißes Rauschen als wiederverwendbarer Puffer (Snare, Hi-Hat, Explosion).
 * Einmal je Kontext erzeugt – 1 s reicht, Klänge sind kürzer.
 */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Fester Pseudozufall statt Math.random: klingt jedes Mal gleich, und das
  // Rauschen braucht keine Güte.
  let s = 0x2545f491;
  for (let i = 0; i < data.length; i += 1) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = ((s >>> 0) / 4294967296) * 2 - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}
