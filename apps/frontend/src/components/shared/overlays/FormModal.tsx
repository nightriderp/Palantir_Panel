'use client';

import { type FormEvent, type ReactNode } from 'react';
import { FormMessage } from '../form/FormMessage';
import { Button } from '../primitives/Button';
import { Modal } from './Modal';

export interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Die Formularfelder. Beschriftungen kommen aus dem aufrufenden Paket. */
  children: ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  /** Wird beim Absenden aufgerufen; `preventDefault` ist bereits erfolgt. */
  onSubmit: () => void;
  /** Absenden gesperrt, z. B. solange Pflichtfelder fehlen. */
  submitDisabled?: boolean;
  busy?: boolean;
  /** Fehlermeldung über der Aktionsleiste (Fehlertext aus dem API-Envelope). */
  error?: string | null;
}

/**
 * Formulardialog – ein Modal, dessen Inhalt in einem `<form>` steckt, damit
 * Enter absendet und Browser-Validierung greift.
 *
 * Die Felder selbst bringt das aufrufende Arbeitspaket mit; hier steht nur der
 * Rahmen samt Aktionsleiste und Fehlerzeile.
 */
export function FormModal({
  open,
  onClose,
  title,
  description,
  children,
  submitLabel = 'Speichern',
  cancelLabel = 'Abbrechen',
  onSubmit,
  submitDisabled = false,
  busy = false,
  error = null,
}: FormModalProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitDisabled || busy) return;
    onSubmit();
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <form onSubmit={handleSubmit} className="pb-6">
        <div className="flex flex-col gap-4">{children}</div>

        {error ? <FormMessage className="mt-4">{error}</FormMessage> : null}

        <div className="mt-5.5 flex flex-wrap justify-end gap-2.5">
          <Button onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant="primary" disabled={submitDisabled || busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
