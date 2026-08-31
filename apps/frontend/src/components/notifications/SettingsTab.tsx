'use client';

import { Icon, Panel, ToggleRow } from '@/components/shared';
import { NOTIFICATION_GROUPS } from './notificationView';
import { DesktopToggle } from './DesktopToggle';
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
        {/* Derselbe Schalter steht über dem Posteingang – gemeinsamer Zustand. */}
        <DesktopToggle preferences={preferences} onChange={onChange} />
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
