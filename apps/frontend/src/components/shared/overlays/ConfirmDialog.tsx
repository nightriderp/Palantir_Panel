'use client';

import { type ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { Modal } from './Modal';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Was passiert, wenn bestätigt wird – in einem Satz. */
  message: ReactNode;
  /** Beschriftung der bestätigenden Schaltfläche, z. B. „Neu starten". */
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /** Läuft die Aktion noch, sind beide Schaltflächen gesperrt. */
  busy?: boolean;
}

/**
 * Bestätigungsdialog für Aktionen mit Folgen, die sich aber rückgängig machen
 * lassen (Neustart, Wiederherstellung, Update).
 *
 * Für endgültige Aktionen `DangerConfirmDialog` verwenden.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Abbrechen',
  onConfirm,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-base text-ink-muted">{message}</div>
    </Modal>
  );
}
