'use client';

import { useEffect, useState } from 'react';
import { Icon, Panel, ToggleRow, useToast } from '@/components/shared';
import { NOTIFICATION_GROUPS } from './notificationView';
import { type DesktopPermission, desktopPermission, requestDesktopPermission } from './desktop';
import { type NotificationPreferences, withGroup } from './preferences';

/**
 * Reiter „Einstellungen" der Benachrichtigungen (Arbeitspaket F6).
 *
 * **Wichtige Abgrenzung, sichtbar erklärt:** Wer eine Meldung überhaupt bekommt,
 * legen allein die Regeln des Administrators fest (Lastenheft §3.6,
 * Pflichtenheft §14). Diese Seite steuert deshalb nur die **Anzeige in diesem
 * Browser** – ob sich eine eintreffende Meldung sofort einblendet und ob der
 * Browser zusätzlich eine Mitteilung zeigt. Die Inbox bleibt in jedem Fall
 * vollständig.
 */

export interface SettingsTabProps {
  preferences: NotificationPreferences;
  onChange: (next: NotificationPreferences) => void;
}

export function SettingsTab({ preferences, onChange }: SettingsTabProps) {
  const toast = useToast();
  const [permission, setPermission] = useState<DesktopPermission>('unsupported');

  useEffect(() => {
    setPermission(desktopPermission());
  }, []);

  async function toggleDesktop(enabled: boolean) {
    if (!enabled) {
      onChange({ ...preferences, desktopEnabled: false });
      return;
    }

    const granted = await requestDesktopPermission();
    setPermission(desktopPermission());

    if (granted) {
      onChange({ ...preferences, desktopEnabled: true });
    } else {
      toast.warning('Der Browser hat die Erlaubnis für Mitteilungen nicht erteilt.');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel variant="outline" className="flex gap-3">
        <Icon name="bell" size={18} className="mt-0.5 shrink-0 text-ink-soft" />
        <p className="text-sm text-ink-muted">
          Diese Einstellungen gelten nur für <strong className="text-ink">diesen Browser</strong>{' '}
          und steuern die Anzeige. Welche Ereignisse du erhältst, richtet die Administration über
          die Benachrichtigungs-Regeln ein – die Inbox bleibt immer vollständig.
        </p>
      </Panel>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-base font-semibold text-ink">Sofort einblenden</h2>
        <p className="text-sm text-ink-muted">
          Für welche Themen eine neu eintreffende Meldung sich sofort als Einblendung meldet.
        </p>
        <div className="flex flex-col gap-2">
          {NOTIFICATION_GROUPS.map((group) => (
            <ToggleRow
              key={group.key}
              title={group.label}
              description={group.description}
              checked={preferences.toastGroups[group.key]}
              onChange={(enabled) => onChange(withGroup(preferences, group.key, enabled))}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-base font-semibold text-ink">Browser-Mitteilungen</h2>
        <ToggleRow
          title="Mitteilungen des Browsers"
          description={
            permission === 'unsupported'
              ? 'Dieser Browser unterstützt keine Mitteilungen.'
              : permission === 'denied'
                ? 'Die Erlaubnis ist im Browser gesperrt – dort wieder freigeben, um sie zu nutzen.'
                : 'Zeigt neue Meldungen auch außerhalb des Panels an, sofern der Browser es erlaubt.'
          }
          checked={preferences.desktopEnabled && permission === 'granted'}
          disabled={permission === 'unsupported' || permission === 'denied'}
          onChange={(enabled) => void toggleDesktop(enabled)}
        />
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-base font-semibold text-ink">Inbox</h2>
        <ToggleRow
          title={'Beim Öffnen auf „Ungelesen“ stellen'}
          description="Die Inbox zeigt zuerst nur die ungelesenen Meldungen."
          checked={preferences.startOnUnread}
          onChange={(enabled) => onChange({ ...preferences, startOnUnread: enabled })}
        />
      </section>
    </div>
  );
}
