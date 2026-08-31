'use client';

import { type NotificationDto } from '@palantir/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, cn, formatRelativeTime } from '@/components/shared';
import { fetchNotifications, markNotificationsRead } from '@/lib/api/notifications';
import { useNotificationLive } from '@/lib/live/NotificationLiveProvider';
import { subjectHref } from './notificationView';

/**
 * Glocke in der Kopfleiste (Lastenheft §3.6).
 *
 * Zeigt einen roten Punkt, solange ungelesene Meldungen vorliegen, und öffnet
 * auf Klick die letzten fünf. Beim Öffnen werden genau die angezeigten Meldungen
 * als gelesen markiert – so wie es im Fuß der Liste steht. Ältere Ungelesene
 * bleiben ungelesen; der Punkt verschwindet also nur, wenn wirklich nichts mehr
 * offen ist.
 *
 * Der Zähler kommt vom Live-Kanal (`NotificationLiveProvider`), die Liste beim
 * Öffnen per REST. Kein Polling und keine Liste im Hintergrund: Die Meldungen
 * werden erst geholt, wenn jemand sie sehen will.
 */

/** So viele Meldungen zeigt die Glocke – der Rest steht im Posteingang. */
const ANZAHL = 5;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NotificationDto[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { unreadCount, subscribe, setUnreadCount } = useNotificationLive();
  const hasUnread = (unreadCount ?? 0) > 0;

  // Kommt eine Meldung herein, während die Liste offen steht, gehört sie nach
  // oben. Ungelesen bleibt sie: gelesen wird nur beim Öffnen.
  useEffect(
    () =>
      subscribe((notification) => {
        setEntries((current) =>
          current === null ? current : [notification, ...current].slice(0, ANZAHL),
        );
      }),
    [subscribe],
  );

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const oeffnen = useCallback(async () => {
    setOpen(true);

    const result = await fetchNotifications({ limit: ANZAHL, offset: 0 });
    if (!result.success) {
      // Ohne Liste bleibt die Glocke leer; ein Fehlerhinweis in einem Menü, das
      // beim nächsten Klick wieder zu ist, hilft niemandem.
      setEntries([]);
      return;
    }

    setEntries(result.data.entries);

    const ungelesen = result.data.entries.filter((entry) => entry.readAt === null);
    if (ungelesen.length === 0) return;

    // Der Zähler zählt alle Ungelesenen, nicht nur die hier sichtbaren.
    setUnreadCount(Math.max(0, result.data.unreadCount - ungelesen.length));

    const gelesen = await markNotificationsRead({
      ids: ungelesen.map((entry) => entry.id),
      read: true,
    });

    if (gelesen.success) {
      const at = new Date().toISOString();
      setEntries((current) =>
        current === null
          ? current
          : current.map((entry) => (entry.readAt === null ? { ...entry, readAt: at } : entry)),
      );
    } else {
      setUnreadCount(result.data.unreadCount);
    }
  }, [setUnreadCount]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void oeffnen())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          hasUnread ? `Benachrichtigungen, ${unreadCount ?? 0} ungelesen` : 'Benachrichtigungen'
        }
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-md text-ink-muted',
          'hover:bg-fill hover:text-ink',
          open && 'bg-fill text-ink',
        )}
      >
        <Icon name="bell" size={16} />
        {hasUnread ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger" />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 max-h-[420px] w-[21rem] overflow-y-auto rounded-lg border border-line bg-surface shadow-lg"
        >
          <p className="border-b border-line px-4 py-3 text-base font-semibold text-ink">
            Benachrichtigungen
          </p>

          {entries === null ? (
            <p className="px-4 py-6 text-center text-xs text-ink-faint">wird geladen …</p>
          ) : entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-ink-faint">Keine Benachrichtigungen.</p>
          ) : (
            entries.map((entry) => (
              <BellRow key={entry.id} notification={entry} onNavigate={() => setOpen(false)} />
            ))
          )}

          <p className="px-4 py-2.5 text-xs text-ink-faint">Beim Öffnen als gelesen markiert</p>
        </div>
      ) : null}
    </div>
  );
}

/** Beschriftung des Sprungziels – dieselben Ziele wie im Posteingang. */
function zielLabel(notification: NotificationDto): string {
  switch (notification.subject?.type) {
    case 'server':
      return 'Zum Server';
    case 'node':
      return 'Zu den Nodes';
    case 'backup':
      return 'Zu den Backups';
    case 'user':
      return 'Zu den Nutzern';
    case 'message':
      return 'Zur Moderation';
    default:
      return 'Öffnen';
  }
}

function BellRow({
  notification,
  onNavigate,
}: {
  notification: NotificationDto;
  onNavigate: () => void;
}) {
  const href = subjectHref(notification.subject);
  const ungelesen = notification.readAt === null;

  const inhalt = (
    <>
      <p className="text-base text-ink">{notification.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{notification.body}</p>
      <p className="mt-1 font-mono text-[0.6875rem] text-ink-faint">
        {formatRelativeTime(notification.createdAt)}
        {href === null ? null : ` · ${zielLabel(notification)} →`}
      </p>
    </>
  );

  const klassen = cn(
    'block border-b border-line px-4 py-3 last:border-b-0',
    ungelesen && 'bg-brand-soft',
  );

  if (href === null) {
    return <div className={klassen}>{inhalt}</div>;
  }

  return (
    <Link href={href} role="menuitem" onClick={onNavigate} className={cn(klassen, 'hover:bg-fill')}>
      {inhalt}
    </Link>
  );
}
