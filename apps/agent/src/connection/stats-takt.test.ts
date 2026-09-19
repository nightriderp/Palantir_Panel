import { describe, expect, it } from 'vitest';
import { StatsTakt } from './stats-takt.js';

/**
 * Takt der Live-Messwerte (Leistungsbericht 19.09.2026, Punkt 5).
 *
 * Die Uhr wird gestellt, nicht abgewartet: Ein Test, der eine Sekunde
 * schläft, um eine Sekunde zu prüfen, macht die Testkette langsam und das
 * Ergebnis wacklig.
 */

function taktMitUhr(optionen: Parameters<typeof erzeuge>[1] = {}) {
  const uhr = { jetzt: 0 };

  return { uhr, takt: erzeuge(uhr, optionen) };
}

function erzeuge(
  uhr: { jetzt: number },
  optionen: { minIntervalMs?: number; maxIntervalMs?: number; proContainerMs?: number } = {},
): StatsTakt {
  return new StatsTakt({ ...optionen, now: () => uhr.jetzt });
}

describe('StatsTakt', () => {
  it('lässt den ersten Messwert eines Containers sofort durch', () => {
    // Sonst stünde die Kachel nach dem Start noch einen Takt lang auf „—".
    const { takt } = taktMitUhr();

    expect(takt.darfSenden('c-1', 1)).toBe(true);
  });

  it('verwirft, was innerhalb des Abstands nachkommt', () => {
    const { uhr, takt } = taktMitUhr();

    expect(takt.darfSenden('c-1', 1)).toBe(true);

    uhr.jetzt = 999;
    expect(takt.darfSenden('c-1', 1)).toBe(false);

    uhr.jetzt = 1_000;
    expect(takt.darfSenden('c-1', 1)).toBe(true);
  });

  it('zählt je Container getrennt', () => {
    const { takt } = taktMitUhr();

    expect(takt.darfSenden('c-1', 2)).toBe(true);
    // Der zweite Container wartet nicht auf den ersten.
    expect(takt.darfSenden('c-2', 2)).toBe(true);
  });

  it('bleibt bis zehn Containern beim Sekundentakt', () => {
    const { takt } = taktMitUhr();

    expect(takt.abstandMs(1)).toBe(1_000);
    expect(takt.abstandMs(10)).toBe(1_000);
  });

  it('streckt den Abstand, je mehr Container laufen', () => {
    const { takt } = taktMitUhr();

    expect(takt.abstandMs(20)).toBe(2_000);
    expect(takt.abstandMs(35)).toBe(3_500);
  });

  it('geht nie über die Obergrenze hinaus', () => {
    const { takt } = taktMitUhr();

    expect(takt.abstandMs(50)).toBe(5_000);
    expect(takt.abstandMs(500)).toBe(5_000);
  });

  it('nimmt eigene Grenzen an', () => {
    const { takt } = taktMitUhr({ minIntervalMs: 250, maxIntervalMs: 1_000 });

    expect(takt.abstandMs(1)).toBe(250);
    expect(takt.abstandMs(100)).toBe(1_000);
  });

  it('hält eine Obergrenze unter der Untergrenze aus', () => {
    // Falsch gesetzte Umgebungsvariablen dürfen nicht zu einem Abstand von
    // null führen, sonst liefe die Drossel leer.
    const { takt } = taktMitUhr({ minIntervalMs: 2_000, maxIntervalMs: 500 });

    expect(takt.abstandMs(1)).toBe(2_000);
  });

  it('vergisst einen Container und lässt ihn danach sofort wieder durch', () => {
    const { takt } = taktMitUhr();

    expect(takt.darfSenden('c-1', 1)).toBe(true);
    expect(takt.darfSenden('c-1', 1)).toBe(false);

    takt.vergiss('c-1');

    // Neu gestartet heißt neu gemessen: Der erste Wert soll sofort kommen.
    expect(takt.darfSenden('c-1', 1)).toBe(true);
  });
});
