import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKOFF_OPTIONS, ExponentialBackoff } from './backoff.js';

/** Jitter ausgeschaltet, damit die reine Wachstumskurve prüfbar ist. */
const OHNE_JITTER = { jitterRatio: 0 };

describe('Exponentielles Backoff (Pflichtenheft §2.2)', () => {
  it('verdoppelt die Wartezeit mit jedem Versuch', () => {
    const backoff = new ExponentialBackoff({ ...OHNE_JITTER, initialDelayMs: 1_000, factor: 2 });

    expect([
      backoff.nextDelayMs(),
      backoff.nextDelayMs(),
      backoff.nextDelayMs(),
      backoff.nextDelayMs(),
    ]).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('wächst nie über maxDelayMs hinaus', () => {
    const backoff = new ExponentialBackoff({
      ...OHNE_JITTER,
      initialDelayMs: 1_000,
      maxDelayMs: 5_000,
      factor: 2,
    });

    const wartezeiten = Array.from({ length: 20 }, () => backoff.nextDelayMs());

    expect(Math.max(...wartezeiten)).toBe(5_000);
    expect(wartezeiten.slice(-5)).toEqual([5_000, 5_000, 5_000, 5_000, 5_000]);
  });

  it('beginnt nach reset() wieder bei der Anfangswartezeit', () => {
    const backoff = new ExponentialBackoff(OHNE_JITTER);

    backoff.nextDelayMs();
    backoff.nextDelayMs();
    expect(backoff.attempt).toBe(2);

    backoff.reset();

    expect(backoff.attempt).toBe(0);
    expect(backoff.nextDelayMs()).toBe(DEFAULT_BACKOFF_OPTIONS.initialDelayMs);
  });

  it('zählt die vergebenen Versuche mit', () => {
    const backoff = new ExponentialBackoff(OHNE_JITTER);

    expect(backoff.attempt).toBe(0);
    backoff.nextDelayMs();
    backoff.nextDelayMs();
    expect(backoff.attempt).toBe(2);
  });

  describe('Jitter', () => {
    it('streut symmetrisch um die berechnete Wartezeit', () => {
      // random() = 0 -> unteres Ende, 0.5 -> Mitte, ~1 -> oberes Ende.
      const untenBackoff = new ExponentialBackoff(
        { initialDelayMs: 1_000, jitterRatio: 0.2 },
        () => 0,
      );
      const mitteBackoff = new ExponentialBackoff(
        { initialDelayMs: 1_000, jitterRatio: 0.2 },
        () => 0.5,
      );
      const obenBackoff = new ExponentialBackoff(
        { initialDelayMs: 1_000, jitterRatio: 0.2 },
        () => 1,
      );

      expect(untenBackoff.nextDelayMs()).toBe(800);
      expect(mitteBackoff.nextDelayMs()).toBe(1_000);
      expect(obenBackoff.nextDelayMs()).toBe(1_200);
    });

    it('bleibt auch am oberen Ende innerhalb der Streubreite um maxDelayMs', () => {
      const backoff = new ExponentialBackoff(
        { initialDelayMs: 1_000, maxDelayMs: 10_000, jitterRatio: 0.2 },
        () => 1,
      );

      for (let i = 0; i < 20; i += 1) {
        backoff.nextDelayMs();
      }

      expect(backoff.nextDelayMs()).toBe(12_000);
    });

    it('liefert nie eine negative Wartezeit', () => {
      const backoff = new ExponentialBackoff({ initialDelayMs: 1, jitterRatio: 0.99 }, () => 0);

      expect(backoff.nextDelayMs()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('unsinnige Einstellungen', () => {
    it('lehnt eine Anfangswartezeit von 0 ab', () => {
      expect(() => new ExponentialBackoff({ initialDelayMs: 0 })).toThrow(/initialDelayMs/);
    });

    it('lehnt einen Faktor <= 1 ab, weil die Wartezeit sonst nicht wächst', () => {
      expect(() => new ExponentialBackoff({ factor: 1 })).toThrow(/factor/);
    });

    it('lehnt maxDelayMs kleiner als initialDelayMs ab', () => {
      expect(() => new ExponentialBackoff({ initialDelayMs: 5_000, maxDelayMs: 1_000 })).toThrow(
        /maxDelayMs/,
      );
    });

    it('lehnt einen Jitter-Anteil außerhalb von [0, 1) ab', () => {
      expect(() => new ExponentialBackoff({ jitterRatio: 1 })).toThrow(/jitterRatio/);
      expect(() => new ExponentialBackoff({ jitterRatio: -0.1 })).toThrow(/jitterRatio/);
    });
  });
});
