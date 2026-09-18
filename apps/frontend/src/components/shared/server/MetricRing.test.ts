import { describe, expect, it } from 'vitest';
import { zahlUndEinheit } from './MetricRing';

/*
 * Der Ring setzt Zahl und Einheit übereinander, weil „6,11 GB" in einer Zeile
 * über den Bogen lief (Betreiber-Meldung 2026-09-19). Geprüft wird die
 * Trennung, nicht die Darstellung.
 */
describe('zahlUndEinheit', () => {
  it('trennt am letzten Leerzeichen', () => {
    expect(zahlUndEinheit('6,1 GB')).toEqual({ zahl: '6,1', einheit: 'GB' });
    expect(zahlUndEinheit('42 %')).toEqual({ zahl: '42', einheit: '%' });
    expect(zahlUndEinheit('128 ms')).toEqual({ zahl: '128', einheit: 'ms' });
  });

  it('lässt Werte ohne Einheit unangetastet', () => {
    expect(zahlUndEinheit('—')).toEqual({ zahl: '—', einheit: null });
    expect(zahlUndEinheit('42')).toEqual({ zahl: '42', einheit: null });
  });
});
