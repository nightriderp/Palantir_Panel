'use client';

import { type GameServerDto, type RegistrationRequestDto } from '@palantir/contracts';
import { useState } from 'react';
import { FormModal, SelectField } from '@/components/shared';
import { fetchRegistrationRequests } from '@/lib/api/admin';
import { errorText } from '@/lib/api/client';
import { transferServerOwner } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';

export interface TransferOwnerDialogProps {
  server: GameServerDto;
  open: boolean;
  onClose: () => void;
  /** Der Server mit dem neuen Besitzer, wie ihn das Backend zurückgibt. */
  onTransferred: (server: GameServerDto) => void;
}

/**
 * Besitzer eines Servers wechseln (Lastenheft §3.7, Pflichtenheft §7).
 *
 * Zur Auswahl stehen die **freigeschalteten** Konten aus der Nutzerliste –
 * dieselbe Route wie unter „Nutzer", deshalb braucht der Aufrufer neben
 * `canTransferOwnership` auch `canManageUsers`; ohne beides zeigt die
 * Detailseite den Knopf gar nicht. Gesperrte und wartende Konten fehlen in der
 * Liste, das Backend lehnt sie ohnehin ab (`TRANSFER_TARGET_INVALID`).
 */
export function TransferOwnerDialog({
  server,
  open,
  onClose,
  onTransferred,
}: TransferOwnerDialogProps) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kandidaten = useApiResource<RegistrationRequestDto[]>(
    (signal) => fetchRegistrationRequests({ status: 'approved', limit: 200, offset: 0 }, signal),
    open ? [server.id] : null,
  );

  const options = (kandidaten.data ?? [])
    .filter((eintrag) => eintrag.userId !== server.ownerId)
    .map((eintrag) => ({
      value: eintrag.userId,
      label: eintrag.username
        ? `${eintrag.displayName} (@${eintrag.username})`
        : eintrag.displayName,
    }));

  async function submit() {
    if (target === '') return;
    setBusy(true);
    setError(null);
    const result = await transferServerOwner(server.id, target);
    setBusy(false);
    if (result.success) {
      setTarget('');
      onTransferred(result.data);
      onClose();
    } else {
      setError(errorText(result));
    }
  }

  return (
    <FormModal
      open={open}
      onClose={() => {
        if (busy) return;
        setError(null);
        onClose();
      }}
      title={`Besitzer von „${server.name}" wechseln`}
      description="Der neue Besitzer übernimmt den Server samt Sicherungen und Einstellungen. Der bisherige Besitzer verliert den Zugriff, sofern er nicht als Mitglied eingetragen wird."
      submitLabel="Besitzer wechseln"
      onSubmit={() => void submit()}
      submitDisabled={target === '' || kandidaten.loading}
      busy={busy}
      error={error ?? kandidaten.error}
    >
      <SelectField
        label="Neuer Besitzer"
        value={target}
        onChange={setTarget}
        options={options}
        placeholder={kandidaten.loading ? 'Konten werden geladen …' : 'Konto wählen …'}
        disabled={busy || kandidaten.loading}
        hint={`Bisheriger Besitzer: ${server.ownerDisplayName ?? 'unbekannt'}`}
      />
    </FormModal>
  );
}
