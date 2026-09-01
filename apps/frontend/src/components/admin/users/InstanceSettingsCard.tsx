'use client';

import { type InstanceSettingsDto } from '@palantir/contracts';
import { useState } from 'react';
import { Panel, ToggleRow, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { updateInstanceSettings } from '@/lib/api/admin';

/**
 * Karte „Selbstregistrierung" über der Nutzerliste (Mockup-Abgleich 12.1.1).
 *
 * Der Schalter entscheidet, ob `POST /auth/register` neue Konten annimmt.
 * Bestehende Konten sind davon unberührt, und ein Administrator kann weiterhin
 * Konten anlegen – die Sperre richtet sich an Fremde, nicht an den Betreiber.
 *
 * Der Zustand kommt von außen und geht bei jeder Änderung dorthin zurück: Die
 * Seite hält ihn an einer Stelle, damit Karte und Anlegen-Dialog nicht
 * auseinanderlaufen.
 */
export function InstanceSettingsCard({
  settings,
  onChanged,
}: {
  settings: InstanceSettingsDto;
  onChanged: (next: InstanceSettingsDto) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function umschalten(enabled: boolean) {
    setBusy(true);
    const result = await updateInstanceSettings({ selfRegistrationEnabled: enabled });
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    onChanged(result.data);
    toast.success(
      enabled
        ? 'Neue Konten können sich wieder selbst registrieren.'
        : 'Die Selbstregistrierung ist geschlossen.',
    );
  }

  return (
    <Panel variant="outline">
      <ToggleRow
        title="Selbstregistrierung"
        description={
          settings.selfRegistrationEnabled
            ? 'Neue Konten können sich selbst registrieren und warten dann auf Freischaltung.'
            : 'Geschlossen – die Registrierung weist neue Konten ab. Anlegen kannst du sie weiterhin selbst.'
        }
        checked={settings.selfRegistrationEnabled}
        disabled={busy || !settings.permissions.canEdit}
        onChange={(enabled) => void umschalten(enabled)}
      />
    </Panel>
  );
}
