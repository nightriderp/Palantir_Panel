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

export interface LifecycleRunOptions {
  /**
   * Beschriftung der laufenden Meldung; ohne Angabe die des Befehls.
   *
   * Gebraucht für das Aktualisieren (Fundpunkt 190): Es läuft über denselben
   * Neustart, heißt für den Betreiber aber nicht „wird neu gestartet".
   */
  readonly label?: string;
  /**
   * Die Rückfrage „die Node ist eng – trotzdem?" ist bereits beantwortet.
   *
   * Setzt {@link LifecycleActions.confirmation} selbst, wenn der Aufrufer die
   * Frage stellen soll; von außen wird es nur gebraucht, wo eine eigene
   * Bestätigung vorausging.
   */
  readonly erzwingen?: boolean;
}

/**
 * Offene Rückfrage der Kapazitätsprüfung (`RESOURCE_CONFIRMATION_REQUIRED`).
 *
 * Sie entsteht, wenn die Ziel-Node wenig frei hat – nicht, wenn eine Grenze
 * überschritten ist. Der Unterschied ist der Grund für diesen Zustand statt
 * einer Fehlermeldung: Eine Grenze hat jemand gesetzt und bleibt stehen, eine
 * knappe Node ist eine Beobachtung, auf die der Betreiber antworten darf.
 *
 * Solange sie offen steht, läuft nichts – erst {@link LifecycleConfirmation.confirm}
 * schickt denselben Befehl erneut, diesmal mit `force`.
 */
export interface LifecycleConfirmation {
  readonly server: GameServerDto;
  readonly action: LifecycleAction;
  /** Anzeigetext aus dem Fehlercode-Katalog (Pflichtenheft §5.1). */
  readonly message: string;
  /** Befehl erneut schicken, diesmal erzwungen. */
  readonly confirm: () => void;
  /** Rückfrage verwerfen; es passiert nichts. */
  readonly cancel: () => void;
}

export interface LifecycleActions {
  /** Id des Servers, für den gerade eine Aktion läuft; sonst `null`. */
  pendingServerId: string | null;
  /** Offene Rückfrage; `null`, solange keine aussteht. */
  confirmation: LifecycleConfirmation | null;
  run: (
    server: GameServerDto,
    action: LifecycleAction,
    options?: LifecycleRunOptions,
  ) => Promise<GameServerDto | null>;
}

export function useLifecycleActions(
  /** Wird mit dem aktualisierten Server aufgerufen, wenn die Aktion griff. */
  onUpdated?: (server: GameServerDto) => void,
): LifecycleActions {
  const toast = useToast();
  const [pendingServerId, setPendingServerId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<LifecycleConfirmation | null>(null);

  const run = useCallback(
    // Benannter Funktionsausdruck: Die Bestätigung schickt denselben Befehl
    // erneut und braucht dazu einen Namen, der nicht erst nach `useCallback`
    // existiert – sonst hänge die Funktion in ihrer eigenen Abhängigkeitsliste.
    async function ausfuehren(
      server: GameServerDto,
      action: LifecycleAction,
      options?: LifecycleRunOptions,
    ): Promise<GameServerDto | null> {
      const erzwingen = options?.erzwingen === true;

      setPendingServerId(server.id);
      const toastId = toast.show(options?.label ?? RUNNING_LABEL[action], { durationMs: 8000 });

      const result = await runLifecycleAction(
        server.id,
        action,
        erzwingen ? { erzwingen: true } : {},
      );
      setPendingServerId(null);
      toast.dismiss(toastId);

      if (!result.success) {
        /*
         * Keine Ablehnung, sondern eine Frage: Das Backend hat die Grenzen
         * geprüft und nichts gefunden – nur die Node ist eng. Eine Fehlermeldung
         * wäre hier falsch; sie ließe den Betreiber ratlos vor einer Aktion
         * stehen, die sehr wohl möglich ist.
         */
        if (result.error.code === 'RESOURCE_CONFIRMATION_REQUIRED' && !erzwingen) {
          setConfirmation({
            server,
            action,
            message: errorText(result),
            confirm: () => {
              setConfirmation(null);
              void ausfuehren(server, action, { ...options, erzwingen: true });
            },
            cancel: () => setConfirmation(null),
          });

          return null;
        }

        toast.error(errorText(result));
        return null;
      }

      onUpdated?.(result.data);
      return result.data;
    },
    [onUpdated, toast],
  );

  return { pendingServerId, confirmation, run };
}
