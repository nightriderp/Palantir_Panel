'use client';

import { type ArcadeGameId } from '@palantir/contracts';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ArcadeAudioController, type MusicRequest } from './controller';
import {
  DEFAULT_AUDIO_SETTINGS,
  getAudioSettings,
  getServerAudioSettings,
  subscribeAudioSettings,
  updateAudioSettings,
  type ArcadeAudioSettings,
} from './settings';
import { type SfxName } from './types';

/**
 * Klang der Spielhalle für React.
 *
 * Der Provider umschließt die Spielhalle (und die Admin-Seite „Arcade-Musik").
 * Er schaltet den AudioContext beim ersten Tipp bzw. Tastendruck frei – vorher
 * darf der Browser nichts abspielen – und hält die Musik an, solange der Tab
 * verborgen ist. Ohne Provider liefert `useArcadeAudio()` stumme
 * Platzhalter: Bretter und Tests laufen dann einfach ohne Ton.
 */

export interface ArcadeAudioApi {
  settings: ArcadeAudioSettings;
  updateSettings(patch: Partial<ArcadeAudioSettings>): void;
  /** Musik des Spiels spielen (`null` = Ruhe). Wartet bei Bedarf auf die erste Nutzerhandlung. */
  playMusic(gameId: ArcadeGameId | null): void;
  stopMusic(): void;
  sfx(name: SfxName): void;
  /** Vorhören auf der Admin-Seite – spielt auch bei ausgeschalteter Musik. */
  preview(request: MusicRequest): void;
  /** Schlüssel des klingenden Stücks, siehe `musicRequestKey`. */
  playing: string | null;
  /** Nach Änderungen auf der Admin-Seite: aktive Stücke beim nächsten Mal neu laden. */
  invalidateActiveTracks(): void;
}

const noop = () => undefined;

const SILENT: ArcadeAudioApi = {
  settings: DEFAULT_AUDIO_SETTINGS,
  updateSettings: noop,
  playMusic: noop,
  stopMusic: noop,
  sfx: noop,
  preview: noop,
  playing: null,
  invalidateActiveTracks: noop,
};

const ArcadeAudioContext = createContext<ArcadeAudioApi>(SILENT);

export function ArcadeAudioProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new ArcadeAudioController());
  const settings = useSyncExternalStore(
    subscribeAudioSettings,
    getAudioSettings,
    getServerAudioSettings,
  );
  const playing = useSyncExternalStore(controller.subscribe, controller.getPlaying, () => null);

  useEffect(() => {
    controller.applySettings(settings);
  }, [controller, settings]);

  useEffect(() => {
    const freischalten = () => controller.unlock();
    const sichtbarkeit = () => controller.setHidden(document.visibilityState === 'hidden');
    window.addEventListener('pointerdown', freischalten, true);
    window.addEventListener('keydown', freischalten, true);
    document.addEventListener('visibilitychange', sichtbarkeit);
    return () => {
      window.removeEventListener('pointerdown', freischalten, true);
      window.removeEventListener('keydown', freischalten, true);
      document.removeEventListener('visibilitychange', sichtbarkeit);
      controller.stop();
    };
  }, [controller]);

  const api = useMemo<ArcadeAudioApi>(
    () => ({
      settings,
      updateSettings: (patch) => {
        updateAudioSettings(patch);
      },
      playMusic: controller.playGame,
      stopMusic: controller.stop,
      sfx: controller.sfx,
      preview: controller.preview,
      playing,
      invalidateActiveTracks: () => controller.invalidateActiveTracks(),
    }),
    [controller, settings, playing],
  );

  return <ArcadeAudioContext.Provider value={api}>{children}</ArcadeAudioContext.Provider>;
}

export function useArcadeAudio(): ArcadeAudioApi {
  return useContext(ArcadeAudioContext);
}
