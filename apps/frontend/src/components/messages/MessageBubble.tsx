'use client';

import { type MessageDto } from '@palantir/contracts';
import { Avatar, Icon, cn, formatChatTime } from '@/components/shared';
import { avatarUrl } from '@/lib/auth/api';

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
  /**
   * Profilbild zeigen? Bei der ersten Nachricht einer Folge desselben
   * Absenders – auch in einer DM, wo der Name wegbleibt (Betreiber-Wunsch
   * 21.09.2026).
   *
   * Die Bildspalte bleibt auch ohne Bild stehen: Sonst rückten die
   * Folgenachrichten einer Gruppe nach links und die Blasen stünden nicht mehr
   * untereinander.
   */
  showAvatar: boolean;
  onReport: (message: MessageDto) => void;
  onDelete: (message: MessageDto) => void;
}

export function MessageBubble({
  message,
  mine,
  showSender,
  showAvatar,
  onReport,
  onDelete,
}: MessageBubbleProps) {
  const deleted = message.deletedAt !== null;

  const inhalt = (
    <div className={cn('flex min-w-0 flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      {showSender && !mine ? (
        <span className="px-1 text-2xs font-medium text-ink-soft">
          {message.senderDisplayName}
          {/*
            Der getragene Titel, gedämpft hinter dem Namen (Betreiber-Wunsch
            21.09.2026) – dieselbe Anordnung wie in der Bestenliste und an der
            Server-Kachel.
          */}
          {message.senderTitle === null ? null : (
            <span className="ml-1.5 font-normal text-ink-faint">{message.senderTitle}</span>
          )}
        </span>
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
              ? 'bg-brand-gradient text-white'
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

  // Eigene Beiträge brauchen keine Bildspalte – wer man selbst ist, weiss man.
  if (mine) {
    return <div className="group flex flex-col items-end gap-1">{inhalt}</div>;
  }

  return (
    <div className="group flex items-end gap-2">
      <span className="w-7 shrink-0">
        {showAvatar ? (
          <Avatar
            src={avatarUrl(message.senderId ?? '', message.senderAvatarUpdatedAt)}
            displayName={message.senderId === null ? null : message.senderDisplayName}
            size="sm"
          />
        ) : null}
      </span>
      {inhalt}
    </div>
  );
}
