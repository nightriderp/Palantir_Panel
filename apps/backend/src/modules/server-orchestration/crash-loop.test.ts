import { describe, expect, it } from 'vitest';
import {
  type CrashLoopPolicy,
  DEFAULT_CRASH_LOOP_POLICY,
  clearCrashHistory,
  evaluateCrashLoop,
  pruneCrashTimestamps,
  registerCrash,
} from './crash-loop.js';

const T0 = new Date('2026-08-26T12:00:00.000Z');
const policy: CrashLoopPolicy = { maxRestarts: 3, windowMinutes: 10 };

const minutesAgo = (minutes: number): string =>
  new Date(T0.getTime() - minutes * 60_000).toISOString();

describe('pruneCrashTimestamps()', () => {
  it('behält Einträge innerhalb des Fensters', () => {
    const kept = pruneCrashTimestamps([minutesAgo(1), minutesAgo(9)], T0, 10);

    expect(kept).toHaveLength(2);
  });

  it('verwirft Einträge außerhalb des Fensters', () => {
    expect(pruneCrashTimestamps([minutesAgo(11), minutesAgo(60)], T0, 10)).toEqual([]);
  });

  it('verwirft unlesbare Zeitstempel, statt sie als „jetzt" zu werten', () => {
    // Ein kaputter Eintrag in der Datenbank darf keinen Server abschalten.
    expect(pruneCrashTimestamps(['kein-datum', minutesAgo(1)], T0, 10)).toHaveLength(1);
  });

  it('sortiert aufsteigend', () => {
    const sorted = pruneCrashTimestamps([minutesAgo(1), minutesAgo(5), minutesAgo(3)], T0, 10);

    expect(sorted).toEqual([minutesAgo(5), minutesAgo(3), minutesAgo(1)]);
  });
});

describe('registerCrash()', () => {
  it('zählt den gemeldeten Absturz mit', () => {
    const result = registerCrash([], T0, policy);

    expect(result.recentCrashCount).toBe(1);
    expect(result.crashTimestamps).toEqual([T0.toISOString()]);
  });

  it('löst erst beim Absturz nach dem letzten erlaubten Versuch aus', () => {
    const history = [minutesAgo(3), minutesAgo(2), minutesAgo(1)];

    expect(registerCrash(history.slice(0, 2), T0, policy).tripped).toBe(false);
    expect(registerCrash(history, T0, policy).tripped).toBe(true);
  });

  it('meldet die verbleibenden Versuche', () => {
    expect(registerCrash([], T0, policy).remainingAttempts).toBe(3);
    expect(registerCrash([minutesAgo(1)], T0, policy).remainingAttempts).toBe(2);
    expect(registerCrash([minutesAgo(2), minutesAgo(1)], T0, policy).remainingAttempts).toBe(1);
  });

  it('lässt alte Abstürze außer Betracht', () => {
    const old = [minutesAgo(30), minutesAgo(25), minutesAgo(20)];
    const result = registerCrash(old, T0, policy);

    expect(result.tripped).toBe(false);
    expect(result.recentCrashCount).toBe(1);
  });

  it('schaltet bei maxRestarts = 0 sofort ab', () => {
    // Ein Betreiber, der automatische Neustarts abschalten will, soll das über
    // die Konfiguration können, ohne dass ein Sonderfall im Code nötig wird.
    const result = registerCrash([], T0, { maxRestarts: 0, windowMinutes: 10 });

    expect(result.tripped).toBe(true);
  });
});

describe('evaluateCrashLoop()', () => {
  it('meldet die Abstürze im Fenster, ohne einen neuen zu zählen', () => {
    const result = evaluateCrashLoop([minutesAgo(1), minutesAgo(20)], T0, policy);

    expect(result.recentCrashCount).toBe(1);
    expect(result.crashTimestamps).toEqual([minutesAgo(1)]);
  });

  it('meldet ohne Historie einen leeren Stand', () => {
    expect(evaluateCrashLoop([], T0, policy).recentCrashCount).toBe(0);
  });
});

describe('Vorgabewerte', () => {
  it('erlaubt drei Neustarts in zehn Minuten', () => {
    expect(DEFAULT_CRASH_LOOP_POLICY).toEqual({ maxRestarts: 3, windowMinutes: 10 });
  });

  it('clearCrashHistory() liefert eine leere Historie', () => {
    expect(clearCrashHistory()).toEqual([]);
  });
});
