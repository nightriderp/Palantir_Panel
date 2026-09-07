import { describe, expect, it } from 'vitest';
import { auditLogQuerySchema } from './audit.js';

/**
 * Zeitraumfilter des Audit-Logs (contracts-validation-07).
 *
 * `from` und `to` sind ISO-8601-Zeitstempel, bei denen ein Zonen-Offset
 * ausdrücklich erlaubt ist. Genau dort fallen lexikographische und
 * chronologische Reihenfolge auseinander – der Vergleich muss deshalb über
 * die Zeitpunkte laufen, nicht über die Rohtexte.
 */
describe('Zeitraum der Audit-Log-Abfrage', () => {
  /** 10:00 in einer Zone mit +02:00 ist 08:00 UTC. */
  const ZEHN_UHR_PLUS_ZWEI = '2026-01-01T10:00:00+02:00';
  const NEUN_UHR_UTC = '2026-01-01T09:00:00Z';

  it('erlaubt einen Zeitraum in der richtigen Reihenfolge', () => {
    const ergebnis = auditLogQuerySchema.safeParse({
      from: '2026-01-01T08:00:00Z',
      to: '2026-01-01T09:00:00Z',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('lehnt einen Zeitraum ab, dessen Anfang nach dem Ende liegt', () => {
    const ergebnis = auditLogQuerySchema.safeParse({
      from: '2026-01-01T09:00:00Z',
      to: '2026-01-01T08:00:00Z',
    });

    expect(ergebnis.success).toBe(false);
    expect(ergebnis.success ? [] : ergebnis.error.issues[0]?.path).toEqual(['to']);
  });

  it('erlaubt gleiche Zeitpunkte – der Zeitraum ist beidseitig einschließlich', () => {
    const ergebnis = auditLogQuerySchema.safeParse({
      from: '2026-01-01T09:00:00Z',
      to: '2026-01-01T09:00:00Z',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('erlaubt denselben Zeitpunkt in zwei Schreibweisen', () => {
    // Beides ist 08:00 UTC, nur unterschiedlich notiert.
    const ergebnis = auditLogQuerySchema.safeParse({
      from: ZEHN_UHR_PLUS_ZWEI,
      to: '2026-01-01T08:00:00Z',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('erlaubt einen gültigen Zeitraum, der als Zeichenkette verdreht wirkt', () => {
    // 08:00 UTC bis 09:00 UTC – chronologisch richtig. Als Text steht
    // "…T10:00:00+02:00" hinter "…T09:00:00Z"; ein String-Vergleich hätte
    // diesen Zeitraum fälschlich mit VALIDATION_FAILED abgelehnt.
    const ergebnis = auditLogQuerySchema.safeParse({
      from: ZEHN_UHR_PLUS_ZWEI,
      to: NEUN_UHR_UTC,
    });

    expect(ergebnis.success).toBe(true);
  });

  it('lehnt einen verdrehten Zeitraum ab, der als Zeichenkette richtig wirkt', () => {
    // 09:00 UTC bis 08:00 UTC – chronologisch verdreht. Als Text steht
    // "…T09:00:00Z" vor "…T10:00:00+02:00"; ein String-Vergleich hätte den
    // Zeitraum fälschlich durchgelassen.
    const ergebnis = auditLogQuerySchema.safeParse({
      from: NEUN_UHR_UTC,
      to: ZEHN_UHR_PLUS_ZWEI,
    });

    expect(ergebnis.success).toBe(false);
    expect(ergebnis.success ? [] : ergebnis.error.issues[0]?.path).toEqual(['to']);
  });

  it('lässt eine offene Grenze zu', () => {
    expect(auditLogQuerySchema.safeParse({ from: NEUN_UHR_UTC }).success).toBe(true);
    expect(auditLogQuerySchema.safeParse({ to: NEUN_UHR_UTC }).success).toBe(true);
  });

  it('verlangt weiterhin ISO-8601', () => {
    expect(auditLogQuerySchema.safeParse({ from: '01.01.2026' }).success).toBe(false);
  });

  it('liefert Standardwerte für Seitengröße und Versatz', () => {
    expect(auditLogQuerySchema.parse({})).toEqual({ limit: 50, offset: 0 });
  });

  it('begrenzt die Seitengröße', () => {
    expect(auditLogQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});
