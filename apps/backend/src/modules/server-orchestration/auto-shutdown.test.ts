import { type ServerAutoShutdown } from './types.js';
import { describe, expect, it } from 'vitest';
import {
  type AutoShutdownInput,
  DEFAULT_AUTO_SHUTDOWN,
  decideAutoShutdown,
  graceEndsAt,
} from './auto-shutdown.js';

const T0 = new Date('2026-08-26T12:00:00.000Z');
const minutesAgo = (minutes: number): string =>
  new Date(T0.getTime() - minutes * 60_000).toISOString();

const settings: ServerAutoShutdown = {
  enabled: true,
  idleTimeoutMinutes: 30,
  graceMinutes: 15,
};

function input(overrides: Partial<AutoShutdownInput> = {}): AutoShutdownInput {
  return {
    settings,
    status: 'running',
    lastStartedAt: minutesAgo(60),
    lastActivityAt: minutesAgo(60),
    playersOnline: 0,
    now: T0,
    ...overrides,
  };
}

describe('Auto-Shutdown (Pflichtenheft §9)', () => {
  it('schaltet einen lange leeren Server ab', () => {
    const decision = decideAutoShutdown(input());

    expect(decision.action).toBe('shutdown');
  });

  it('meldet die Inaktivitätsdauer mit', () => {
    const decision = decideAutoShutdown(input({ lastActivityAt: minutesAgo(45) }));

    expect(decision).toEqual({ action: 'shutdown', idleMinutes: 45 });
  });

  it('lässt einen pro Server deaktivierten Auto-Shutdown in Ruhe', () => {
    const decision = decideAutoShutdown(input({ settings: { ...settings, enabled: false } }));

    expect(decision).toEqual({ action: 'keepRunning', reason: 'disabled' });
  });

  it('schaltet nur laufende Server ab', () => {
    for (const status of [
      'creating',
      'stopped',
      'starting',
      'stopping',
      'error',
      'crashed',
    ] as const) {
      expect(decideAutoShutdown(input({ status }))).toEqual({
        action: 'keepRunning',
        reason: 'notRunning',
      });
    }
  });

  it('respektiert die Schonfrist nach dem Start', () => {
    const decision = decideAutoShutdown(
      input({ lastStartedAt: minutesAgo(5), lastActivityAt: minutesAgo(5) }),
    );

    expect(decision).toEqual({ action: 'keepRunning', reason: 'graceActive' });
  });

  it('stellt die Schonfrist über die Spielerzahl', () => {
    // Innerhalb der Schonfrist darf ein Server auch leer laufen.
    const decision = decideAutoShutdown(
      input({ lastStartedAt: minutesAgo(1), lastActivityAt: minutesAgo(90), playersOnline: 0 }),
    );

    expect(decision).toEqual({ action: 'keepRunning', reason: 'graceActive' });
  });

  it('lässt einen Server mit Spielern laufen', () => {
    const decision = decideAutoShutdown(input({ playersOnline: 3 }));

    expect(decision).toEqual({ action: 'keepRunning', reason: 'playersOnline' });
  });

  it('lässt einen Server unterhalb des Timeouts laufen', () => {
    const decision = decideAutoShutdown(input({ lastActivityAt: minutesAgo(29) }));

    expect(decision).toEqual({ action: 'keepRunning', reason: 'idleBelowTimeout' });
  });

  it('rechnet ohne Aktivitätszeitpunkt ab dem Start', () => {
    // Seit dem Start war niemand da – also ist der Server seit dem Start inaktiv.
    const decision = decideAutoShutdown(
      input({ lastActivityAt: null, lastStartedAt: minutesAgo(40) }),
    );

    expect(decision).toEqual({ action: 'shutdown', idleMinutes: 40 });
  });

  it('schaltet ohne jeden Bezugspunkt nicht ab', () => {
    const decision = decideAutoShutdown(input({ lastActivityAt: null, lastStartedAt: null }));

    expect(decision).toEqual({ action: 'keepRunning', reason: 'activityUnknown' });
  });

  it('schaltet bei unlesbarem Zeitstempel nicht ab', () => {
    const decision = decideAutoShutdown(
      input({ lastActivityAt: 'kein-datum', lastStartedAt: null }),
    );

    expect(decision).toEqual({ action: 'keepRunning', reason: 'activityUnknown' });
  });

  it('erlaubt eine Schonfrist von null Minuten', () => {
    const decision = decideAutoShutdown(
      input({
        settings: { ...settings, graceMinutes: 0 },
        lastStartedAt: minutesAgo(31),
        lastActivityAt: minutesAgo(31),
      }),
    );

    expect(decision.action).toBe('shutdown');
  });
});

describe('graceEndsAt()', () => {
  it('liefert das Ende der Schonfrist', () => {
    expect(graceEndsAt(settings, minutesAgo(5))).toBe(
      new Date(T0.getTime() + 10 * 60_000).toISOString(),
    );
  });

  it('liefert null bei abgeschaltetem Auto-Shutdown oder ohne Start', () => {
    expect(graceEndsAt({ ...settings, enabled: false }, minutesAgo(5))).toBeNull();
    expect(graceEndsAt(settings, null)).toBeNull();
    expect(graceEndsAt(settings, 'kein-datum')).toBeNull();
  });
});

describe('Vorgabewerte', () => {
  it('sind eingeschaltet mit 30 Minuten Timeout und 15 Minuten Schonfrist', () => {
    expect(DEFAULT_AUTO_SHUTDOWN).toEqual({
      enabled: true,
      idleTimeoutMinutes: 30,
      graceMinutes: 15,
    });
  });
});
