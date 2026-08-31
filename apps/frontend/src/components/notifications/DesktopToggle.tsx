'use client';

import { useEffect, useState } from 'react';
import { Panel, ToggleRow, useToast } from '@/components/shared';
import {
  type DesktopPermission,
  desktopBedienbar,
  desktopHinweis,
  desktopPermission,
  requestDesktopPermission,
} from './desktop';
import { type NotificationPreferences } from './preferences';

/**
 * Schalter für Browser-Mitteilungen (Arbeitspaket F6, Lastenheft §3.6).
 *
 * Steht an **zwei** Stellen: als Karte über dem Posteingang – so wie im Entwurf –
 * und als Zeile im Reiter „Einstellungen" zwischen den übrigen Schaltern. Das
 * ist nicht dieselbe Einstellung zweimal, sondern derselbe Schalter zweimal: Der
 * Wert liegt einmal in den Vorlieben der Ansicht, beide Stellen lesen und
 * schreiben ihn. Wer ihn oben umlegt, sieht ihn unten sofort umgelegt.
 *
 * Die Erlaubnis holt der Browser nur aus einer Nutzeraktion heraus, deshalb
 * hängt die Abfrage am Umschalten und nicht am Laden.
 */

export interface DesktopToggleProps {
  preferences: NotificationPreferences;
  onChange: (next: NotificationPreferences) => void;
  /**
   * `card` – eigenständige Karte mit Überschrift (Posteingang).
   * `row` – nur die Schalterzeile, die Überschrift steht daneben (Einstellungen).
   */
  variant?: 'card' | 'row';
}

export function DesktopToggle({ preferences, onChange, variant = 'row' }: DesktopToggleProps) {
  const toast = useToast();
  const [permission, setPermission] = useState<DesktopPermission>('unsupported');

  useEffect(() => {
    setPermission(desktopPermission());
  }, []);

  async function umschalten(enabled: boolean) {
    if (!enabled) {
      onChange({ ...preferences, desktopEnabled: false });
      return;
    }

    const granted = await requestDesktopPermission();
    setPermission(desktopPermission());

    if (granted) {
      onChange({ ...preferences, desktopEnabled: true });
    } else {
      toast.warning('Der Browser hat die Erlaubnis für Mitteilungen nicht erteilt.');
    }
  }

  const zeile = (
    <ToggleRow
      title="Mitteilungen des Browsers"
      description={desktopHinweis(permission)}
      checked={preferences.desktopEnabled && permission === 'granted'}
      disabled={!desktopBedienbar(permission)}
      onChange={(enabled) => void umschalten(enabled)}
    />
  );

  if (variant === 'row') return zeile;

  /*
   * Über dem Posteingang nur, wenn der Schalter überhaupt etwas bewirken kann.
   * Eine tote Karte über jeder Meldungsliste wäre reiner Lärm – im Reiter
   * „Einstellungen" steht sie weiterhin und erklärt dort, warum sie tot ist.
   */
  if (!desktopBedienbar(permission)) return null;

  return (
    <Panel variant="outline" className="flex flex-col gap-1">
      <h2 className="text-base font-semibold text-ink">Browser-Mitteilungen</h2>
      <p className="text-sm text-ink-muted">
        Erlaube deinem Browser, dich bei neuen Meldungen zu benachrichtigen – auch dann, wenn das
        Panel nicht im Vordergrund steht.
      </p>
      <div className="mt-1.5">{zeile}</div>
    </Panel>
  );
}
