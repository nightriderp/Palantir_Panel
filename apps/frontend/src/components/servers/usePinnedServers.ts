'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Angeheftete Server der Übersicht (Mockup „📌 Angepinnt").
 *
 * **Bewusst nur lokal:** Im `GameServerDto` gibt es kein Feld dafür, und das
 * Anheften ist eine reine Anzeigevorliebe dieses Geräts. Gespeichert wird
 * deshalb im `localStorage`. Sobald das Backend die Vorliebe am Konto führt,
 * wandert das hierher hinein – vermerkt unter „Gefundene Punkte".
 */

const STORAGE_KEY = 'palantir.pinnedServers';

function read(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string') : [];
  } catch {
    // Beschädigter oder gesperrter Speicher darf die Übersicht nicht aufhalten.
    return [];
  }
}

export function usePinnedServers(): {
  pinnedIds: string[];
  isPinned: (serverId: string) => boolean;
  togglePin: (serverId: string) => void;
} {
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);

  // Erst nach dem ersten Rendern lesen, damit Server- und Browser-Ausgabe
  // übereinstimmen (`localStorage` gibt es auf dem Server nicht).
  useEffect(() => {
    setPinnedIds(read());
  }, []);

  const togglePin = useCallback((serverId: string) => {
    setPinnedIds((current) => {
      const next = current.includes(serverId)
        ? current.filter((entry) => entry !== serverId)
        : [...current, serverId];

      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ohne Speicher bleibt die Anheftung eben nur für diese Sitzung.
      }
      return next;
    });
  }, []);

  const isPinned = useCallback((serverId: string) => pinnedIds.includes(serverId), [pinnedIds]);

  return { pinnedIds, isPinned, togglePin };
}
