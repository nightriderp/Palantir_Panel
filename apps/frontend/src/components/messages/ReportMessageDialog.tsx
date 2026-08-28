'use client';

import { MESSAGE_REPORT_REASON_MAX_LENGTH, type MessageDto } from '@palantir/contracts';
import { useEffect, useId, useState } from 'react';
import { FormModal } from '@/components/shared';

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
  const fieldId = useId();

  // Bei jedem Öffnen mit leerem Feld beginnen.
  useEffect(() => {
    if (open) setReason('');
  }, [open, message?.id]);

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

        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-sm text-ink-muted">
            Begründung
          </label>
          <textarea
            id={fieldId}
            value={reason}
            rows={4}
            maxLength={MESSAGE_REPORT_REASON_MAX_LENGTH}
            placeholder="Warum meldest du diese Nachricht?"
            onChange={(event) => setReason(event.target.value)}
            className="w-full resize-y rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none placeholder:text-ink-disabled focus-visible:border-brand"
          />
          <span className="self-end text-2xs text-ink-faint">
            {reason.length} / {MESSAGE_REPORT_REASON_MAX_LENGTH}
          </span>
        </div>
      </div>
    </FormModal>
  );
}
