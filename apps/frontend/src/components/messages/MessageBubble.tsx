'use client';

import { type MessageDto } from '@palantir/contracts';
import { Icon, cn, formatChatTime } from '@/components/shared';

/**
 * Eine einzelne Nachricht im Verlauf (Arbeitspaket F5).
 *
 * Eigene Beiträge stehen rechts im Marken-Verlauf, fremde links. Im Server-Chat
 * trägt jede fremde Nachricht den Absendernamen – in einer DM ist er überflüssig,
 * dort gibt es nur ein Gegenüber.
 *
 * Ob „Löschen" oder „Melden" erscheint, entscheidet allein das `permissions`-
 * Objekt der Nachricht (Pflichtenheft §5.2). Ein Moderator bekommt hier **kein**
 * Löschen an einer Meldung vorbei – `canDelete` ist nur am eigenen Beitrag `true`
 * (B7).
 */

export interface MessageBubbleProps {
  message: MessageDto;
  /** Stammt die Nachricht vom angemeldeten Konto? */
  mine: boolean;
  /** Absendernamen zeigen? Nur im Server-Chat bei fremden Nachrichten sinnvoll. */
  showSender: boolean;
  onReport: (message: MessageDto) => void;
  onDelete: (message: MessageDto) => void;
}

export function MessageBubble({
  message,
  mine,
  showSender,
  onReport,
  onDelete,
}: MessageBubbleProps) {
  const deleted = message.deletedAt !== null;

  return (
    <div className={cn('group flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {showSender && !mine ? (
        <span className="px-1 text-2xs font-medium text-ink-soft">{message.senderDisplayName}</span>
      ) : null}

      <div
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]',
          // Die Ecke zum Absender hin bleibt fast eckig – die Blase zeigt damit,
          // von welcher Seite sie kommt (so auch im Entwurf).
          mine ? 'rounded-br-sm' : 'rounded-bl-sm',
          deleted
            ? 'border border-dashed border-line-strong bg-transparent italic text-ink-faint'
            : mine
              ? 'bg-brand-gradient text-white shadow-brand'
              : 'bg-fill text-ink',
        )}
      >
        {deleted
          ? message.deletedByModerator
            ? 'Diese Nachricht wurde nach einer Meldung entfernt.'
            : 'Diese Nachricht wurde gelöscht.'
          : message.content}
      </div>

      <div className="flex items-center gap-2 px-1">
        <span className="text-2xs text-ink-faint">{formatChatTime(message.createdAt)}</span>

        {!deleted && message.permissions.canReport ? (
          message.reportedByViewer ? (
            <span className="text-2xs text-ink-faint">Gemeldet</span>
          ) : (
            <button
              type="button"
              onClick={() => onReport(message)}
              className="flex items-center gap-1 text-2xs text-ink-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Icon name="warning" size={11} />
              Melden
            </button>
          )
        ) : null}

        {!deleted && message.permissions.canDelete ? (
          <button
            type="button"
            onClick={() => onDelete(message)}
            className="flex items-center gap-1 text-2xs text-ink-faint opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Icon name="trash" size={11} />
            Löschen
          </button>
        ) : null}
      </div>
    </div>
  );
}
