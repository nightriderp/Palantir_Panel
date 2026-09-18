'use client';

import { type QuotaRequestTrigger, type ResourceQuotaDto } from '@palantir/contracts';
import { useState, type FormEvent } from 'react';
import { Button, Modal, TextField, useToast } from '@/components/shared';
import { errorText } from '@/lib/api/client';
import { createQuotaRequest } from '@/lib/api/quota-requests';

/**
 * Den Betreiber um etwas bitten (Mockup-Abgleich 12.3.1).
 *
 * Steht dort, wo die Grenze auffällt: im Wizard, wenn das Kontingent den
 * nächsten Schritt blockiert, und in der Rückfrage vor dem Start, wenn die Node
 * zu eng ist. Wer erst suchen muss, wo man fragt, fragt nicht.
 *
 * **Zwei Anlässe, zwei Formulare** (siehe `QuotaRequestTrigger`):
 *
 * - `quota` – „mein Kontingent reicht nicht". Vorbelegt wird mit dem, was
 *   gerade gilt; der Nutzer sieht seine Grenze und trägt daneben ein, was er
 *   braucht. Leer lassen heißt „daran soll sich nichts ändern"; mindestens
 *   eines der beiden Felder muss gefüllt sein, sonst gäbe es nichts zu
 *   entscheiden.
 * - `nodeCapacity` – „die Maschine ist zu eng". Hier gibt es keine Zahl zu
 *   beantragen: Der Betreiber räumt auf oder rüstet nach. Übrig bleibt die
 *   Begründung, und die ist mit dem Befund vorbelegt, an dem der Start geraten
 *   ist – korrigierbar, aber nicht abzutippen.
 */
export function QuotaRequestDialog({
  quota = null,
  anlass = 'quota',
  begruendungsVorschlag = '',
  onClose,
}: {
  /** Kontingent des Aufrufers – nur die `quota`-Anfrage zeigt es an. */
  quota?: ResourceQuotaDto | null;
  anlass?: QuotaRequestTrigger;
  /** Vorschlag für die Begründung; der Nutzer darf ihn ändern. */
  begruendungsVorschlag?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const kontingent = anlass === 'quota';
  const [servers, setServers] = useState('');
  const [reason, setReason] = useState(begruendungsVorschlag);
  const [busy, setBusy] = useState(false);

  const serverWunsch = servers.trim() === '' ? null : Number(servers);
  // Nur die Kontingent-Anfrage braucht einen Wunsch; die Kapazitätsmeldung
  // bittet nicht um eine Zahl (dieselbe Regel wie im Eingabe-Schema). RAM ist
  // seit dem 2026-09-18 keine Kontingentgroesse mehr – nur die Serveranzahl.
  const nichtsGewuenscht = kontingent && serverWunsch === null;

  async function stellen(event: FormEvent) {
    event.preventDefault();
    if (busy || nichtsGewuenscht) return;

    setBusy(true);
    const result = await createQuotaRequest({
      trigger: anlass,
      ...(kontingent && serverWunsch !== null
        ? { requestedMaxConcurrentServers: serverWunsch }
        : {}),
      reason: reason.trim(),
    });
    setBusy(false);

    if (!result.success) {
      toast.error(errorText(result));
      return;
    }

    toast.success(
      kontingent
        ? 'Anfrage gestellt. Die Administration entscheidet darüber.'
        : 'Gemeldet. Die Administration bekommt eine Nachricht.',
    );
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={kontingent ? 'Mehr Kontingent beantragen' : 'Administration benachrichtigen'}
    >
      <form className="flex flex-col gap-3 pb-2" onSubmit={stellen}>
        <p className="text-sm text-ink-muted">
          {kontingent
            ? 'Beschreibe kurz, wofür du mehr brauchst. Ein Administrator entscheidet darüber; du bekommst das Ergebnis in deinem Kontingent zu sehen.'
            : 'Die Administration bekommt eine Nachricht mit deiner Schilderung und kümmert sich um die Node – aufräumen, nachrüsten oder Server umverteilen. Du siehst den Stand unter deinen Anfragen.'}
        </p>

        {kontingent ? (
          <>
            <TextField
              label="Gleichzeitige Server"
              hint={
                quota === null || quota.servers.limit === null
                  ? 'Aktuell ohne Grenze – hier ist nichts zu beantragen.'
                  : `Aktuell ${String(quota.servers.limit)}. Leer lassen, wenn es reicht.`
              }
              value={servers}
              onChange={setServers}
              inputProps={{ inputMode: 'numeric' }}
            />
          </>
        ) : null}

        <TextField
          label={kontingent ? 'Begründung' : 'Was ist passiert?'}
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
            {kontingent ? 'Anfrage stellen' : 'Melden'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
