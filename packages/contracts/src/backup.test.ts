import { describe, expect, it } from 'vitest';
import {
  AUTOMATIC_BACKUP_RETENTION_DAYS,
  BACKUP_STATUSES,
  BACKUP_TYPES,
  PENDING_BACKUP_STATUSES,
} from './backup.js';
import { ERROR_CATALOG } from './errors.js';
import { SCHEDULE_ACTIONS, isScheduleAction } from './schedule.js';
import { WEBSOCKET_EVENTS } from './events.js';

describe('Backup-Vertrag (Lastenheft §3.3, Pflichtenheft §6)', () => {
  it('unterscheidet genau die beiden Auslöser, die die Aufbewahrungsregel trägt', () => {
    // Ein Datenexport ist bewusst kein eigener Typ, sondern ein manuelles
    // Backup mit gesetztem `isExport` – sonst hätte die Regel aus Lastenheft
    // §3.3 einen dritten Fall, den sie nicht kennt.
    expect([...BACKUP_TYPES]).toEqual(['manual', 'automatic']);
  });

  it('hält die Frist aus Lastenheft §3.3 auf sieben Tagen', () => {
    expect(AUTOMATIC_BACKUP_RETENTION_DAYS).toBe(7);
  });

  it('führt die noch laufenden Zustände als Teilmenge aller Zustände', () => {
    for (const status of PENDING_BACKUP_STATUSES) {
      expect([...BACKUP_STATUSES]).toContain(status);
    }
  });
});

describe('Fehlercodes der Backup-Verwaltung (Pflichtenheft §5.1)', () => {
  it('ergänzt den Katalog um die Fälle aus B5', () => {
    expect(ERROR_CATALOG.SERVER_NOT_FOUND.httpStatus).toBe(404);
    expect(ERROR_CATALOG.BACKUP_NOT_FOUND.httpStatus).toBe(404);
    expect(ERROR_CATALOG.BACKUP_NOT_READY.httpStatus).toBe(409);
    expect(ERROR_CATALOG.BACKUP_ALREADY_RUNNING.httpStatus).toBe(409);
    expect(ERROR_CATALOG.SCHEDULE_INVALID_CRON.httpStatus).toBe(400);
  });

  it('meldet den Fehlschlag über das bereits vereinbarte Event', () => {
    // Konsument ist die Notification-Engine (B6, Pflichtenheft §14).
    expect([...WEBSOCKET_EVENTS]).toContain('backup.failed');
  });
});

describe('Geplante Aufgaben (Pflichtenheft §6)', () => {
  it('führt die Aktionen aus Lastenheft §3.3', () => {
    expect([...SCHEDULE_ACTIONS]).toEqual(['backup', 'restart', 'command']);
  });

  it('isScheduleAction() erkennt unbekannte Aktionen', () => {
    expect(isScheduleAction('backup')).toBe(true);
    expect(isScheduleAction('rm-rf')).toBe(false);
    expect(isScheduleAction('toString')).toBe(false);
  });
});
