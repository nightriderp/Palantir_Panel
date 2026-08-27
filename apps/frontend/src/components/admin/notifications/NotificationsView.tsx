'use client';

import { useState } from 'react';
import { PageHeader, Tabs } from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { AdminAccessNotice } from '../common';
import { ChannelsTab } from './ChannelsTab';
import { DeliveriesTab } from './DeliveriesTab';
import { RulesTab } from './RulesTab';

/**
 * Benachrichtigungs-Regeln (Lastenheft §3.6).
 *
 * Drei Reiter innerhalb einer Seite (kein zweites Seitenmenü, siehe
 * `components/shared/README.md`): die Regeln (Ereignis → Kanal → Empfängerkreis),
 * die Kanäle (Discord-Webhooks) und das Zustellungsprotokoll.
 */

type TabKey = 'rules' | 'channels' | 'deliveries';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'rules', label: 'Regeln' },
  { key: 'channels', label: 'Kanäle' },
  { key: 'deliveries', label: 'Zustellungen' },
];

export function NotificationsView() {
  const { user } = useSession();
  const canManage = user?.permissions.canManageNotifications ?? false;
  const [tab, setTab] = useState<TabKey>('rules');

  if (!canManage) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Benachrichtigungs-Regeln" className="-mx-5 -mt-5 px-5" />
        <AdminAccessNotice area="die Benachrichtigungsverwaltung" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Benachrichtigungs-Regeln"
        subtitle="Welches Ereignis welchen Kanal für welchen Empfängerkreis auslöst"
        className="-mx-5 -mt-5 px-5"
      />

      <Tabs items={TABS} activeKey={tab} onChange={setTab} />

      {tab === 'rules' ? <RulesTab /> : null}
      {tab === 'channels' ? <ChannelsTab /> : null}
      {tab === 'deliveries' ? <DeliveriesTab /> : null}
    </div>
  );
}
