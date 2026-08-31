import { describe, expect, it } from 'vitest';
import { daysBetween } from './index.js';

/**
 * „Tage im Dienst" (Mockup-Abgleich 2.1).
 *
 * Die Zahl steht auf der Anmeldeseite, also vor jeder Sitzung. Sie darf weder
 * negativ werden (falsch gestellte Uhr, Konto aus der Zukunft) noch aufrunden –
 * ein angefangener Tag ist kein Tag im Dienst.
 */
describe('daysBetween', () => {
  const start = new Date('2026-01-01T12:00:00.000Z');

  it('zählt volle Tage', () => {
    expect(daysBetween(start, new Date('2026-01-04T12:00:00.000Z'))).toBe(3);
  });

  it('rundet einen angefangenen Tag ab', () => {
    expect(daysBetween(start, new Date('2026-01-04T11:59:00.000Z'))).toBe(2);
  });

  it('bleibt am ersten Tag bei null', () => {
    expect(daysBetween(start, new Date('2026-01-01T18:00:00.000Z'))).toBe(0);
  });

  it('wird nie negativ', () => {
    // Etwa bei einer falsch gestellten Uhr auf der VPS.
    expect(daysBetween(start, new Date('2025-12-01T00:00:00.000Z'))).toBe(0);
  });
});
