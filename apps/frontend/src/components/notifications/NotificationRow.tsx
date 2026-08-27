'use client';

import { type NotificationDto } from '@palantir/contracts';
import { Badge, Icon, IconButton, cn, formatDateTime } from '@/components/shared';
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_SEVERITY_LABELS,
  NOTIFICATION_SEVERITY_TONES,
  iconOfEvent,
  subjectHref,
} from './notificationView';

/**
 * Eine Zeile der Inbox (Arbeitspaket F6, Mockup „Benachrichtigungen").
 *
 * Rein darstellend: Titel und Text kommen fertig aus dem Backend
 * (Pflichtenheft §5.2), Aktionen meldet die Zeile nur nach oben. Ob ein Sprung
 * an die betroffene Stelle möglich ist, entscheidet {@link subjectHref} – gibt
 * es kein Ziel, ist die Zeile keine Verknüpfung.
 */

export interface NotificationRowProps {
  notification: NotificationDto;
  /** Sprung zur betroffenen Ressource (nur wenn es ein Ziel gibt). */
  onOpen: (href: string) => void;
  onToggleRead: (notification: NotificationDto) => void;
  onDelete: (notification: NotificationDto) => void;
}

export function NotificationRow({
  notification,
  onOpen,
  onToggleRead,
  onDelete,
}: NotificationRowProps) {
  const unread = notification.readAt === null;
  const href = subjectHref(notification.subject);
  const tone = NOTIFICATION_SEVERITY_TONES[notification.severity];

  function open() {
    if (href) onOpen(href);
  }

  return (
    <div
      className={cn(
        'flex gap-3 border-b border-line px-4 py-3.5 last:border-b-0',
        unread && 'bg-brand-soft/40',
      )}
    >
      <div className="mt-0.5 shrink-0">
        <Icon name={iconOfEvent(notification.event)} size={16} className="text-ink-soft" />
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={cn('flex flex-col gap-1', href && 'cursor-pointer')}
          onClick={href ? open : undefined}
          role={href ? 'link' : undefined}
          tabIndex={href ? 0 : undefined}
          onKeyDown={
            href
              ? (event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open();
                  }
                }
              : undefined
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            {unread ? (
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand" />
            ) : null}
            <span
              className={cn(
                'text-base',
                unread ? 'font-semibold text-ink' : 'font-medium text-ink-muted',
              )}
            >
              {notification.title}
            </span>
            {notification.severity !== 'info' ? (
              <Badge tone={tone}>{NOTIFICATION_SEVERITY_LABELS[notification.severity]}</Badge>
            ) : null}
          </div>

          <p className="text-sm text-ink-muted">{notification.body}</p>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-2xs text-ink-faint">
            <span>{formatDateTime(notification.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>{NOTIFICATION_EVENT_LABELS[notification.event]}</span>
            {href ? (
              <>
                <span aria-hidden>·</span>
                <span className="text-brand">Öffnen →</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-start gap-1">
        {notification.permissions.canMarkRead ? (
          <IconButton
            icon={unread ? 'check' : 'inbox'}
            label={unread ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
            variant="ghost"
            size="sm"
            onClick={() => onToggleRead(notification)}
          />
        ) : null}
        {notification.permissions.canDelete ? (
          <IconButton
            icon="trash"
            label="Meldung löschen"
            variant="ghost"
            size="sm"
            onClick={() => onDelete(notification)}
          />
        ) : null}
      </div>
    </div>
  );
}
