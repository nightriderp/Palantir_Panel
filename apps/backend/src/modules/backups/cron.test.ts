import { describe, expect, it } from 'vitest';
import { cronMatches, isValidCronExpression, nextCronRun, parseCronExpression } from './cron.js';

/** Lokale Zeit – der Zeitplan wird in der Zeitzone des Backends ausgewertet. */
function lokal(jahr: number, monat: number, tag: number, stunde = 0, minute = 0): Date {
  return new Date(jahr, monat - 1, tag, stunde, minute);
}

describe('Cron-Ausdruck zerlegen', () => {
  it.each([
    '* * * * *',
    '0 4 * * *',
    '*/15 * * * *',
    '0 3,15 * * *',
    '0 4 * * 1-5',
    '0-30/10 * * * *',
    '0 4 29 2 *',
  ])('nimmt %s an', (ausdruck) => {
    expect(isValidCronExpression(ausdruck)).toBe(true);
  });

  it.each([
    ['0 4 * *', 'zu wenige Felder'],
    ['0 4 * * * *', 'zu viele Felder'],
    ['60 4 * * *', 'Minute außerhalb 0–59'],
    ['0 24 * * *', 'Stunde außerhalb 0–23'],
    ['0 4 0 * *', 'Tag beginnt bei 1'],
    ['0 4 * 13 *', 'Monat außerhalb 1–12'],
    ['0 4 * * 8', 'Wochentag außerhalb 0–7'],
    ['0 4 5-1 * *', 'Bereich läuft rückwärts'],
    ['*/0 * * * *', 'Schrittweite 0'],
    ['MON 4 * * *', 'Namen werden bewusst nicht unterstützt'],
  ])('lehnt %s ab (%s)', (ausdruck) => {
    expect(isValidCronExpression(ausdruck)).toBe(false);
  });

  it('meldet einen ungültigen Ausdruck mit dem benannten Fehlercode', () => {
    expect(() => parseCronExpression('0 99 * * *')).toThrowError(
      expect.objectContaining({ code: 'SCHEDULE_INVALID_CRON' }),
    );
  });

  it('nennt in der Meldung das beanstandete Feld', () => {
    expect(() => parseCronExpression('0 99 * * *')).toThrowError(/Stunde/);
  });
});

describe('Passt der Ausdruck auf diesen Zeitpunkt?', () => {
  it('trifft die tägliche Uhrzeit', () => {
    const parsed = parseCronExpression('0 4 * * *');

    expect(cronMatches(parsed, lokal(2026, 8, 26, 4, 0))).toBe(true);
    expect(cronMatches(parsed, lokal(2026, 8, 26, 4, 1))).toBe(false);
    expect(cronMatches(parsed, lokal(2026, 8, 26, 5, 0))).toBe(false);
  });

  it('behandelt 0 und 7 beide als Sonntag', () => {
    const mitNull = parseCronExpression('0 4 * * 0');
    const mitSieben = parseCronExpression('0 4 * * 7');
    const sonntag = lokal(2026, 8, 30, 4, 0);

    expect(sonntag.getDay()).toBe(0);
    expect(cronMatches(mitNull, sonntag)).toBe(true);
    expect(cronMatches(mitSieben, sonntag)).toBe(true);
  });

  it('verknüpft Tag und Wochentag mit ODER, wenn beide gesetzt sind', () => {
    // Klassische Cron-Semantik: „jeden 13. und jeden Freitag“, nicht
    // „an Freitagen, die auf den 13. fallen“.
    const parsed = parseCronExpression('0 4 13 * 5');

    expect(cronMatches(parsed, lokal(2026, 8, 13, 4, 0))).toBe(true);
    expect(cronMatches(parsed, lokal(2026, 8, 28, 4, 0))).toBe(true);
    expect(cronMatches(parsed, lokal(2026, 8, 25, 4, 0))).toBe(false);
  });

  it('verlangt bei nur einem gesetzten Feld genau dieses', () => {
    const nurTag = parseCronExpression('0 4 13 * *');

    expect(cronMatches(nurTag, lokal(2026, 8, 13, 4, 0))).toBe(true);
    expect(cronMatches(nurTag, lokal(2026, 8, 28, 4, 0))).toBe(false);
  });
});

describe('Nächster Lauf', () => {
  it('springt auf die nächste passende Uhrzeit am selben Tag', () => {
    expect(nextCronRun('0 4 * * *', lokal(2026, 8, 26, 1, 30))).toEqual(lokal(2026, 8, 26, 4, 0));
  });

  it('springt auf den Folgetag, wenn die Uhrzeit vorbei ist', () => {
    expect(nextCronRun('0 4 * * *', lokal(2026, 8, 26, 4, 0))).toEqual(lokal(2026, 8, 27, 4, 0));
  });

  it('liefert nie den Zeitpunkt selbst zurück – die laufende Minute hat bereits ausgelöst', () => {
    const jetzt = lokal(2026, 8, 26, 4, 0);

    expect(nextCronRun('0 4 * * *', jetzt)?.getTime()).toBeGreaterThan(jetzt.getTime());
  });

  it('findet die nächste Viertelstunde', () => {
    expect(nextCronRun('*/15 * * * *', lokal(2026, 8, 26, 4, 3))).toEqual(
      lokal(2026, 8, 26, 4, 15),
    );
  });

  it('findet den nächsten passenden Wochentag', () => {
    // Der 26.08.2026 ist ein Mittwoch; der nächste Montag ist der 31.08.
    expect(nextCronRun('0 4 * * 1', lokal(2026, 8, 26, 12, 0))).toEqual(lokal(2026, 8, 31, 4, 0));
  });

  it('findet auch einen Termin im Schaltjahr', () => {
    expect(nextCronRun('0 4 29 2 *', lokal(2026, 8, 26, 12, 0))).toEqual(lokal(2028, 2, 29, 4, 0));
  });

  it('liefert null bei einem formal gültigen, aber unerfüllbaren Ausdruck', () => {
    // Den 30. Februar gibt es nicht – ohne Obergrenze liefe die Suche endlos.
    expect(nextCronRun('0 4 30 2 *', lokal(2026, 8, 26, 12, 0))).toBeNull();
  });
});
