'use client';

import { type NotificationDto } from '@palantir/contracts';
import { Button, Icon, cn } from '@/components/shared';
import { NOTIFICATION_SEVERITY_TONES } from './notificationView';

/**
 * Banner einer systemweiten Ankündigung (Lastenheft §3.6, Mockup).
 *
 * Steht über der Inbox, solange die Ankündigung ungelesen ist. Eine Ankündigung
 * ist technisch eine gewöhnliche Meldung mit dem Ereignis
 * `announcement.published`; „Verstanden" markiert sie als gelesen und lässt das
 * Banner verschwinden – der Eintrag bleibt in der Inbox erhalten.
 */

const TONE_SURFACE: Record<string, string> = {
  neutral: 'border-line bg-surface-muted',
  warning: 'border-warning-line bg-warning-soft',
  danger: 'border-danger-line bg-danger-soft',
};

export interface AnnouncementBannerProps {
  announcement: NotificationDto;
  onAcknowledge: (announcement: NotificationDto) => void;
}

export function AnnouncementBanner({ announcement, onAcknowledge }: AnnouncementBannerProps) {
  const tone = NOTIFICATION_SEVERITY_TONES[announcement.severity];

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-start',
        TONE_SURFACE[tone] ?? TONE_SURFACE.neutral,
      )}
    >
      <Icon name="bell" size={18} className="mt-0.5 shrink-0 text-ink-muted" />
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-ink">{announcement.title}</div>
        <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{announcement.body}</p>
      </div>
      {announcement.permissions.canMarkRead ? (
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0 self-start"
          onClick={() => onAcknowledge(announcement)}
        >
          Verstanden
        </Button>
      ) : null}
    </div>
  );
}
