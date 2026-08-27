import { type NotifiableEventName } from '@palantir/contracts';
import { NOTIFICATION_GROUPS, type NotificationGroupKey, groupOfEvent } from './notificationView';

/**
 * Persönliche Benachrichtigungs-Einstellungen (Arbeitspaket F6).
 *
 * **Bewusst nur lokal, und zwar aus einem inhaltlichen Grund:** Wer eine
 * Meldung überhaupt bekommt, entscheiden allein die Benachrichtigungs-Regeln
 * des Administrators (Ereignis → Kanal → Empfängerkreis, Lastenheft §3.6,
 * Pflichtenheft §14). Ein Konto kann sich davon nicht abmelden – im
 * `NotificationDto` und in `packages/contracts` gibt es dafür kein Feld und im
 * Backend keinen Endpunkt. Alles, was hier eingestellt wird, betrifft deshalb
 * ausschließlich die **Anzeige in diesem Browser**: ob eine eintreffende
 * Meldung sich sofort meldet und wie die Inbox beim Öffnen steht. Die Inbox
 * selbst bleibt vollständig.
 *
 * Gespeichert wird im `localStorage`, wie beim Anheften in F3
 * (`usePinnedServers`). Sobald das Backend eine Vorliebe am Konto führt, wandert
 * das hierher hinein – vermerkt unter „Gefundene Punkte" in WORK_STATUS.md.
 */

export const PREFERENCES_STORAGE_KEY = 'palantir.notifications.preferences';

export interface NotificationPreferences {
  /** Je Themengruppe: bei einer neuen Meldung sofort eine Einblendung zeigen. */
  toastGroups: Record<NotificationGroupKey, boolean>;
  /**
   * Zusätzlich eine Mitteilung des Browsers (Mockup „Push-Benachrichtigungen").
   *
   * Greift nur, wenn der Browser die Erlaubnis erteilt hat, und nur für
   * Gruppen, die oben eingeschaltet sind.
   */
  desktopEnabled: boolean;
  /** Inbox beim Öffnen auf „Ungelesen" stellen. */
  startOnUnread: boolean;
}

/**
 * Vorgabe: alles meldet sich, nichts ist vorgefiltert.
 *
 * Bewusst so herum. Wer eine Meldung bekommt, hat sie über eine Regel
 * ausdrücklich zugewiesen bekommen; sie standardmäßig stumm zu stellen würde
 * genau das aushebeln.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  toastGroups: {
    server: true,
    autoShutdown: true,
    backup: true,
    resource: true,
    account: true,
    announcement: true,
  },
  desktopEnabled: false,
  startOnUnread: false,
};

function isGroupKey(value: string): value is NotificationGroupKey {
  return NOTIFICATION_GROUPS.some((group) => group.key === value);
}

/**
 * Gespeicherten Text einlesen.
 *
 * Nachsichtig: Ein beschädigter, veralteter oder fremder Eintrag darf die
 * Ansicht nicht aufhalten – unbekannte Felder werden verworfen, fehlende aus
 * der Vorgabe ergänzt. So übersteht der Eintrag auch eine neue Gruppe.
 */
export function parsePreferences(raw: string | null): NotificationPreferences {
  if (raw === null || raw.length === 0) return DEFAULT_NOTIFICATION_PREFERENCES;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }

  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOTIFICATION_PREFERENCES;

  const candidate = parsed as {
    toastGroups?: unknown;
    desktopEnabled?: unknown;
    startOnUnread?: unknown;
  };

  const stored = (
    typeof candidate.toastGroups === 'object' && candidate.toastGroups !== null
      ? candidate.toastGroups
      : {}
  ) as Record<string, unknown>;

  const toastGroups = { ...DEFAULT_NOTIFICATION_PREFERENCES.toastGroups };
  for (const [key, value] of Object.entries(stored)) {
    if (isGroupKey(key) && typeof value === 'boolean') toastGroups[key] = value;
  }

  return {
    toastGroups,
    desktopEnabled:
      typeof candidate.desktopEnabled === 'boolean'
        ? candidate.desktopEnabled
        : DEFAULT_NOTIFICATION_PREFERENCES.desktopEnabled,
    startOnUnread:
      typeof candidate.startOnUnread === 'boolean'
        ? candidate.startOnUnread
        : DEFAULT_NOTIFICATION_PREFERENCES.startOnUnread,
  };
}

export function serializePreferences(preferences: NotificationPreferences): string {
  return JSON.stringify(preferences);
}

/** Eine Gruppe umschalten, ohne die übrigen anzufassen. */
export function withGroup(
  preferences: NotificationPreferences,
  group: NotificationGroupKey,
  enabled: boolean,
): NotificationPreferences {
  return {
    ...preferences,
    toastGroups: { ...preferences.toastGroups, [group]: enabled },
  };
}

/**
 * Soll sich eine eintreffende Meldung sofort melden?
 *
 * Ereignisse ohne Gruppe melden sich – lieber eine Einblendung zu viel als eine
 * stumme Meldung, wenn ein neues Ereignis hier noch nicht eingeordnet ist.
 */
export function shouldToast(
  preferences: NotificationPreferences,
  event: NotifiableEventName,
): boolean {
  const group = groupOfEvent(event);
  return group === null ? true : preferences.toastGroups[group.key];
}
