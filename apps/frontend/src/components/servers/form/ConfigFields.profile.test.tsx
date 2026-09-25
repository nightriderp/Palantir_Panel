import { type GameConfigField, type GamePreset } from '@palantir/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigFields } from './ConfigFields';

/**
 * Profile (Betreiber-Wunsch 25.09.2026): Wer ein Profil wählt, bekommt dessen
 * Werte in den Entwurf; die Beschreibung steht darunter, auch in der
 * kompakten Steuerung.
 */
function feld(teil: Partial<GameConfigField> & Pick<GameConfigField, 'key' | 'label' | 'type'>) {
  return {
    defaultValue: null,
    description: null,
    required: false,
    options: [],
    min: null,
    max: null,
    lockedAfterCreate: false,
    ...teil,
  } as GameConfigField;
}

const PROFIL = feld({
  key: 'preset',
  label: 'Profil',
  type: 'select',
  defaultValue: 'none',
  options: ['none', 'utility'],
  optionLabels: { none: 'Kein Profil', utility: 'Utility-Training' },
});
const MUNITION = feld({ key: 'infiniteAmmo', label: 'Unendlich Munition', type: 'toggle' });

const PROFILE: GamePreset[] = [
  { id: 'none', label: 'Kein Profil', description: 'Nichts vorgegeben.', values: {} },
  {
    id: 'utility',
    label: 'Utility-Training',
    description: 'Granaten üben.',
    values: { infiniteAmmo: true },
  },
];

function zeichne(values: Record<string, string | boolean>) {
  const onChange = vi.fn();
  render(
    <ConfigFields
      fields={[PROFIL, MUNITION]}
      values={values}
      onChange={onChange}
      lockAfterCreate={false}
      hideHints
      presets={PROFILE}
      presetField="preset"
    />,
  );

  return onChange;
}

describe('ConfigFields – Profile', () => {
  it('übernimmt beim Wählen die Werte des Profils, dann das Profil selbst', () => {
    const onChange = zeichne({ preset: 'none', infiniteAmmo: false });

    fireEvent.change(screen.getByRole('combobox', { name: 'Profil' }), {
      target: { value: 'utility' },
    });

    expect(onChange.mock.calls).toEqual([
      ['infiniteAmmo', true],
      ['preset', 'utility'],
    ]);
  });

  it('zeigt die Beschreibung – und dass seitdem etwas angepasst wurde', () => {
    zeichne({ preset: 'utility', infiniteAmmo: false });

    expect(screen.getByText('Granaten üben. Seitdem angepasst.')).toBeTruthy();
  });
});
