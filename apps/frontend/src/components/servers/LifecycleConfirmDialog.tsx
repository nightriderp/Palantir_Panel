'use client';

import { ConfirmDialog } from '@/components/shared';
import { type LifecycleConfirmation } from './useLifecycleActions';

/**
 * Rückfrage „die Node ist eng – trotzdem starten?" (Pflichtenheft §10).
 *
 * Das Gegenstück zur weichen Prüfung im Backend: Sie lehnt nicht ab, sie fragt.
 * Deshalb ein {@link ConfirmDialog} und kein Fehlerdialog – die Aktion ist
 * möglich, sie ist nur nicht unbedenklich.
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
  const neustart = confirmation?.action === 'restart';

  return (
    <ConfirmDialog
      open={confirmation !== null}
      onClose={() => confirmation?.cancel()}
      title={neustart ? 'Trotzdem neu starten?' : 'Trotzdem starten?'}
      message={
        <div className="space-y-2">
          <p>{confirmation?.message}</p>
          <p className="text-ink-faint">
            Der Start ist erlaubt – das Panel weist nur darauf hin. Geht der Node der
            Arbeitsspeicher aus, kann dieser Server beim Start abbrechen oder ein anderer vom System
            beendet werden.
          </p>
        </div>
      }
      confirmLabel={neustart ? 'Trotzdem neu starten' : 'Trotzdem starten'}
      onConfirm={() => confirmation?.confirm()}
    />
  );
}
