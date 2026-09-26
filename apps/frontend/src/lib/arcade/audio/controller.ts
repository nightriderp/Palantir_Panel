import { type ArcadeActiveTracksDto, type ArcadeGameId } from '@palantir/contracts';
import { fetchActiveArcadeTracks, fetchArcadeTrackAudio } from '../api';
import { type ArcadeAudioEngine, getArcadeAudioEngine } from './engine';
import { BufferLoopPlayer, type MusicPlayer, TrackPlayer } from './sequencer';
import { DEFAULT_AUDIO_SETTINGS, type ArcadeAudioSettings } from './settings';
import { playSfx } from './sfx';
import { ARCADE_TRACKS } from './tracks';
import { type SfxName } from './types';

/**
 * Wer gerade welche Musik spielt – außerhalb von React.
 *
 * Die Ansichten sagen nur, was sie **wollen** („Musik zu Snake", „Vorschau des
 * hochgeladenen Stücks X", „Ruhe"). Der Controller entscheidet, ob das gerade
 * geht (Kontext freigeschaltet? Musik an?), holt hochgeladene Stücke nach und
 * blendet über. Ein Wechsel während des Nachladens überholt den alten Wunsch
 * (`token`), statt dass zwei Stücke gleichzeitig anlaufen.
 */

export type MusicRequest =
  | { kind: 'game'; gameId: ArcadeGameId }
  | { kind: 'synth'; gameId: ArcadeGameId }
  | { kind: 'upload'; trackId: string };

type ActiveTracks = ArcadeActiveTracksDto['tracks'];

export function musicRequestKey(request: MusicRequest): string {
  return request.kind === 'upload'
    ? `upload:${request.trackId}`
    : `${request.kind}:${request.gameId}`;
}

export class ArcadeAudioController {
  private readonly engine: ArcadeAudioEngine = getArcadeAudioEngine();
  private settings: ArcadeAudioSettings = DEFAULT_AUDIO_SETTINGS;
  private desired: MusicRequest | null = null;
  /** Vorschau auf der Admin-Seite spielt auch bei ausgeschalteter Musik. */
  private forced = false;
  private current: { key: string; player: MusicPlayer } | null = null;
  private token = 0;
  private active: Promise<ActiveTracks> | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly listeners = new Set<() => void>();
  private playingKey: string | null = null;

  // --- für React -----------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Schlüssel des gerade klingenden Stücks (`game:…`, `synth:…`, `upload:…`) oder `null`. */
  getPlaying = (): string | null => this.playingKey;

  // --- Wünsche der Ansichten -------------------------------------------------

  applySettings(settings: ArcadeAudioSettings): void {
    const musicChanged = settings.musicOn !== this.settings.musicOn;
    this.settings = settings;
    this.engine.setMusicVolume(settings.musicVolume);
    this.engine.setSfxVolume(settings.sfxVolume);
    if (musicChanged) void this.refresh();
  }

  /** Nach einer Nutzerhandlung: Kontext freischalten und ggf. anstehende Musik starten. */
  unlock(): void {
    const wasLocked = !this.engine.unlocked;
    const ctx = this.engine.unlock();
    if (!ctx) return;
    if (wasLocked) {
      this.engine.setMusicVolume(this.settings.musicVolume);
      this.engine.setSfxVolume(this.settings.sfxVolume);
    }
    if (wasLocked || (this.desired && !this.current)) void this.refresh();
  }

  playGame = (gameId: ArcadeGameId | null): void => {
    this.desired = gameId ? { kind: 'game', gameId } : null;
    this.forced = false;
    void this.refresh();
  };

  preview = (request: MusicRequest): void => {
    // Vorschau ist eine Nutzerhandlung – sie darf den Kontext selbst freischalten.
    this.engine.unlock();
    this.desired = request;
    this.forced = true;
    void this.refresh();
  };

  stop = (): void => {
    this.desired = null;
    this.forced = false;
    void this.refresh();
  };

  sfx = (name: SfxName): void => {
    if (!this.settings.sfxOn) return;
    const ctx = this.engine.context();
    const bus = this.engine.sfxBus();
    if (!ctx || !bus || ctx.state !== 'running') return;
    playSfx(ctx, bus, name);
  };

  setHidden(hidden: boolean): void {
    this.engine.setHidden(hidden);
  }

  /** Nach Aktivieren/Löschen auf der Admin-Seite: Liste neu holen. */
  invalidateActiveTracks(): void {
    this.active = null;
  }

  // --- intern ----------------------------------------------------------------

  private setPlaying(key: string | null): void {
    if (this.playingKey === key) return;
    this.playingKey = key;
    for (const listener of this.listeners) listener();
  }

  private async refresh(): Promise<void> {
    const token = ++this.token;
    const desired = this.desired;
    const allowed = desired !== null && (this.forced || this.settings.musicOn);
    const key = allowed ? musicRequestKey(desired) : null;

    if (this.current && this.current.key === key) return;
    if (this.current) {
      this.current.player.stop(0.6);
      this.current = null;
      this.setPlaying(null);
    }
    if (!allowed || key === null) return;

    const ctx = this.engine.context();
    const bus = this.engine.musicBus();
    // Noch gesperrt: `unlock()` holt das nach der ersten Nutzerhandlung nach.
    if (!ctx || !bus) return;

    let player: MusicPlayer | null = null;
    try {
      if (desired.kind === 'upload') {
        const buffer = await this.loadBuffer(ctx, desired.trackId);
        if (token !== this.token) return;
        if (buffer) player = new BufferLoopPlayer(ctx, bus, buffer);
      } else if (desired.kind === 'synth') {
        player = new TrackPlayer(ctx, bus, ARCADE_TRACKS[desired.gameId]);
      } else {
        const tracks = await this.loadActive();
        if (token !== this.token) return;
        const upload = tracks[desired.gameId];
        const buffer = upload ? await this.loadBuffer(ctx, upload.id) : null;
        if (token !== this.token) return;
        player = buffer
          ? new BufferLoopPlayer(ctx, bus, buffer)
          : new TrackPlayer(ctx, bus, ARCADE_TRACKS[desired.gameId]);
      }
    } catch {
      player = null;
    }
    if (token !== this.token) {
      player?.stop(0.05);
      return;
    }
    if (!player) return;
    this.current = { key, player };
    this.setPlaying(key);
  }

  private loadActive(): Promise<ActiveTracks> {
    this.active ??= fetchActiveArcadeTracks().then((result) =>
      result.success ? result.data.tracks : {},
    );
    return this.active;
  }

  private loadBuffer(ctx: AudioContext, trackId: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(trackId);
    if (!pending) {
      pending = fetchArcadeTrackAudio(trackId).then(async (bytes) => {
        if (!bytes) return null;
        try {
          return await ctx.decodeAudioData(bytes);
        } catch {
          return null;
        }
      });
      // Fehlschläge nicht festhalten – nach einem neuen Hochladen soll es klappen.
      void pending.then((buffer) => {
        if (buffer === null) this.buffers.delete(trackId);
      });
      this.buffers.set(trackId, pending);
    }
    return pending;
  }
}
