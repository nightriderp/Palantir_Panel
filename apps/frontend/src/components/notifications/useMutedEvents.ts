'use client';

import {
  MUTABLE_NOTIFICATION_EVENTS,
  type MutableNotificationEvent,
  isMutableNotificationEvent,
} from '@palantir/contracts';
import { useCallback, useEffect, useState } from 'react';
import { errorText } from '@/lib/api/client';
import { fetchNotificationPreferences, saveNotificationPreferences } from '@/lib/api/notifications';
import { type NotificationGroup } from './notificationView';

/**
 * Abbestellte Ereignisse des Kontos (WORK_STATUS.md, Gefundener Punkt 93).
 *
 * **Abgrenzung zu `usePreferences`:** Dort liegen die Anzeige-Vorlieben dieses
 * Browsers (Einblendung, Browser-Mitteilung, Startfilter). Hier geht es um die
 * Zustellung selbst: Ein abbestelltes Ereignis landet auf **keinem** Gerät mehr
 * in der Inbox. Deshalb steht es am Konto und nicht im `localStorage`.
 *
 * Gespeichert wird sofort beim Umlegen und nicht über einen „Speichern"-Knopf:
 * Ein einzelner Schalter ist die ganze Änderung. Scheitert das Speichern, geht
 * der Schalter zurück und die Meldung erscheint – sonst zeigte die Oberfläche
 * einen Zustand, den der Server nicht kennt.
 */
export interface MutedEvents {
  /** Noch nicht geladen: Die Schalter bleiben so lange gesperrt. */
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: string | null;
  /** Kommen Meldungen dieser Gruppe an? `false`, sobald ein Ereignis daraus fehlt. */
  receives(group: NotificationGroup): boolean;
  /** Ganze Gruppe an- oder abbestellen. */
  setGroup(group: NotificationGroup, receive: boolean): void;
}

/** Die abbestellbaren Ereignisse einer Gruppe – Ankündigungen sind nicht dabei. */
function mutableEventsOf(group: NotificationGroup): MutableNotificationEvent[] {
  return group.events.filter(isMutableNotificationEvent);
}

export function useMutedEvents(): MutedEvents {
  const [muted, setMuted] = useState<readonly MutableNotificationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetchNotificationPreferences(controller.signal).then((result) => {
      if (controller.signal.aborted) return;

      if (result.success) {
        setMuted(result.data.mutedEvents);
        setError(null);
      } else {
        setError(errorText(result));
      }

      setLoading(false);
    });

    return () => {
      controller.abort();
    };
  }, []);

  const receives = useCallback(
    (group: NotificationGroup) => mutableEventsOf(group).every((event) => !muted.includes(event)),
    [muted],
  );

  const setGroup = useCallback(
    (group: NotificationGroup, receive: boolean) => {
      const betroffen = mutableEventsOf(group);
      const vorher = muted;
      const nachher = receive
        ? muted.filter((event) => !betroffen.includes(event))
        : [...new Set([...muted, ...betroffen])];

      // Erst umlegen, dann speichern: Der Schalter soll ohne Verzögerung
      // reagieren; scheitert das Speichern, wird er zurückgenommen.
      setMuted(nachher);
      setSaving(true);

      void saveNotificationPreferences({ mutedEvents: [...nachher] }).then((result) => {
        if (result.success) {
          setMuted(result.data.mutedEvents);
          setError(null);
        } else {
          setMuted(vorher);
          setError(errorText(result));
        }

        setSaving(false);
      });
    },
    [muted],
  );

  return { loading, saving, error, receives, setGroup };
}

/** Alle Gruppen, in denen sich überhaupt etwas abbestellen lässt. */
export function mutableGroups(groups: readonly NotificationGroup[]): NotificationGroup[] {
  return groups.filter((group) => mutableEventsOf(group).length > 0);
}

/** Zur Sicherheit im Test: Der Vertrag führt jedes Ereignis ausser der Ankündigung. */
export const MUTABLE_EVENT_COUNT = MUTABLE_NOTIFICATION_EVENTS.length;
