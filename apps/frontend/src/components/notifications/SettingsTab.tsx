'use client';

import { FormMessage, Icon, Panel, ToggleRow } from '@/components/shared';
import { NOTIFICATION_GROUPS } from './notificationView';
import { DesktopToggle } from './DesktopToggle';
import { type NotificationPreferences, withGroup } from './preferences';
import { mutableGroups, useMutedEvents } from './useMutedEvents';

/**
 * Reiter „Einstellungen" der Benachrichtigungen (Arbeitspaket F6).
 *
 * **Zwei Arten von Einstellungen, sichtbar getrennt** (Gefundener Punkt 93):
 *
 * 1. „Welche Meldungen erhalten?" gilt für das **Konto** und damit für jedes
 *    Gerät. Ein abbestelltes Ereignis landet gar nicht mehr in der Inbox.
 *    Abbestellen kann nur abwählen: Wer überhaupt in Frage kommt, entscheiden
 *    weiter die Regeln des Administrators (Pflichtenheft §14). Ankündigungen
 *    des Betreibers stehen deshalb nicht zur Auswahl.
 * 2. Alles darunter betrifft nur die **Anzeige in diesem Browser** – ob sich
 *    eine eintreffende Meldung sofort einblendet und wie die Inbox startet.
 */

export interface SettingsTabProps {
  preferences: NotificationPreferences;
  onChange: (next: NotificationPreferences) => void;
}

export function SettingsTab({ preferences, onChange }: SettingsTabProps) {
  const muted = useMutedEvents();

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2.5">
        <h2 className="text-base font-semibold text-ink">Welche Meldungen möchtest du erhalten?</h2>
        <p className="text-sm text-ink-muted">
          Gilt für dein Konto auf <strong className="text-ink">allen Geräten</strong>. Abgestellte
          Meldungen kommen gar nicht erst an. Ankündigungen der Administration erreichen dich immer.
        </p>
        {muted.error ? <FormMessage tone="error">{muted.error}</FormMessage> : null}
        <div className="flex flex-col gap-2">
          {mutableGroups(NOTIFICATION_GROUPS).map((group) => (
            <ToggleRow
              key={group.key}
              title={group.label}
              description={group.description}
              checked={muted.receives(group)}
              disabled={muted.loading || muted.saving}
              onChange={(receive) => muted.setGroup(group, receive)}
            />
          ))}
        </div>
      </section>

      <Panel variant="outline" className="flex gap-3">
        <Icon name="bell" size={18} className="mt-0.5 shrink-0 text-ink-soft" />
        <p className="text-sm text-ink-muted">
          Die folgenden Einstellungen gelten nur für{' '}
          <strong className="text-ink">diesen Browser</strong> und steuern die Anzeige. Die Inbox
          bleibt davon unberührt.
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
