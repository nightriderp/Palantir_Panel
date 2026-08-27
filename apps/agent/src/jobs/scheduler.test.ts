import { describe, expect, it, vi } from 'vitest';
import { JobScheduler } from './scheduler.js';
import { FakeTimers } from './test-timers.js';

describe('JobScheduler', () => {
  it('führt einen Job erst nach Ablauf des Intervalls aus', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    const laeufe: number[] = [];

    scheduler.every('probe', 1_000, async () => {
      laeufe.push(timers.now);
    });

    await timers.advance(999);
    expect(laeufe).toEqual([]);

    await timers.advance(1);
    expect(laeufe).toEqual([1_000]);
  });

  it('wiederholt den Job im Takt des Intervalls', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    const laeufe: number[] = [];

    scheduler.every('probe', 500, async () => {
      laeufe.push(timers.now);
    });

    await timers.advance(2_000);
    expect(laeufe).toEqual([500, 1_000, 1_500, 2_000]);
  });

  it('startet keinen zweiten Durchgang, solange der erste läuft', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    let gestartet = 0;
    let freigeben: (() => void) | undefined;

    scheduler.every('langsam', 100, async () => {
      gestartet += 1;
      await new Promise<void>((resolve) => {
        freigeben = resolve;
      });
    });

    await timers.advance(100);
    expect(gestartet).toBe(1);

    // Der Durchgang hängt noch – weitere Zeit darf keinen zweiten auslösen.
    await timers.advance(1_000);
    expect(gestartet).toBe(1);

    freigeben?.();
    await timers.advance(100);
    expect(gestartet).toBe(2);
  });

  it('läuft nach einem Fehler weiter und meldet ihn', async () => {
    const timers = new FakeTimers();
    const onError = vi.fn();
    const scheduler = new JobScheduler({ timers, onError });
    let durchgang = 0;

    scheduler.every('flatterhaft', 100, async () => {
      durchgang += 1;
      if (durchgang === 1) {
        throw new Error('Netzwerk weg');
      }
    });

    await timers.advance(100);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe('flatterhaft');

    await timers.advance(100);
    expect(durchgang).toBe(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('ersetzt einen gleichnamigen Job statt ihn zu verdoppeln', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    const laeufe: string[] = [];

    scheduler.every('ziel', 100, async () => {
      laeufe.push('alt');
    });
    scheduler.every('ziel', 100, async () => {
      laeufe.push('neu');
    });

    await timers.advance(100);
    expect(laeufe).toEqual(['neu']);
    expect(scheduler.jobNames).toEqual(['ziel']);
  });

  it('beendet einen Job über cancel()', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    const laeufe: number[] = [];

    const job = scheduler.every('ziel', 100, async () => {
      laeufe.push(timers.now);
    });

    await timers.advance(100);
    job.cancel();
    await timers.advance(1_000);

    expect(laeufe).toEqual([100]);
    expect(timers.pending).toBe(0);
  });

  it('beendet über stopAll() alle Jobs', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    const laeufe: string[] = [];

    scheduler.every('a', 100, async () => {
      laeufe.push('a');
    });
    scheduler.every('b', 100, async () => {
      laeufe.push('b');
    });

    scheduler.stopAll();
    await timers.advance(1_000);

    expect(laeufe).toEqual([]);
    expect(scheduler.jobNames).toEqual([]);
    expect(timers.pending).toBe(0);
  });

  it('führt runNow() sofort aus, ohne den Takt zu verdoppeln', async () => {
    const timers = new FakeTimers();
    const scheduler = new JobScheduler({ timers });
    let laeufe = 0;

    const job = scheduler.every('ziel', 1_000, async () => {
      laeufe += 1;
    });

    await job.runNow();
    expect(laeufe).toBe(1);

    await timers.advance(1_000);
    expect(laeufe).toBe(2);
  });

  it('lehnt ein Intervall von null oder weniger ab', () => {
    const scheduler = new JobScheduler({ timers: new FakeTimers() });
    expect(() => scheduler.every('ziel', 0, async () => undefined)).toThrow(RangeError);
    expect(() => scheduler.every('ziel', -5, async () => undefined)).toThrow(RangeError);
  });
});
