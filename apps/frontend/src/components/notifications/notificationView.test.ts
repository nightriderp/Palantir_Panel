import { NOTIFIABLE_EVENTS } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_INBOX_FILTER,
  NOTIFICATION_GROUPS,
  appendPage,
  eventFilterOptions,
  groupOfEvent,
  hasMore,
  iconOfEvent,
  matchesInboxFilter,
  prependNotification,
  setReadState,
  severityFilterOptions,
  subjectHref,
  unreadAnnouncements,
  withoutNotification,
} from './notificationView';
import { announcement, notification, page } from './testFixtures';

describe('Ereignis-Gruppen', () => {
  it('ordnet jedes benachrichtigungsfähige Ereignis genau einer Gruppe zu', () => {
    for (const event of NOTIFIABLE_EVENTS) {
      const matches = NOTIFICATION_GROUPS.filter((group) => group.events.includes(event));
      expect(matches, event).toHaveLength(1);
    }
  });

  it('führt keine Ereignisse, die es nicht gibt', () => {
    for (const group of NOTIFICATION_GROUPS) {
      for (const event of group.events) {
        expect(NOTIFIABLE_EVENTS).toContain(event);
      }
    }
  });

  it('liefert das Symbol der Gruppe, sonst die Glocke', () => {
    expect(iconOfEvent('backup.failed')).toBe('database');
    expect(groupOfEvent('backup.failed')?.key).toBe('backup');
  });
});

describe('subjectHref', () => {
  it('verlinkt einen Server auf seine Detailseite', () => {
    expect(subjectHref({ type: 'server', id: 'srv 1', displayName: null })).toBe(
      '/servers/srv%201',
    );
  });

  it('führt die übrigen Typen auf ihre bestehende Ansicht', () => {
    expect(subjectHref({ type: 'backup', id: 'b1', displayName: null })).toBe('/my-backups');
    expect(subjectHref({ type: 'node', id: 'n1', displayName: null })).toBe('/nodes');
    expect(subjectHref({ type: 'user', id: 'u1', displayName: null })).toBe('/admin/users');
    expect(subjectHref({ type: 'message', id: 'm1', displayName: null })).toBe('/admin/moderation');
  });

  it('bietet für Ankündigung und ohne Subject kein Sprungziel', () => {
    expect(subjectHref({ type: 'announcement', id: 'a1', displayName: null })).toBeNull();
    expect(subjectHref(null)).toBeNull();
  });
});

describe('matchesInboxFilter', () => {
  it('achtet auf ungelesen, Ereignis und Dringlichkeit', () => {
    const entry = notification({ event: 'backup.failed', severity: 'error', readAt: null });

    expect(matchesInboxFilter(entry, EMPTY_INBOX_FILTER)).toBe(true);
    expect(matchesInboxFilter(entry, { ...EMPTY_INBOX_FILTER, unreadOnly: true })).toBe(true);
    expect(
      matchesInboxFilter(
        { ...entry, readAt: '2026-08-27T11:00:00.000Z' },
        {
          ...EMPTY_INBOX_FILTER,
          unreadOnly: true,
        },
      ),
    ).toBe(false);
    expect(matchesInboxFilter(entry, { ...EMPTY_INBOX_FILTER, event: 'server.started' })).toBe(
      false,
    );
    expect(matchesInboxFilter(entry, { ...EMPTY_INBOX_FILTER, severity: 'info' })).toBe(false);
  });
});

describe('prependNotification', () => {
  it('stellt eine passende neue Meldung nach vorn und übernimmt den Zähler', () => {
    const start = page([notification({ id: 'alt' })]);
    const fresh = notification({ id: 'neu' });

    const next = prependNotification(start, fresh, 5, EMPTY_INBOX_FILTER);

    expect(next.entries.map((entry) => entry.id)).toEqual(['neu', 'alt']);
    expect(next.total).toBe(2);
    expect(next.unreadCount).toBe(5);
  });

  it('nimmt eine nicht passende Meldung nicht auf, hält aber den Zähler nach', () => {
    const start = page([notification({ id: 'alt' })]);
    const fresh = notification({ id: 'gelesen', readAt: '2026-08-27T11:00:00.000Z' });

    const next = prependNotification(start, fresh, 9, { ...EMPTY_INBOX_FILTER, unreadOnly: true });

    expect(next.entries).toHaveLength(1);
    expect(next.unreadCount).toBe(9);
  });

  it('ersetzt eine bereits bekannte Meldung, statt sie doppelt zu führen', () => {
    const start = page([notification({ id: 'x', title: 'alt' })]);
    const updated = notification({ id: 'x', title: 'neu' });

    const next = prependNotification(start, updated, 1, EMPTY_INBOX_FILTER);

    expect(next.entries).toHaveLength(1);
    expect(next.entries.find((entry) => entry.id === 'x')?.title).toBe('neu');
  });
});

describe('setReadState', () => {
  it('markiert eine einzelne Meldung als gelesen und senkt den Zähler', () => {
    const start = page([notification({ id: 'a' }), notification({ id: 'b' })]);
    const next = setReadState(start, ['a'], true, '2026-08-27T12:00:00.000Z');

    expect(next.entries.find((entry) => entry.id === 'a')?.readAt).toBe('2026-08-27T12:00:00.000Z');
    expect(next.unreadCount).toBe(1);
  });

  it('senkt den Zähler beim zweiten Mal nicht erneut', () => {
    const start = page([notification({ id: 'a' })]);
    const once = setReadState(start, ['a'], true, 'x');
    const twice = setReadState(once, ['a'], true, 'x');

    expect(twice.unreadCount).toBe(0);
  });

  it('markiert bei ids=null alle als gelesen', () => {
    const start = page([notification({ id: 'a' }), notification({ id: 'b' })]);
    const next = setReadState(start, null, true, 'x');

    expect(next.entries.every((entry) => entry.readAt === 'x')).toBe(true);
    expect(next.unreadCount).toBe(0);
  });
});

describe('withoutNotification', () => {
  it('entfernt eine ungelesene Meldung und korrigiert beide Zähler', () => {
    const start = page([notification({ id: 'a' }), notification({ id: 'b' })]);
    const next = withoutNotification(start, 'a');

    expect(next.entries.map((entry) => entry.id)).toEqual(['b']);
    expect(next.total).toBe(1);
    expect(next.unreadCount).toBe(1);
  });

  it('lässt den ungelesen-Zähler bei einer gelesenen Meldung unangetastet', () => {
    const start = page([notification({ id: 'a', readAt: 'x' }), notification({ id: 'b' })]);
    const next = withoutNotification(start, 'a');

    expect(next.unreadCount).toBe(1);
    expect(next.total).toBe(1);
  });
});

describe('appendPage', () => {
  it('hängt an und verwirft Doppelte', () => {
    const first = page([notification({ id: 'a' }), notification({ id: 'b' })], { total: 4 });
    const second = page([notification({ id: 'b' }), notification({ id: 'c' })], {
      total: 4,
      offset: 2,
    });

    const merged = appendPage(first, second);

    expect(merged.entries.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(merged.total).toBe(4);
  });
});

describe('hasMore', () => {
  it('erkennt, ob noch etwas nachzuladen ist', () => {
    expect(hasMore(page([notification()], { total: 3 }))).toBe(true);
    expect(hasMore(page([notification()], { total: 1 }))).toBe(false);
  });
});

describe('unreadAnnouncements', () => {
  it('liefert nur ungelesene Ankündigungen, neueste zuerst', () => {
    const current = page([
      announcement({ id: 'a1' }),
      notification({ id: 'n1', event: 'server.started' }),
      announcement({ id: 'a2', readAt: 'x' }),
    ]);

    const result = unreadAnnouncements(current);

    expect(result.map((entry) => entry.id)).toEqual(['a1']);
  });

  it('kommt mit fehlender Seite zurecht', () => {
    expect(unreadAnnouncements(null)).toEqual([]);
  });
});

describe('Filter-Auswahl', () => {
  it('bietet jedes Ereignis alphabetisch nach deutscher Beschriftung', () => {
    const options = eventFilterOptions();
    expect(options).toHaveLength(NOTIFIABLE_EVENTS.length);

    const labels = options.map((option) => option.label);
    const sorted = [...labels].sort((left, right) => left.localeCompare(right, 'de'));
    expect(labels).toEqual(sorted);
  });

  it('bietet die Dringlichkeiten von leise nach laut', () => {
    expect(severityFilterOptions().map((option) => option.value)).toEqual([
      'info',
      'warning',
      'error',
    ]);
  });
});
