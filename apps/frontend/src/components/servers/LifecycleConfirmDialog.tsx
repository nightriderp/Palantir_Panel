'use client';

import { useState } from 'react';
import { Button, Modal } from '@/components/shared';
import { QuotaRequestDialog } from './QuotaRequestDialog';
import { type LifecycleConfirmation } from './useLifecycleActions';

/**
 * Rückfrage „die Node ist eng – trotzdem starten?" (Pflichtenheft §10).
 *
 * Das Gegenstück zur weichen Prüfung im Backend: Sie lehnt nicht ab, sie fragt.
 * Deshalb kein Fehlerdialog – die Aktion ist möglich, sie ist nur nicht
 * unbedenklich.
 *
 * **Drei Wege statt zwei.** Neben „abbrechen" und „trotzdem" steht der dritte,
 * den der Betreiber ausdrücklich wollte: die Administration benachrichtigen.
 * Wer den Server nicht selbst freiräumen kann – und das ist auf einer fremden
 * Node jeder außer dem Betreiber –, stand sonst vor einer Wahl zwischen
 * „aufgeben" und „auf gut Glück". Eigener Knopf statt eines Hinweistextes: Ein
 * Weg, den man suchen muss, wird nicht gegangen.
 *
 * Der Satz zur Lage kommt aus dem Fehlercode-Katalog (`message`); was er
 * bedeutet, steht darunter. Bewusst ohne Zahlen: Die Oberfläche übersetzt über
 * den **Code**, nicht über den Freitext der Antwort (Pflichtenheft §5.1) – die
 * genauen Werte stehen im Log und in der Node-Übersicht.
 */
export function LifecycleConfirmDialog({
  confirmation,
}: {
  confirmation: LifecycleConfirmation | null;
}) {
  const [melden, setMelden] = useState(false);
  const neustart = confirmation?.action === 'restart';

  if (confirmation !== null && melden) {
    return (
      <QuotaRequestDialog
        anlass="nodeCapacity"
        begruendungsVorschlag={vorschlag(confirmation)}
        onClose={() => {
          setMelden(false);
          // Der Start bleibt aus: Wer meldet, hat sich gegen das „trotzdem"
          // entschieden.
          confirmation.cancel();
        }}
      />
    );
  }

  return (
    <Modal
      open={confirmation !== null}
      onClose={() => confirmation?.cancel()}
      title={neustart ? 'Trotzdem neu starten?' : 'Trotzdem starten?'}
      footer={
        <>
          <Button onClick={() => confirmation?.cancel()}>Abbrechen</Button>
          <Button onClick={() => setMelden(true)}>Administration benachrichtigen</Button>
          <Button variant="primary" onClick={() => confirmation?.confirm()}>
            {neustart ? 'Trotzdem neu starten' : 'Trotzdem starten'}
          </Button>
        </>
      }
    >
      <div className="space-y-2 text-base text-ink-muted">
        <p>{confirmation?.message}</p>
        <p className="text-ink-faint">
          Der Start ist erlaubt – das Panel weist nur darauf hin. Geht der Node der Arbeitsspeicher
          aus, kann dieser Server beim Start abbrechen oder ein anderer vom System beendet werden.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Vorschlag für die Schilderung an die Administration.
 *
 * Aus dem, was das Frontend selbst weiß – Servername und Anlass. Bewusst nicht
 * aus dem Freitext der Fehlerantwort: Der gehört ins Log, nicht in die
 * Oberfläche (Pflichtenheft §5.1). Der Nutzer kann den Satz ergänzen, bevor er
 * ihn abschickt.
 */
function vorschlag(confirmation: LifecycleConfirmation): string {
  const was = confirmation.action === 'restart' ? 'neu starten' : 'starten';

  return `„${confirmation.server.name}" ließ sich nicht ${was}: Auf der Ziel-Node ist gerade zu wenig frei.`;
}
