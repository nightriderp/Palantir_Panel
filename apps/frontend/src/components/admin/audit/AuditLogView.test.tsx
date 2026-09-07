import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { endOfDayIso, startOfDayIso } from './AuditLogView';

/**
 * Audit-Fundstelle frontend-lib-07 – die Tagesgrenzen des Audit-Filters lagen
 * in UTC.
 *
 * Ein Admin in Berlin (CEST), der auf „Ab 01.09. Bis 01.09." filterte, schickte
 * `2026-09-01T00:00:00.000Z … T23:59:59.999Z` – also 02:00 Uhr des 1.9. bis
 * 01:59 Uhr des 2.9. seiner Zeit. Die ersten zwei Stunden des gewählten Tages
 * fehlten, dafür erschienen Einträge des Folgetages. Gemeint ist der
 * Kalendertag, den der Admin vor sich sieht.
 */

/** Zeitzone des Testlaufs umstellen – Node wertet `process.env.TZ` neu aus. */
function mitZeitzone(zone: string): () => void {
  const vorher = process.env.TZ;
  process.env.TZ = zone;
  return () => {
    process.env.TZ = vorher;
  };
}

describe('Tagesgrenzen des Audit-Filters – lokale Zeitzone (frontend-lib-07)', () => {
  it('bildet den Tagesbeginn in der Zeitzone des Browsers', () => {
    const grenze = new Date(startOfDayIso('2026-09-01'));

    expect(grenze.getFullYear()).toBe(2026);
    expect(grenze.getMonth()).toBe(8);
    expect(grenze.getDate()).toBe(1);
    expect(grenze.getHours()).toBe(0);
    expect(grenze.getMinutes()).toBe(0);
    expect(grenze.getSeconds()).toBe(0);
    expect(grenze.getMilliseconds()).toBe(0);
  });

  it('bildet das Tagesende einschließlich der letzten Millisekunde', () => {
    const grenze = new Date(endOfDayIso('2026-09-01'));

    expect(grenze.getDate()).toBe(1);
    expect(grenze.getHours()).toBe(23);
    expect(grenze.getMinutes()).toBe(59);
    expect(grenze.getSeconds()).toBe(59);
    expect(grenze.getMilliseconds()).toBe(999);
  });

  it('umfasst genau einen vollen Tag', () => {
    const von = new Date(startOfDayIso('2026-09-01')).getTime();
    const bis = new Date(endOfDayIso('2026-09-01')).getTime();

    expect(bis - von).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('gibt ein unbrauchbares Datum unverändert zurück', () => {
    expect(startOfDayIso('')).toBe('');
    expect(endOfDayIso('kein-datum')).toBe('kein-datum');
  });
});

describe('Tagesgrenzen in Europe/Berlin (Sommerzeit)', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('Europe/Berlin');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  it('setzt am 1.9. voraus, dass der Testlauf wirklich auf Berlin steht', () => {
    expect(new Date(2026, 8, 1).getTimezoneOffset()).toBe(-120);
  });

  it('sendet 22:00 Uhr UTC des Vortags als Tagesbeginn', () => {
    expect(startOfDayIso('2026-09-01')).toBe('2026-08-31T22:00:00.000Z');
  });

  it('sendet 21:59:59.999 Uhr UTC desselben Tages als Tagesende', () => {
    expect(endOfDayIso('2026-09-01')).toBe('2026-09-01T21:59:59.999Z');
  });
});

describe('Tagesgrenzen in UTC', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('UTC');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  it('bleibt in UTC beim bisherigen Ergebnis', () => {
    expect(startOfDayIso('2026-09-01')).toBe('2026-09-01T00:00:00.000Z');
    expect(endOfDayIso('2026-09-01')).toBe('2026-09-01T23:59:59.999Z');
  });
});
