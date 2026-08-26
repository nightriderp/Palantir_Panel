'use client';

import { type GameServerDto } from '@palantir/contracts';
import { useCallback, useState } from 'react';
import { useToast } from '@/components/shared';
import { type LifecycleAction, runLifecycleAction } from '@/lib/api/servers';
import { errorText } from '@/lib/api/client';

/**
 * Start, Stopp und Neustart eines Servers (Pflichtenheft §9).
 *
 * Die Aktion wird angestoßen, das Ergebnis kommt als aktualisierter DTO zurück;
 * der weitere Verlauf (`starting → running`) läuft über den Live-Kanal. Ob eine
 * Aktion überhaupt angeboten wird, entscheidet allein das `permissions`-Objekt
 * an der aufrufenden Stelle – hier wird nichts nachgeprüft.
 */

const RUNNING_LABEL: Record<LifecycleAction, string> = {
  start: 'Server wird gestartet …',
  stop: 'Server wird gestoppt …',
  restart: 'Server wird neu gestartet …',
};

export interface LifecycleActions {
  /** Id des Servers, für den gerade eine Aktion läuft; sonst `null`. */
  pendingServerId: string | null;
  run: (server: GameServerDto, action: LifecycleAction) => Promise<GameServerDto | null>;
}

export function useLifecycleActions(
  /** Wird mit dem aktualisierten Server aufgerufen, wenn die Aktion griff. */
  onUpdated?: (server: GameServerDto) => void,
): LifecycleActions {
  const toast = useToast();
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);

  const run = useCallback(
    async (server: GameServerDto, action: LifecycleAction) => {
      setPendingServerId(server.id);
      const toastId = toast.show(RUNNING_LABEL[action], { durationMs: 8000 });

      const result = await runLifecycleAction(server.id, action);
      setPendingServerId(null);
      toast.dismiss(toastId);

      if (!result.success) {
        toast.error(errorText(result));
        return null;
      }

      onUpdated?.(result.data);
      return result.data;
    },
    [onUpdated, toast],
  );

  return { pendingServerId, run };
}
