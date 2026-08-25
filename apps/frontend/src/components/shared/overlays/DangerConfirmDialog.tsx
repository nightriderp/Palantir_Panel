'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { Modal } from './Modal';

export interface DangerConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Was endgültig verloren geht – deutlich benennen, nicht beschönigen. */
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  /**
   * Muss der Nutzer einen Text abtippen, um freizuschalten? Angegeben wird der
   * erwartete Text (z. B. der Servername). Ohne Angabe genügt der Klick.
   */
  confirmationPhrase?: string;
}

/**
 * Gefahren-/Löschbestätigung für endgültige Aktionen (Server löschen, Konto
 * löschen, Sicherung löschen).
 *
 * Ist `confirmationPhrase` gesetzt, bleibt die Schaltfläche gesperrt, bis der
 * Text exakt eingegeben wurde – bewusst ohne Groß-/Kleinschreibungs-Toleranz,
 * damit die Bestätigung eine bewusste Handlung bleibt.
 */
export function DangerConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel = 'Endgültig löschen',
  cancelLabel = 'Abbrechen',
  onConfirm,
  busy = false,
  confirmationPhrase,
}: DangerConfirmDialogProps) {
  const inputId = useId();
  const [typed, setTyped] = useState('');

  // Beim Öffnen und Schließen zurücksetzen, damit eine frühere Eingabe nicht
  // versehentlich die nächste Löschung freischaltet.
  useEffect(() => {
    setTyped('');
  }, [open, confirmationPhrase]);

  const unlocked = confirmationPhrase == null || typed === confirmationPhrase;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      tone="danger"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy || !unlocked}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-base text-ink-muted">{message}</div>

      {confirmationPhrase != null ? (
        <div className="mt-4">
          <label htmlFor={inputId} className="block text-sm text-ink-muted">
            Gib <span className="font-mono text-ink">{confirmationPhrase}</span> ein, um zu
            bestätigen.
          </label>
          <input
            id={inputId}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            className="mt-2 w-full rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none focus-visible:border-brand"
          />
        </div>
      ) : null}
    </Modal>
  );
}
