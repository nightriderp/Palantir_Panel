'use client';

import { type NotificationDto, type NotificationPageDto } from '@palantir/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  Icon,
  SegmentedControl,
  SelectField,
  StatusDot,
  cn,
  useToast,
} from '@/components/shared';
import {
  deleteNotification,
  fetchNotifications,
  markNotificationsRead,
} from '@/lib/api/notifications';
import { errorText } from '@/lib/api/client';
import { useApiResource } from '@/lib/api/useApiResource';
import { type LiveConnectionState } from '@/lib/live/LiveChannelProvider';
import { useNotificationLive } from '@/lib/live/useNotificationLive';
import { AnnouncementBanner } from './AnnouncementBanner';
import { NotificationRow } from './NotificationRow';
import {
  type InboxFilter,
  appendPage,
  eventFilterOptions,
  hasMore,
  prependNotification,
  setReadState,
  severityFilterOptions,
  unreadAnnouncements,
  withoutNotification,
} from './notificationView';
import { type NotificationPreferences, shouldToast } from './preferences';

/**
 * Reiter „Inbox" der Benachrichtigungen (Arbeitspaket F6, Lastenheft §3.6).
 *
 * Lädt die eigene Inbox einmal per REST und hält sie danach über den Live-Kanal
 * aktuell – kein Polling (Pflichtenheft §5.3). Gelesen/ungelesen, Löschen und
 * das Nachladen älterer Meldungen laufen über die Endpunkte aus B6; die
 * Anzeige wird dabei ohne erneutes Vollladen fortgeschrieben.
 *
 * Welche Meldung überhaupt entsteht, entscheiden allein die Regeln des
 * Administrators (F10/B6). Die persönlichen Einstellungen aus dem zweiten Reiter
 * betreffen nur, ob sich eine eintreffende Meldung hier zusätzlich als
 * Einblendung meldet.
 */

const PAGE_SIZE = 25;

/** Kleiner Verbindungshinweis, damit „nichts Neues" nicht wie „abgehängt" aussieht. */
function LiveState({ connection }: { connection: LiveConnectionState }) {
  const meta = {
    open: { tone: 'success', label: 'Live' },
    connecting: { tone: 'warning', label: 'verbindet …' },
    closed: { tone: 'danger', label: 'offline' },
  } as const;
  const { tone, label } = meta[connection];

  return (
    <span
      className="flex items-center gap-1.5 text-2xs text-ink-faint"
      title={`Live-Verbindung: ${label}`}
    >
      <StatusDot tone={tone} pulse={connection !== 'closed'} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

export interface InboxTabProps {
  preferences: NotificationPreferences;
  /** Neue Meldung, die sich laut Einstellung sofort melden soll (Desktop-Hinweis). */
  onDesktopNotify: (notification: NotificationDto) => void;
}

export function InboxTab({ preferences, onDesktopNotify }: InboxTabProps) {
  const router = useRouter();
  const toast = useToast();

  const [filter, setFilter] = useState<InboxFilter>(() => ({
    unreadOnly: preferences.startOnUnread,
    event: null,
    severity: null,
  }));
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const query = useMemo(
    () => ({
      unreadOnly: filter.unreadOnly,
      event: filter.event ?? undefined,
      severity: filter.severity ?? undefined,
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [filter],
  );

  const inbox = useApiResource<NotificationPageDto>(
    (signal) => fetchNotifications(query, signal),
    [query],
  );

  const page = inbox.data;

  // Neue Meldungen aus dem Live-Kanal einarbeiten. Der Rückruf wird bei jedem
  // Rendern neu erzeugt und sieht dadurch den aktuellen Filter; der Hook hält
  // ihn in einer Ref, ohne die Verbindung neu aufzubauen.
  const onLive = useCallback(
    (notification: NotificationDto, unreadCount: number) => {
      inbox.setData((current) =>
        current === null
          ? current
          : prependNotification(current, notification, unreadCount, filter),
      );

      if (shouldToast(preferences, notification.event)) {
        toast.show(notification.title, {
          variant: notification.severity === 'error' ? 'error' : 'info',
        });
        onDesktopNotify(notification);
      }
    },
    [inbox, filter, preferences, toast, onDesktopNotify],
  );

  const live = useNotificationLive(onLive);

  async function toggleRead(notification: NotificationDto) {
    const read = notification.readAt === null;
    const at = new Date().toISOString();

    inbox.setData((current) =>
      current === null ? current : setReadState(current, [notification.id], read, at),
    );

    const result = await markNotificationsRead({ ids: [notification.id], read });
    if (!result.success) {
      toast.error(errorText(result));
      inbox.reload();
    }
  }

  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    const at = new Date().toISOString();

    inbox.setData((current) =>
      current === null ? current : setReadState(current, null, true, at),
    );

    const result = await markNotificationsRead({ read: true });
    setBusy(false);
    if (!result.success) {
      toast.error(errorText(result));
      inbox.reload();
    } else {
      toast.success('Alle Meldungen als gelesen markiert.');
    }
  }

  async function remove(notification: NotificationDto) {
    inbox.setData((current) =>
      current === null ? current : withoutNotification(current, notification.id),
    );

    const result = await deleteNotification(notification.id);
    if (!result.success) {
      toast.error(errorText(result));
      inbox.reload();
    }
  }

  function acknowledgeAnnouncement(announcement: NotificationDto) {
    // „Verstanden" heißt: als gelesen markieren – nur wenn es das noch nicht ist.
    if (announcement.readAt === null) void toggleRead(announcement);
  }

  async function loadMore() {
    if (!page || loadingMore) return;
    setLoadingMore(true);

    const result = await fetchNotifications({ ...query, offset: page.entries.length }, undefined);
    setLoadingMore(false);

    if (result.success) {
      inbox.setData((current) =>
        current === null ? result.data : appendPage(current, result.data),
      );
    } else {
      toast.error(errorText(result));
    }
  }

  const announcements = useMemo(() => unreadAnnouncements(page), [page]);

  return (
    <div className="flex flex-col gap-4">
      {announcements.map((announcement) => (
        <AnnouncementBanner
          key={announcement.id}
          announcement={announcement}
          onAcknowledge={acknowledgeAnnouncement}
        />
      ))}

      <div className="flex flex-wrap items-end gap-3">
        <SegmentedControl
          label="Inbox filtern"
          value={filter.unreadOnly ? 'unread' : 'all'}
          onChange={(key) => setFilter((current) => ({ ...current, unreadOnly: key === 'unread' }))}
          items={[
            { key: 'all', label: 'Alle' },
            { key: 'unread', label: 'Ungelesen' },
          ]}
        />

        <div className="min-w-[160px] flex-1">
          <SelectField
            label="Ereignis"
            value={filter.event ?? ''}
            onChange={(value) =>
              setFilter((current) => ({
                ...current,
                event: value === '' ? null : (value as InboxFilter['event']),
              }))
            }
            placeholder="Alle Ereignisse"
            options={eventFilterOptions()}
          />
        </div>

        <div className="min-w-[150px]">
          <SelectField
            label="Dringlichkeit"
            value={filter.severity ?? ''}
            onChange={(value) =>
              setFilter((current) => ({
                ...current,
                severity: value === '' ? null : (value as InboxFilter['severity']),
              }))
            }
            placeholder="Jede Dringlichkeit"
            options={severityFilterOptions()}
          />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <LiveState connection={live.connection} />
          <Button
            variant="secondary"
            size="sm"
            iconLeft="check"
            disabled={busy || (page?.unreadCount ?? 0) === 0}
            onClick={markAllRead}
          >
            Alle gelesen
          </Button>
        </div>
      </div>

      {inbox.loading && page === null ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-faint">
          <Icon name="clock" size={16} />
          Meldungen werden geladen …
        </div>
      ) : inbox.error && page === null ? (
        <EmptyState
          icon="warning"
          title="Meldungen konnten nicht geladen werden"
          description={inbox.error}
          action={
            <Button variant="secondary" onClick={inbox.reload}>
              Nochmal versuchen
            </Button>
          }
        />
      ) : page && page.entries.length === 0 ? (
        <EmptyState
          icon="bell"
          title={filter.unreadOnly ? 'Keine ungelesenen Meldungen' : 'Keine Benachrichtigungen'}
          description={
            filter.unreadOnly
              ? 'Sobald etwas Neues eintrifft, erscheint es hier.'
              : 'Serverstatus, Backups, Ankündigungen und mehr laufen hier zusammen.'
          }
        />
      ) : page ? (
        <div className={cn('overflow-hidden rounded-2xl border border-line bg-surface')}>
          {page.entries.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={(href) => router.push(href)}
              onToggleRead={toggleRead}
              onDelete={remove}
            />
          ))}
        </div>
      ) : null}

      {page && hasMore(page) ? (
        <div className="flex justify-center">
          <Button variant="ghost" size="sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Wird geladen …' : 'Ältere laden'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
