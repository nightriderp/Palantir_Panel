'use client';

import { type GameServerDto } from '@palantir/contracts';
import { useCallback, useMemo } from 'react';
import { pinServer, unpinServer } from '@/lib/api/servers';

/**
 * Angeheftete Server der Übersicht (Mockup „📌 Angepinnt";
 * WORK_STATUS.md, Gefundener Punkt 50).
 *
 * **Seit dem Backend-Feld am Konto**: Die Anheftung steht im
 * `GameServerDto.pinned` und gilt damit auf jedem Gerät. Vorher lag sie im
 * `localStorage` und war pro Browser verschieden – wer am Telefon anheftete,
 * sah am Rechner nichts davon.
 *
 * Die Liste kommt deshalb nicht mehr aus einem eigenen Zustand, sondern aus den
 * geladenen Servern. Umgeschaltet wird sofort in der Anzeige und danach am
 * Server; scheitert der Aufruf, nimmt der Aufrufer die Änderung über sein
 * `onError` zurück (er hält die Liste).
 */
export function usePinnedServers(servers: readonly GameServerDto[]): {
  pinnedIds: string[];
  isPinned: (serverId: string) => boolean;
  /** Schaltet die Anheftung um; liefert den Server aus der Antwort. */
  togglePin: (server: GameServerDto) => Promise<GameServerDto | null>;
} {
  const pinnedIds = useMemo(
    () => servers.filter((server) => server.pinned).map((server) => server.id),
    [servers],
  );

  const isPinned = useCallback((serverId: string) => pinnedIds.includes(serverId), [pinnedIds]);

  const togglePin = useCallback(async (server: GameServerDto) => {
    const antwort = server.pinned ? await unpinServer(server.id) : await pinServer(server.id);

    return antwort.success ? antwort.data : null;
  }, []);

  return { pinnedIds, isPinned, togglePin };
}
