'use client';

import { type NotificationDto } from '@palantir/contracts';
import { useCallback, useState } from 'react';
import { PageHeader, Tabs } from '@/components/shared';
import { InboxTab } from './InboxTab';
import { SettingsTab } from './SettingsTab';
import { showDesktopNotification } from './desktop';
import { useNotificationPreferences } from './usePreferences';

/**
 * Benachrichtigungen (Arbeitspaket F6, Lastenheft §3.6).
 *
 * Zwei Reiter aus dem Lastenheft: „Inbox" (eigene Meldungen, live über den
 * WebSocket-Kanal) und „Einstellungen" (persönliche Anzeige-Vorlieben dieses
 * Browsers). Systemweite Ankündigungen des Admins erscheinen als Banner über
 * der Inbox – sie sind gewöhnliche Meldungen mit dem Ereignis
 * `announcement.published`.
 *
 * Beide Reiter bleiben eingehängt; der inaktive wird nur ausgeblendet. So
 * bricht der Wechsel auf die Einstellungen den Live-Kanal der Inbox nicht ab und
 * lädt die Liste beim Zurückwechseln nicht neu. Die Vorlieben liegen an genau
 * einer Stelle, damit ein Umschalten sofort auch für die Inbox gilt.
 */

type TabKey = 'inbox' | 'settings';

const TABS = [
  { key: 'inbox' as const, label: 'Inbox' },
  { key: 'settings' as const, label: 'Einstellungen' },
];

export function NotificationsView() {
  const [tab, setTab] = useState<TabKey>('inbox');
  const { preferences, update, ready } = useNotificationPreferences();

  const onDesktopNotify = useCallback(
    (notification: NotificationDto) => {
      if (preferences.desktopEnabled) showDesktopNotification(notification);
    },
    [preferences.desktopEnabled],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Benachrichtigungen"
        subtitle="Dein Posteingang und persönliche Einstellungen"
        className="-mx-5 -mt-5 px-5"
      />

      <Tabs items={TABS} activeKey={tab} onChange={setTab} />

      {/*
       * Erst nach dem Lesen der gespeicherten Vorlieben einhängen: `InboxTab`
       * legt seinen Anfangsfilter (Start auf „Ungelesen") einmalig aus den
       * Vorlieben an, und die kommen erst nach dem ersten Rendern aus dem
       * `localStorage`. Danach bleiben beide Reiter eingehängt.
       */}
      {ready ? (
        <>
          <div hidden={tab !== 'inbox'}>
            <InboxTab preferences={preferences} onDesktopNotify={onDesktopNotify} />
          </div>
          <div hidden={tab !== 'settings'}>
            <SettingsTab preferences={preferences} onChange={update} />
          </div>
        </>
      ) : null}
    </div>
  );
}
