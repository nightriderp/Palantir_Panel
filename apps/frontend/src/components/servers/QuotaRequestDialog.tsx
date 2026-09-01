'use client';

import { type ResourceQuotaDto } from '@palantir/contracts';
import { useState, type FormEvent } from 'react';
import { Button, Modal, TextField, formatMegabytes, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { createQuotaRequest } from '@/lib/api/quota-requests';

/**
 * Mehr Kontingent beantragen (Mockup-Abgleich 12.3.1).
 *
 * Steht dort, wo die Grenze auffällt: im Wizard, wenn das Kontingent den
 * nächsten Schritt blockiert. Wer erst suchen muss, wo man fragt, fragt nicht.
 *
 * Vorbelegt wird mit dem, was gerade gilt – der Nutzer sieht seine Grenze und
 * trägt daneben ein, was er braucht. Leer lassen heißt „daran soll sich nichts
 * ändern"; mindestens eines der beiden Felder muss gefüllt sein, sonst gäbe es
 * nichts zu entscheiden.
 */
export function QuotaRequestDialog({
  quota,
  onClose,
}: {
  quota: ResourceQuotaDto;
  onClose: () => void;
}) {
  const toast = useToast();
  const [ram, setRam] = useState('');
  const [servers, setServers] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const ramWunsch = ram.trim() === '' ? null : Number(ram);
  const serverWunsch = servers.trim() === '' ? null : Number(servers);
  const nichtsGewuenscht = ramWunsch === null && serverWunsch === null;

  async function stellen(event: FormEvent) {
    event.preventDefault();
    if (busy || nichtsGewuenscht) return;

    setBusy(true);
    const result = await createQuotaRequest({
      ...(ramWunsch === null ? {} : { requestedRamMb: ramWunsch }),
      ...(serverWunsch === null ? {} : { requestedMaxConcurrentServers: serverWunsch }),
      reason: reason.trim(),
    });
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    toast.success('Anfrage gestellt. Die Administration entscheidet darüber.');
    onClose();
  }

  return (
    <Modal open onClose={onClose} title="Mehr Kontingent beantragen">
      <form className="flex flex-col gap-3 pb-2" onSubmit={stellen}>
        <p className="text-sm text-ink-muted">
          Beschreibe kurz, wofür du mehr brauchst. Ein Administrator entscheidet darüber; du
          bekommst das Ergebnis in deinem Kontingent zu sehen.
        </p>

        <TextField
          label="Arbeitsspeicher (MB)"
          hint={
            quota.ram.limit === null
              ? 'Aktuell ohne Grenze – hier ist nichts zu beantragen.'
              : `Aktuell ${formatMegabytes(quota.ram.limit)}. Leer lassen, wenn es reicht.`
          }
          value={ram}
          onChange={setRam}
          inputProps={{ inputMode: 'numeric' }}
        />

        <TextField
          label="Gleichzeitige Server"
          hint={
            quota.servers.limit === null
              ? 'Aktuell ohne Grenze – hier ist nichts zu beantragen.'
              : `Aktuell ${String(quota.servers.limit)}. Leer lassen, wenn es reicht.`
          }
          value={servers}
          onChange={setServers}
          inputProps={{ inputMode: 'numeric' }}
        />

        <TextField
          label="Begründung"
          hint="Mindestens ein Satz – daran entscheidet ein Mensch."
          value={reason}
          onChange={setReason}
          inputProps={{ required: true, minLength: 10, maxLength: 500 }}
        />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Abbrechen
          </Button>
          <Button type="submit" disabled={busy || nichtsGewuenscht}>
            Anfrage stellen
          </Button>
        </div>
      </form>
    </Modal>
  );
}
