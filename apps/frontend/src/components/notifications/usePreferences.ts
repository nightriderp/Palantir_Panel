'use client';

import { useCallback, useEffect, useState } from 'react';
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
 * Liest und schreibt den `localStorage`-Eintrag aus `preferences.ts`. Gelesen
 * wird erst nach dem ersten Rendern, damit Server- und Browser-Ausgabe
 * übereinstimmen (`localStorage` gibt es auf dem Server nicht) – dieselbe
 * Vorgehensweise wie bei `usePinnedServers` in F3.
 */
export function useNotificationPreferences(): {
  preferences: NotificationPreferences;
  update: (next: NotificationPreferences) => void;
  /** Erst nach dem ersten Rendern `true` – bis dahin gilt die Vorgabe. */
  ready: boolean;
} {
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setPreferences(parsePreferences(window.localStorage.getItem(PREFERENCES_STORAGE_KEY)));
    } catch {
      // Gesperrter oder fehlender Speicher: die Vorgabe genügt.
    }
    setReady(true);
  }, []);

  const update = useCallback((next: NotificationPreferences) => {
    setPreferences(next);
    try {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, serializePreferences(next));
    } catch {
      // Ohne Speicher gilt die Einstellung eben nur für diese Sitzung.
    }
  }, []);

  return { preferences, update, ready };
}
