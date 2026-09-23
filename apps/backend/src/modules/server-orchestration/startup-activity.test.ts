import { describe, expect, it } from 'vitest';
import { StartupActivity } from './startup-activity.js';

/**
 * Konsolenaktivität während eines Starts (Betreiber-Wunsch 23.09.2026).
 */
describe('StartupActivity', () => {
  function aufbauen() {
    let jetzt = 1_000;
    const activity = new StartupActivity(() => jetzt);

    return {
      activity,
      stelle: (ms: number) => {
        jetzt = ms;
      },
    };
  }

  it('zählt eine passende Zeile als Fortschritt', () => {
    const { activity } = aufbauen();

    activity.zeile('s1', 'Update state (0x61) downloading, progress: 1.00', 'Update state');

    expect(activity.fortschrittAm('s1')).toBe(1_000);
  });

  it('lässt den Fortschritt stehen, wenn eine andere Zeile kommt', () => {
    const { activity, stelle } = aufbauen();

    activity.zeile('s1', 'Update state (0x61)', 'Update state');
    stelle(5_000);
    activity.zeile('s1', 'Loaded libtier0.so', 'Update state');

    expect(activity.fortschrittAm('s1')).toBe(1_000);
    expect(activity.letzteZeile('s1')).toBe('Loaded libtier0.so');
  });

  it('zählt ohne Muster jede Zeile', () => {
    const { activity } = aufbauen();

    activity.zeile('s1', 'irgendwas', undefined);

    expect(activity.fortschrittAm('s1')).toBe(1_000);
  });

  it('zählt nichts, wenn die Definition keinen Fortschritt kennt – merkt sich aber die Zeile', () => {
    const { activity } = aufbauen();

    activity.zeile('s1', 'FATAL ERROR: Unable to load module server', null);

    expect(activity.fortschrittAm('s1')).toBeNull();
    expect(activity.letzteZeile('s1')).toBe('FATAL ERROR: Unable to load module server');
  });

  it('zählt bei einem kaputten Muster nichts, statt zu werfen', () => {
    const { activity } = aufbauen();

    expect(() => activity.zeile('s1', 'text', '(')).not.toThrow();
    expect(activity.fortschrittAm('s1')).toBeNull();
  });

  it('kürzt eine lange Zeile für die Fehlermeldung', () => {
    const { activity } = aufbauen();

    activity.zeile('s1', 'x'.repeat(500), null);

    expect(activity.letzteZeile('s1')).toBe(`${'x'.repeat(200)} …`);
  });

  it('vergisst den Stand eines Servers, ohne andere anzufassen', () => {
    const { activity } = aufbauen();

    activity.zeile('s1', 'eins', undefined);
    activity.zeile('s2', 'zwei', undefined);
    activity.vergessen('s1');

    expect(activity.letzteZeile('s1')).toBeNull();
    expect(activity.letzteZeile('s2')).toBe('zwei');
  });
});
