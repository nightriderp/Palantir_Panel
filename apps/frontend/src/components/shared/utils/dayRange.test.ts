import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dayInputFromIso, endOfDayIso, startOfDayIso } from './dayRange';

/**
 * Audit-Fundstelle frontend-lib-07 und Fundpunkt 139 – Tagesgrenzen lagen in
 * UTC statt in der Zeitzone des Browsers.
 *
 * Ein Admin in Berlin (CEST), der auf „Ab 01.09. Bis 01.09." filterte, schickte
 * `2026-09-01T00:00:00.000Z … T23:59:59.999Z` – also 02:00 Uhr des 1.9. bis
 * 01:59 Uhr des 2.9. seiner Zeit. Die ersten zwei Stunden des gewählten Tages
 * fehlten, dafür erschienen Einträge des Folgetages. Gemeint ist der
 * Kalendertag, den der Admin vor sich sieht.
 *
 * Die Tests standen bis Fundpunkt 139 bei `AuditLogView`, weil die Helfer dort
 * lagen. Mit dem Umzug ins Design-System liegen sie neben dem Baustein, den sie
 * prüfen – die beiden Ansichten testen ihrerseits, dass sie ihn benutzen.
 */

/** Zeitzone des Testlaufs umstellen – Node wertet `process.env.TZ` neu aus. */
function mitZeitzone(zone: string): () => void {
  const vorher = process.env.TZ;
  process.env.TZ = zone;
  return () => {
    process.env.TZ = vorher;
  };
}

describe('Tagesgrenzen – lokale Zeitzone (frontend-lib-07)', () => {
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

describe('Rückweg ins Datumsfeld (Fundpunkt 139)', () => {
  it('liest den Kalendertag lokal, nicht den UTC-Tag', () => {
    const tag = '2026-09-01';

    expect(dayInputFromIso(endOfDayIso(tag))).toBe(tag);
    expect(dayInputFromIso(startOfDayIso(tag))).toBe(tag);
  });

  it('lässt das Feld ohne Angabe leer', () => {
    expect(dayInputFromIso(null)).toBe('');
    expect(dayInputFromIso(undefined)).toBe('');
    expect(dayInputFromIso('')).toBe('');
    expect(dayInputFromIso('kein-datum')).toBe('');
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

  it('liest denselben Tag wieder zurück', () => {
    expect(dayInputFromIso('2026-09-01T21:59:59.999Z')).toBe('2026-09-01');
  });
});

describe('Tagesgrenzen westlich von Greenwich (America/New_York)', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('America/New_York');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  /*
   * Die Gegenprobe zu Berlin: Hier rutscht das Tagesende in den **Folgetag**
   * nach UTC. Genau daran scheitert ein `iso.slice(0, 10)` – der Rückweg muss
   * ebenso lokal rechnen wie der Hinweg (Fundpunkt 139).
   */
  it('sendet das Tagesende als Zeitstempel des Folgetags', () => {
    expect(endOfDayIso('2026-09-01')).toBe('2026-09-02T03:59:59.999Z');
  });

  it('liest daraus trotzdem wieder den 1.9.', () => {
    expect(dayInputFromIso('2026-09-02T03:59:59.999Z')).toBe('2026-09-01');
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
