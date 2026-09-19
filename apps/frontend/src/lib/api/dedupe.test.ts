import { describe, expect, it, vi } from 'vitest';
import { teileAbruf } from './dedupe';

/**
 * Gleichzeitige Abrufe derselben Adresse teilen sich eine Anfrage
 * (Leistungsbericht 19.09.2026, Punkt 4).
 */

function offenerAbruf<T>() {
  let aufloesen: (wert: T) => void = () => undefined;
  const versprechen = new Promise<T>((weiter) => {
    aufloesen = weiter;
  });

  return { versprechen, aufloesen: (wert: T) => aufloesen(wert) };
}

/*
 * Je Fall ein eigener Schluessel: Die Karte der laufenden Abrufe lebt im
 * Modul, und ein Fall, der seine Anfrage offen laesst, wuerde dem naechsten
 * seine eigene wegnehmen.
 */
let zaehler = 0;
const schluessel = (): string => {
  zaehler += 1;

  return `/api/servers?fall=${String(zaehler)}`;
};

describe('teileAbruf()', () => {
  it('startet nur eine Anfrage, wenn zwei gleichzeitig fragen', async () => {
    const offen = offenerAbruf<string>();
    const starten = vi.fn(() => offen.versprechen);

    const adresse = schluessel();
    const erster = teileAbruf(adresse, starten);
    const zweiter = teileAbruf(adresse, starten);

    expect(starten).toHaveBeenCalledTimes(1);

    offen.aufloesen('Liste');

    await expect(erster).resolves.toBe('Liste');
    await expect(zweiter).resolves.toBe('Liste');
  });

  it('holt nach der Antwort wieder frisch – es ist kein Zwischenspeicher', async () => {
    const starten = vi.fn(() => Promise.resolve('Liste'));

    const adresse = schluessel();

    await teileAbruf(adresse, starten);
    await teileAbruf(adresse, starten);

    expect(starten).toHaveBeenCalledTimes(2);
  });

  it('trennt verschiedene Adressen', () => {
    const starten = vi.fn(() => new Promise<string>(() => undefined));

    void teileAbruf(schluessel(), starten);
    void teileAbruf(schluessel(), starten);

    expect(starten).toHaveBeenCalledTimes(2);
  });

  it('lässt die geteilte Anfrage weiterlaufen, wenn einer abbricht', async () => {
    const offen = offenerAbruf<string>();
    const starten = vi.fn((signal: AbortSignal) => {
      // Der Test prüft unten, dass genau dieses Signal nicht angefasst wird.
      expect(signal.aborted).toBe(false);

      return offen.versprechen;
    });

    const steuerung = new AbortController();
    const adresse = schluessel();
    const abbrechender = teileAbruf(adresse, starten, steuerung.signal);
    const bleibender = teileAbruf(adresse, starten);

    steuerung.abort();

    await expect(abbrechender).rejects.toMatchObject({ name: 'AbortError' });

    offen.aufloesen('Liste');

    // Der zweite bekommt seine Daten, obwohl der erste weg ist.
    await expect(bleibender).resolves.toBe('Liste');
  });

  it('bricht die geteilte Anfrage ab, sobald niemand mehr wartet', async () => {
    // Absichtlich ueber ein Objekt: Eine einfache Variable verengt TypeScript
    // nach der Zuweisung im Rueckruf auf `never`.
    const geteilt: { signal: AbortSignal | null } = { signal: null };
    const starten = (signal: AbortSignal) => {
      geteilt.signal = signal;

      return new Promise<string>(() => undefined);
    };

    const einer = new AbortController();
    const anderer = new AbortController();
    const adresse = schluessel();
    const ersterAbruf = teileAbruf(adresse, starten, einer.signal);
    const zweiterAbruf = teileAbruf(adresse, starten, anderer.signal);

    einer.abort();
    await expect(ersterAbruf).rejects.toMatchObject({ name: 'AbortError' });
    expect(geteilt.signal?.aborted).toBe(false);

    anderer.abort();
    await expect(zweiterAbruf).rejects.toMatchObject({ name: 'AbortError' });
    expect(geteilt.signal?.aborted).toBe(true);
  });

  it('meldet ein bereits abgebrochenes Signal sofort', async () => {
    const starten = vi.fn(() => Promise.resolve('Liste'));
    const steuerung = new AbortController();

    steuerung.abort();

    await expect(teileAbruf(schluessel(), starten, steuerung.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
