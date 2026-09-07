import {
  BACKUP_STATUSES,
  BACKUP_TYPES,
  NOTIFIABLE_EVENTS,
  NOTIFICATION_SEVERITIES,
} from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_STATUS_META,
  BACKUP_TYPE_LABELS,
  NOTIFIABLE_EVENT_LABELS,
  NOTIFICATION_SEVERITY_LABELS,
  NOTIFICATION_SEVERITY_TONES,
} from './labels';
import {
  backupStatusLabel,
  backupStatusTone,
  backupTypeLabel,
  notifiableEventLabel,
  severityLabel,
  severityTone,
} from '@/components/admin/labels';
import {
  BACKUP_STATUS_META as BACKUP_STATUS_META_AUS_MEINE_BACKUPS,
  BACKUP_TYPE_LABELS as BACKUP_TYPE_LABELS_AUS_MEINE_BACKUPS,
} from '@/components/my-backups/backupsView';
import {
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_SEVERITY_LABELS as SEVERITY_LABELS_AUS_INBOX,
  NOTIFICATION_SEVERITY_TONES as SEVERITY_TONES_AUS_INBOX,
} from '@/components/notifications/notificationView';

/**
 * Eine Tabelle je Aufzählung (Audit frontend-lib-14).
 *
 * Der Sinn der Zusammenlegung ist, dass **jeder** bisherige Einstiegspunkt
 * dasselbe Ergebnis liefert: Der Regel-Editor der Verwaltung, die Inbox, „Meine
 * Backups", der Backup-Reiter und der Export-Block nannten dieselben Werte
 * teilweise verschieden. Diese Datei prüft die Einstiegspunkte einzeln gegen die
 * gemeinsame Tabelle – ginge einer wieder eigene Wege, fiele es hier auf.
 */

describe('Ereignis-Beschriftungen', () => {
  it('liefert für jeden bisherigen Aufrufer dieselbe Beschriftung', () => {
    for (const event of NOTIFIABLE_EVENTS) {
      const erwartet = NOTIFIABLE_EVENT_LABELS[event];

      expect(erwartet.length).toBeGreaterThan(0);
      // Verwaltung (F10, Regel-Editor) …
      expect(notifiableEventLabel(event)).toBe(erwartet);
      // … und Inbox (F6, Filterliste).
      expect(NOTIFICATION_EVENT_LABELS[event]).toBe(erwartet);
    }
  });

  it('kennt genau die Ereignisse des Vertrags', () => {
    expect(Object.keys(NOTIFIABLE_EVENT_LABELS).sort()).toEqual([...NOTIFIABLE_EVENTS].sort());
  });
});

describe('Dringlichkeit', () => {
  it('liefert für jeden bisherigen Aufrufer dieselbe Beschriftung und denselben Ton', () => {
    for (const severity of NOTIFICATION_SEVERITIES) {
      expect(severityLabel(severity)).toBe(NOTIFICATION_SEVERITY_LABELS[severity]);
      expect(SEVERITY_LABELS_AUS_INBOX[severity]).toBe(NOTIFICATION_SEVERITY_LABELS[severity]);
      expect(severityTone(severity)).toBe(NOTIFICATION_SEVERITY_TONES[severity]);
      expect(SEVERITY_TONES_AUS_INBOX[severity]).toBe(NOTIFICATION_SEVERITY_TONES[severity]);
    }
  });

  it('kennt genau die Stufen des Vertrags', () => {
    expect(Object.keys(NOTIFICATION_SEVERITY_LABELS).sort()).toEqual(
      [...NOTIFICATION_SEVERITIES].sort(),
    );
    expect(Object.keys(NOTIFICATION_SEVERITY_TONES).sort()).toEqual(
      [...NOTIFICATION_SEVERITIES].sort(),
    );
  });
});

describe('Backup-Beschriftungen', () => {
  it('liefert für jeden bisherigen Aufrufer denselben Typ-Text', () => {
    for (const type of BACKUP_TYPES) {
      expect(backupTypeLabel(type)).toBe(BACKUP_TYPE_LABELS[type]);
      expect(BACKUP_TYPE_LABELS_AUS_MEINE_BACKUPS[type]).toBe(BACKUP_TYPE_LABELS[type]);
    }
  });

  it('liefert für jeden bisherigen Aufrufer denselben Stand und Ton', () => {
    for (const status of BACKUP_STATUSES) {
      const erwartet = BACKUP_STATUS_META[status];

      expect(erwartet.label.length).toBeGreaterThan(0);
      // Verwaltung …
      expect(backupStatusLabel(status)).toBe(erwartet.label);
      expect(backupStatusTone(status)).toBe(erwartet.tone);
      // … „Meine Backups", Backup-Reiter und Export-Block (dieselbe Tabelle).
      expect(BACKUP_STATUS_META_AUS_MEINE_BACKUPS[status]).toEqual(erwartet);
    }
  });

  it('kennt genau die Werte des Vertrags', () => {
    expect(Object.keys(BACKUP_TYPE_LABELS).sort()).toEqual([...BACKUP_TYPES].sort());
    expect(Object.keys(BACKUP_STATUS_META).sort()).toEqual([...BACKUP_STATUSES].sort());
  });
});
