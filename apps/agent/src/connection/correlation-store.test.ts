import { ok } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { CorrelationStore } from './correlation-store.js';

const ID_A = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const ID_B = '9c858901-8a57-4791-81fe-4c455b099bc9';

function erledigt(correlationId: string) {
  return {
    correlationId,
    command: 'START' as const,
    result: ok({ containerId: 'abc123' }),
    completedAt: '2026-08-26T10:00:00.000Z',
  };
}

describe('Korrelations-ID-Deduplizierung (Pflichtenheft §2.2)', () => {
  it('lässt eine unbekannte ID durch', () => {
    const store = new CorrelationStore();

    expect(store.markInFlight(ID_A)).toBe(true);
    expect(store.isInFlight(ID_A)).toBe(true);
  });

  it('verwirft eine ID, die gerade ausgeführt wird', () => {
    const store = new CorrelationStore();

    store.markInFlight(ID_A);

    expect(store.markInFlight(ID_A)).toBe(false);
  });

  it('verwirft eine ID, deren Befehl bereits abgeschlossen ist', () => {
    const store = new CorrelationStore();

    store.markInFlight(ID_A);
    store.complete(erledigt(ID_A));

    expect(store.markInFlight(ID_A)).toBe(false);
  });

  it('hält das Ergebnis fest, damit ein Retry es erneut bekommt', () => {
    const store = new CorrelationStore();

    store.markInFlight(ID_A);
    store.complete(erledigt(ID_A));

    const wiederholung = store.getCompleted(ID_A);

    expect(wiederholung?.command).toBe('START');
    expect(wiederholung?.result).toEqual(ok({ containerId: 'abc123' }));
    expect(wiederholung?.completedAt).toBe('2026-08-26T10:00:00.000Z');
  });

  it('unterscheidet verschiedene IDs', () => {
    const store = new CorrelationStore();

    store.markInFlight(ID_A);
    store.complete(erledigt(ID_A));

    expect(store.markInFlight(ID_B)).toBe(true);
    expect(store.getCompleted(ID_B)).toBeUndefined();
  });

  it('beendet die Ausführungsmarkierung nach dem Abschluss', () => {
    const store = new CorrelationStore();

    store.markInFlight(ID_A);
    store.complete(erledigt(ID_A));

    expect(store.isInFlight(ID_A)).toBe(false);
  });

  it('gibt eine abgebrochene Ausführung wieder frei', () => {
    const store = new CorrelationStore();

    store.markInFlight(ID_A);
    store.abandon(ID_A);

    // Bricht die Ausführung ab, darf der Befehl erneut versucht werden – sonst
    // bliebe die ID für immer als "läuft gerade" blockiert.
    expect(store.isInFlight(ID_A)).toBe(false);
    expect(store.markInFlight(ID_A)).toBe(true);
  });

  describe('Ablauf nach Lebensdauer', () => {
    it('vergisst einen Eintrag nach Ablauf der TTL', () => {
      let jetzt = 0;
      const store = new CorrelationStore({ ttlMs: 1_000 }, () => jetzt);

      store.markInFlight(ID_A);
      store.complete(erledigt(ID_A));
      expect(store.getCompleted(ID_A)).toBeDefined();

      jetzt = 1_000;

      expect(store.getCompleted(ID_A)).toBeUndefined();
      expect(store.markInFlight(ID_A)).toBe(true);
    });

    it('behält einen Eintrag innerhalb der TTL', () => {
      let jetzt = 0;
      const store = new CorrelationStore({ ttlMs: 1_000 }, () => jetzt);

      store.markInFlight(ID_A);
      store.complete(erledigt(ID_A));

      jetzt = 999;

      expect(store.getCompleted(ID_A)).toBeDefined();
    });
  });

  describe('Wachstumsgrenze', () => {
    it('verdrängt die ältesten Einträge über maxEntries hinaus', () => {
      const store = new CorrelationStore({ maxEntries: 2 });
      const ids = [ID_A, ID_B, '11111111-2222-4333-8444-555555555555'];

      for (const id of ids) {
        store.markInFlight(id);
        store.complete(erledigt(id));
      }

      expect(store.size).toBe(2);
      expect(store.getCompleted(ids[0] as string)).toBeUndefined();
      expect(store.getCompleted(ids[1] as string)).toBeDefined();
      expect(store.getCompleted(ids[2] as string)).toBeDefined();
    });
  });

  describe('unsinnige Einstellungen', () => {
    it('lehnt maxEntries von 0 ab', () => {
      expect(() => new CorrelationStore({ maxEntries: 0 })).toThrow(/maxEntries/);
    });

    it('lehnt eine TTL von 0 ab', () => {
      expect(() => new CorrelationStore({ ttlMs: 0 })).toThrow(/ttlMs/);
    });
  });
});
