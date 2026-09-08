import { describe, expect, it } from 'vitest';
import { type InstanceSettingsDto } from './instance.js';

describe('Instanz-Einstellungen (Mockup-Abgleich 12.1.1)', () => {
  it('bleibt ohne die Schrift-Felder gültig (additive Erweiterung)', () => {
    // Der Nachweis aus CLAUDE.md §3: Ein Datensatz, wie ihn ein Konsument vor
    // der Schrift-Erweiterung erzeugt hat, muss weiterhin dem DTO genügen.
    // Fehlte hier eines der neuen Felder als Pflichtfeld, bräche schon der
    // Typecheck – der Test ist damit auch ein Build-Test.
    const alt: InstanceSettingsDto = {
      selfRegistrationEnabled: true,
      updatedAt: null,
      permissions: { canEdit: true },
    };

    expect(alt.uiFontId).toBeUndefined();
    expect(alt.monospaceFontId).toBeUndefined();
    expect(Object.keys(alt)).toEqual(['selfRegistrationEnabled', 'updatedAt', 'permissions']);
  });

  it('nimmt beide Schriften getrennt auf – Kennung oder Vorgabe', () => {
    const gewaehlt: InstanceSettingsDto = {
      selfRegistrationEnabled: false,
      // Oberfläche eigene Schrift, dicktengleiche Ausgaben bewusst auf der
      // Vorgabe: Genau dafür sind es zwei Felder und nicht eines.
      uiFontId: '0f2f3f4f-0000-4000-8000-000000000003',
      monospaceFontId: null,
      updatedAt: '2026-09-06T10:00:00.000Z',
      permissions: { canEdit: true },
    };

    expect(gewaehlt.uiFontId).not.toBeNull();
    expect(gewaehlt.monospaceFontId).toBeNull();
  });
});
