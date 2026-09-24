import { type GameConfigField, type GameConfigValues } from '@palantir/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfigFields, zahlAusLink } from './ConfigFields';

/**
 * CS2-Workshop-ID (Betreiber-Wunsch 25.09.2026): nur bei Karte „workshop“
 * sichtbar, und ein Link geht so gut wie die Zahl.
 */
const KARTE: GameConfigField = {
  key: 'map',
  label: 'Startkarte',
  type: 'select',
  defaultValue: 'de_dust2',
  description: null,
  required: false,
  options: ['de_dust2', 'workshop'],
  min: null,
  max: null,
  lockedAfterCreate: false,
};

const WORKSHOP: GameConfigField = {
  key: 'workshopMap',
  label: 'Workshop-ID',
  type: 'number',
  defaultValue: 0,
  description: null,
  required: false,
  options: [],
  min: 0,
  max: 999_999_999_999,
  lockedAfterCreate: false,
  visibleWhen: { field: 'map', values: ['workshop'] },
  numberFromLink: { param: 'id' },
};

function zeichne(values: GameConfigValues) {
  const onChange = vi.fn();
  render(
    <ConfigFields
      fields={[KARTE, WORKSHOP]}
      values={values}
      onChange={onChange}
      lockAfterCreate={false}
    />,
  );

  return onChange;
}

describe('zahlAusLink', () => {
  it('nimmt die Zahl selbst und die aus einem Workshop-Link', () => {
    expect(zahlAusLink('3070284539', 'id')).toBe(3070284539);
    expect(
      zahlAusLink('https://steamcommunity.com/sharedfiles/filedetails/?id=3070284539', 'id'),
    ).toBe(3070284539);
    expect(
      zahlAusLink('https://steamcommunity.com/sharedfiles/filedetails/?l=german&id=42', 'id'),
    ).toBe(42);
  });

  it('gibt ohne Zahl nichts zurück', () => {
    expect(zahlAusLink('https://steamcommunity.com/app/730', 'id')).toBeNull();
    expect(zahlAusLink('abc', 'id')).toBeNull();
  });
});

describe('ConfigFields – Workshop-ID', () => {
  it('zeigt das Feld nur bei Karte „workshop“', () => {
    zeichne({ map: 'de_dust2', workshopMap: 0 });

    expect(screen.queryByLabelText('Workshop-ID')).toBeNull();
  });

  it('übernimmt aus einem eingefügten Link die Zahl', () => {
    const onChange = zeichne({ map: 'workshop', workshopMap: 0 });

    fireEvent.change(screen.getByLabelText('Workshop-ID'), {
      target: { value: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3360435602' },
    });

    expect(onChange).toHaveBeenCalledWith('workshopMap', 3360435602);
  });

  it('sagt, wenn in der Eingabe keine Zahl steckt, und ändert nichts', () => {
    const onChange = zeichne({ map: 'workshop', workshopMap: 0 });

    fireEvent.change(screen.getByLabelText('Workshop-ID'), {
      target: { value: 'https://steamcommunity.com/app/730' },
    });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Kein Link mit „\?id=“/u)).toBeTruthy();
  });
});
