'use client';

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  PREFERENCES_STORAGE_KEY,
  type NotificationPreferences,
  parsePreferences,
  serializePreferences,
} from './preferences';

/**
 * Persönliche Anzeige-Einstellungen dieses Browsers (Arbeitspaket F6).
 *
 * Liest und schreibt den `localStorage`-Eintrag aus `preferences.ts`. Der
 * Speicher ist als externe Quelle angebunden (`useSyncExternalStore`): Auf
 * dem Server und beim Hydratisieren gilt die Vorgabe (`localStorage` gibt es
 * dort nicht), im Browser der gespeicherte Text – so stimmen Server- und
 * Browser-Ausgabe überein, ohne dass ein Effekt den Wert nachziehen muss.
 */

function keinAbo(): () => void {
  return () => {};
}

/** Roher Eintrag; `null`, wenn keiner da ist oder der Speicher gesperrt ist. */
function ausSpeicher(): string | null {
  try {
    return window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
  } catch {
    // Gesperrter oder fehlender Speicher: die Vorgabe genügt.
    return null;
  }
}

/** `undefined` unterscheidet „noch nicht gelesen" von „nichts gespeichert". */
function aufDemServer(): undefined {
  return undefined;
}

export function useNotificationPreferences(): {
  preferences: NotificationPreferences;
  update: (next: NotificationPreferences) => void;
  /** Erst nach dem ersten Rendern `true` – bis dahin gilt die Vorgabe. */
  ready: boolean;
} {
  const gespeichert = useSyncExternalStore(keinAbo, ausSpeicher, aufDemServer);
  const ready = gespeichert !== undefined;

  // Was in dieser Sitzung gesetzt wurde, gilt vor dem Speicher – auch wenn
  // sich der Eintrag nicht schreiben ließ.
  const [gesetzt, setGesetzt] = useState<NotificationPreferences | null>(null);

  const preferences = useMemo(
    () =>
      gesetzt ??
      (gespeichert === undefined
        ? DEFAULT_NOTIFICATION_PREFERENCES
        : parsePreferences(gespeichert)),
    [gesetzt, gespeichert],
  );

  const update = useCallback((next: NotificationPreferences) => {
    setGesetzt(next);
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serializePreferences(next));
    } catch {
      // Ohne Speicher gilt die Einstellung eben nur für diese Sitzung.
    }
  }, []);

  return { preferences, update, ready };
}
