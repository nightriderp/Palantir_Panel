/**
 * Klang-Einstellungen je Browser.
 *
 * Bewusst in `localStorage` und nicht am Konto: Wer im Büro leise spielt und
 * zu Hause laut, will nicht, dass das eine Gerät das andere umstellt. Jeder
 * Zugriff in try/catch – im privaten Fenster oder mit gesperrtem Speicher gilt
 * einfach die Vorgabe.
 */

export interface ArcadeAudioSettings {
  musicOn: boolean;
  /** 0…1 */
  musicVolume: number;
  sfxOn: boolean;
  /** 0…1 */
  sfxVolume: number;
}

export const DEFAULT_AUDIO_SETTINGS: ArcadeAudioSettings = {
  musicOn: true,
  musicVolume: 0.4,
  sfxOn: true,
  sfxVolume: 0.7,
};

const STORAGE_KEY = 'palantir.arcade.audio';

function volume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

/** Gespeicherte Werte lesen; alles Unlesbare fällt auf die Vorgabe zurück. */
export function parseAudioSettings(raw: string | null): ArcadeAudioSettings {
  if (!raw) return DEFAULT_AUDIO_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof ArcadeAudioSettings, unknown>>;
    if (typeof value !== 'object' || value === null) return DEFAULT_AUDIO_SETTINGS;
    return {
      musicOn: typeof value.musicOn === 'boolean' ? value.musicOn : DEFAULT_AUDIO_SETTINGS.musicOn,
      musicVolume: volume(value.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
      sfxOn: typeof value.sfxOn === 'boolean' ? value.sfxOn : DEFAULT_AUDIO_SETTINGS.sfxOn,
      sfxVolume: volume(value.sfxVolume, DEFAULT_AUDIO_SETTINGS.sfxVolume),
    };
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function loadAudioSettings(): ArcadeAudioSettings {
  try {
    return parseAudioSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_AUDIO_SETTINGS;
  }
}

export function saveAudioSettings(settings: ArcadeAudioSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Speicher gesperrt – dann gilt die Einstellung nur bis zum Neuladen.
  }
}

// ---------------------------------------------------------------------------
// Laufender Stand für React (`useSyncExternalStore`)
// ---------------------------------------------------------------------------

let current: ArcadeAudioSettings | null = null;
const listeners = new Set<() => void>();

export function subscribeAudioSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Gleiche Identität, solange sich nichts ändert – Pflicht für `useSyncExternalStore`. */
export function getAudioSettings(): ArcadeAudioSettings {
  current ??= loadAudioSettings();
  return current;
}

/** Beim Rendern auf dem Server gibt es keinen Speicher – dort gilt die Vorgabe. */
export function getServerAudioSettings(): ArcadeAudioSettings {
  return DEFAULT_AUDIO_SETTINGS;
}

export function updateAudioSettings(patch: Partial<ArcadeAudioSettings>): ArcadeAudioSettings {
  const next = { ...getAudioSettings(), ...patch };
  current = next;
  saveAudioSettings(next);
  for (const listener of listeners) listener();
  return next;
}
