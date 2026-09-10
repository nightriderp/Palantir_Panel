'use client';

import { type RegistrationRequestDto, type RoleDto } from '@palantir/contracts';
import { useState } from 'react';
import { FormModal, ToggleRow } from '@/components/shared';
import { fetchRoles } from '@/lib/api/admin';
import { useApiResource } from '@/lib/api/useApiResource';

/**
 * Freigabe eines wartenden Kontos mit optionaler Rollenauswahl (ohne Auswahl
 * vergibt das Backend „Nutzer").
 *
 * Steht seit Fundpunkt 214 in einer eigenen Datei: Er wird an zwei Stellen
 * gebraucht – in der Warteliste („Anfragen") und in der Nutzerverwaltung, wo
 * derselbe Statusfilter „Wartet auf Freigabe" die wartenden Konten zeigt.
 * Dort gab es die Aktion vorher nicht, obwohl der Eintrag `canApprove` trägt;
 * wer über die Nutzerliste kam, sah ein wartendes Konto und keinen Weg, es
 * freizugeben.
 */
export function ApproveDialog({
  request,
  busy,
  onClose,
  onSubmit,
}: {
  request: RegistrationRequestDto;
  busy: boolean;
  onClose: () => void;
  onSubmit: (roleIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const roles = useApiResource<RoleDto[]>((signal) => fetchRoles(signal), []);

  // Die geschützte Gast-Rolle steht nicht zur Auswahl: Freigeben heißt gerade,
  // sie zu ersetzen (registration-request.ts).
  const assignable = (roles.data ?? []).filter((role) => !role.isProtected);

  function toggle(roleId: string, on: boolean) {
    setSelected((current) => (on ? [...current, roleId] : current.filter((id) => id !== roleId)));
  }

  return (
    <FormModal
      open
      onClose={onClose}
      title={`„${request.displayName}" freigeben`}
      description={'Ohne Auswahl erhält das Konto die Standardrolle „Nutzer".'}
      submitLabel="Freigeben"
      busy={busy}
      onSubmit={() => onSubmit(selected)}
    >
      {roles.loading ? (
        <p className="text-sm text-ink-faint">Rollen werden geladen …</p>
      ) : assignable.length === 0 ? (
        <p className="text-sm text-ink-faint">Keine zusätzlichen Rollen verfügbar.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {assignable.map((role) => (
            <ToggleRow
              key={role.id}
              title={role.name}
              description={role.description ?? undefined}
              checked={selected.includes(role.id)}
              onChange={(on) => toggle(role.id, on)}
            />
          ))}
        </div>
      )}
    </FormModal>
  );
}
