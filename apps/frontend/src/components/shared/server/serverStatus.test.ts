import { describe, expect, it } from 'vitest';
import { SERVER_STATUSES, type ServerStatus } from '@palantir/contracts';
import {
  SERVER_STATUS_META,
  hasLiveStats,
  isLifecycleActionBlocked,
  serverStatusMeta,
  startStopAction,
} from './serverStatus';

describe('SERVER_STATUS_META', () => {
  it('deckt alle sieben Lifecycle-Zustände aus Pflichtenheft §9 ab', () => {
    expect(Object.keys(SERVER_STATUS_META).sort()).toEqual([...SERVER_STATUSES].sort());
  });

  it('liefert für jeden Zustand eine deutsche Beschriftung', () => {
    for (const status of SERVER_STATUSES) {
      expect(serverStatusMeta(status).label.length).toBeGreaterThan(0);
      expect(serverStatusMeta(status).description.length).toBeGreaterThan(0);
    }
  });

  it('markiert genau die Zwischenzustände als transitional', () => {
    const transitional = SERVER_STATUSES.filter((s) => SERVER_STATUS_META[s].transitional);
    expect(transitional).toEqual(['creating', 'starting', 'stopping']);
  });

  it('markiert genau error und crashed als Störung', () => {
    const faulted = SERVER_STATUSES.filter((s) => SERVER_STATUS_META[s].faulted);
    expect(faulted).toEqual(['error', 'crashed']);
  });
});

describe('startStopAction', () => {
  it('bietet Stoppen an, solange der Server läuft oder herunterfährt', () => {
    expect(startStopAction('running')).toBe('stop');
    expect(startStopAction('stopping')).toBe('stop');
  });

  it('bietet sonst Starten an', () => {
    const starting: ServerStatus[] = ['creating', 'stopped', 'starting', 'error', 'crashed'];
    for (const status of starting) {
      expect(startStopAction(status)).toBe('start');
    }
  });
});

describe('isLifecycleActionBlocked', () => {
  it('sperrt die Aktion während eines laufenden Übergangs', () => {
    expect(isLifecycleActionBlocked('creating')).toBe(true);
    expect(isLifecycleActionBlocked('starting')).toBe(true);
    expect(isLifecycleActionBlocked('stopping')).toBe(true);
  });

  it('gibt Ruhezustände frei – auch nach einem Absturz', () => {
    expect(isLifecycleActionBlocked('stopped')).toBe(false);
    expect(isLifecycleActionBlocked('running')).toBe(false);
    expect(isLifecycleActionBlocked('crashed')).toBe(false);
    expect(isLifecycleActionBlocked('error')).toBe(false);
  });
});

describe('hasLiveStats', () => {
  it('erwartet Messwerte nur, solange der Container läuft', () => {
    expect(hasLiveStats('running')).toBe(true);
    expect(hasLiveStats('starting')).toBe(true);
    expect(hasLiveStats('stopping')).toBe(true);
    expect(hasLiveStats('stopped')).toBe(false);
    expect(hasLiveStats('creating')).toBe(false);
    expect(hasLiveStats('crashed')).toBe(false);
  });
});
