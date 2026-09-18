'use client';

import { MESSAGE_REPORT_REASON_MAX_LENGTH, type MessageDto } from '@palantir/contracts';
import { useState } from 'react';
import { FormModal, TextAreaField } from '@/components/shared';

/**
 * Melden einer einzelnen Nachricht mit Begründung (Arbeitspaket F5, Lastenheft §3.6).
 *
 * Die Meldung ist eine **Teilnehmer**-Aktion (`POST /api/chat/messages/:id/report`),
 * keine Moderationsaktion – sie landet in der Warteliste, die ausschließlich der
 * Admin-Bereich (F10) einsehen kann. Von hier führt bewusst kein Weg in fremde
 * Konversationen (Pflichtenheft §15).
 *
 * Ohne Begründung lässt sich nichts einreichen: Ein Moderator kann ohne Grund
 * nicht entscheiden (Vorgabe des Zod-Schemas in `@palantir/validation`).
 */

export interface ReportMessageDialogProps {
  open: boolean;
  message: MessageDto | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

export function ReportMessageDialog({
  open,
  message,
  busy,
  error,
  onClose,
  onSubmit,
}: ReportMessageDialogProps) {
  const [reason, setReason] = useState('');

  // Bei jedem Öffnen mit leerem Feld beginnen – noch während des Renderns,
  // damit kein Bild mit dem alten Text dazwischenliegt.
  const messageId = message?.id ?? null;
  const [zuletzt, setZuletzt] = useState({ open, messageId });
  if (zuletzt.open !== open || zuletzt.messageId !== messageId) {
    setZuletzt({ open, messageId });
    if (open) setReason('');
  }

  const trimmed = reason.trim();

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Nachricht melden"
      description="Die Meldung geht an die Moderation. Bitte gib kurz an, was nicht in Ordnung ist."
      submitLabel="Melden"
      cancelLabel="Abbrechen"
      onSubmit={() => onSubmit(trimmed)}
      submitDisabled={trimmed.length === 0}
      busy={busy}
      error={error}
    >
      <div className="flex flex-col gap-3">
        {message ? (
          <blockquote className="max-h-28 overflow-y-auto rounded-xl border border-line bg-fill px-3 py-2 text-xs text-ink-muted">
            <span className="mb-1 block text-2xs font-medium text-ink-soft">
              {message.senderDisplayName}
            </span>
            {message.content}
          </blockquote>
        ) : null}

        <TextAreaField
          label="Begründung"
          labelAside={`${reason.length} / ${MESSAGE_REPORT_REASON_MAX_LENGTH}`}
          value={reason}
          rows={4}
          maxLength={MESSAGE_REPORT_REASON_MAX_LENGTH}
          placeholder="Warum meldest du diese Nachricht?"
          onChange={setReason}
        />
      </div>
    </FormModal>
  );
}
