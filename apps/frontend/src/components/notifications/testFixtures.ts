import {
  type NotifiableEventName,
  type NotificationDto,
  type NotificationPageDto,
  type NotificationSeverity,
} from '@palantir/contracts';

/**
 * Testdaten für die Logik von F6.
 *
 * Bewusst klein und ohne Netzwerk: Die reinen Funktionen aus `notificationView`
 * und die Fortschreibung der geladenen Seite lassen sich damit prüfen, ohne das
 * Backend oder einen WebSocket (CLAUDE.md §4).
 */

let counter = 0;

export function notification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  counter += 1;
  const id = overrides.id ?? `n${String(counter)}`;

  return {
    id,
    userId: 'u1',
    event: 'server.started',
    severity: 'info',
    title: `Meldung ${id}`,
    body: 'Text der Meldung.',
    subject: null,
    data: {},
    ruleId: null,
    readAt: null,
    createdAt: '2026-08-27T10:00:00.000Z',
    permissions: { canMarkRead: true, canDelete: true },
    ...overrides,
  };
}

export function page(
  entries: NotificationDto[],
  overrides: Partial<NotificationPageDto> = {},
): NotificationPageDto {
  const unread = entries.filter((entry) => entry.readAt === null).length;

  return {
    entries,
    total: entries.length,
    unreadCount: unread,
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

export function announcement(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return notification({
    event: 'announcement.published',
    severity: 'warning',
    subject: { type: 'announcement', id: 'a1', displayName: 'Wartung' },
    ...overrides,
  });
}

export const SEVERITIES: readonly NotificationSeverity[] = ['info', 'warning', 'error'];
export const AN_EVENT: NotifiableEventName = 'backup.failed';
