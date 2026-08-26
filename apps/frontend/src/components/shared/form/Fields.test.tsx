import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  FieldShell,
  NumberField,
  SelectField,
  SliderField,
  TextField,
  Toggle,
  ToggleRow,
} from './Fields';

/**
 * Komponententests der Formular-Bausteine.
 *
 * Geprüft wird das, worauf sich F1 und F3–F11 verlassen: die Beschriftung
 * gehört zum Feld, der gemeldete Wert hat den richtigen Typ, ein Fehler ersetzt
 * den Hinweis und wird für Screenreader angekündigt, gesperrte Bedienelemente
 * melden nichts nach oben.
 */

describe('FieldShell', () => {
  it('zeigt den Hinweis unter dem Feld', () => {
    render(
      <FieldShell label="Name" hint="Wird in der Übersicht angezeigt.">
        <input />
      </FieldShell>,
    );

    expect(screen.getByText('Wird in der Übersicht angezeigt.')).toBeDefined();
  });

  it('ersetzt den Hinweis durch die Fehlermeldung und meldet sie an', () => {
    render(
      <FieldShell label="Name" hint="Wird in der Übersicht angezeigt." error="Bitte ausfüllen.">
        <input />
      </FieldShell>,
    );

    expect(screen.queryByText('Wird in der Übersicht angezeigt.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Bitte ausfüllen.');
  });

  it('zeigt den Zusatz neben der Beschriftung', () => {
    render(
      <FieldShell label="Arbeitsspeicher" labelAside="4 GB">
        <input />
      </FieldShell>,
    );

    expect(screen.getByText('4 GB')).toBeDefined();
  });
});

describe('TextField', () => {
  it('verbindet Beschriftung und Eingabefeld', () => {
    render(<TextField label="Benutzername" value="alex" onChange={() => {}} />);

    const input = screen.getByLabelText('Benutzername') as HTMLInputElement;
    expect(input.value).toBe('alex');
  });

  it('meldet den neuen Text, nicht das Ereignis', () => {
    const onChange = vi.fn();
    render(<TextField label="Benutzername" value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Benutzername'), { target: { value: 'alex' } });

    expect(onChange).toHaveBeenCalledWith('alex');
  });

  it('kennzeichnet den Fehler und verweist auf ihn', () => {
    render(<TextField label="Benutzername" value="" onChange={() => {}} error="Schon vergeben." />);

    const input = screen.getByLabelText('Benutzername');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('reicht zusätzliche Eingabe-Attribute durch', () => {
    render(
      <TextField
        label="Code"
        value=""
        onChange={() => {}}
        autoComplete="one-time-code"
        inputProps={{ inputMode: 'numeric', maxLength: 32 }}
      />,
    );

    const input = screen.getByLabelText('Code');
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.getAttribute('maxlength')).toBe('32');
  });

  it('zeigt den Zusatz rechts im Feld', () => {
    render(
      <TextField label="Subdomain" value="insel" onChange={() => {}} suffix=".palantir.example" />,
    );

    expect(screen.getByText('.palantir.example')).toBeDefined();
  });
});

describe('NumberField', () => {
  it('meldet eine Zahl statt eines Textes', () => {
    const onChange = vi.fn();
    render(<NumberField label="Steckplätze" value={10} onChange={onChange} min={1} max={64} />);

    fireEvent.change(screen.getByLabelText('Steckplätze'), { target: { value: '20' } });

    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('übernimmt die Grenzen aus den Props', () => {
    render(<NumberField label="Steckplätze" value={10} onChange={() => {}} min={1} max={64} />);

    const input = screen.getByLabelText('Steckplätze');
    expect(input.getAttribute('min')).toBe('1');
    expect(input.getAttribute('max')).toBe('64');
  });
});

describe('SelectField', () => {
  const OPTIONS = [
    { value: 'node-1', label: 'Node 1' },
    { value: 'node-2', label: 'Node 2', disabled: true },
  ];

  it('stellt dem Platzhalter einen leeren Eintrag voran', () => {
    render(
      <SelectField
        label="Node"
        value=""
        onChange={() => {}}
        options={OPTIONS}
        placeholder="Node wählen …"
      />,
    );

    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((option) => option.value)).toEqual(['', 'node-1', 'node-2']);
    expect(options[2]?.disabled).toBe(true);
  });

  it('meldet den gewählten Wert', () => {
    const onChange = vi.fn();
    render(<SelectField label="Node" value="node-1" onChange={onChange} options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText('Node'), { target: { value: 'node-2' } });

    expect(onChange).toHaveBeenCalledWith('node-2');
  });
});

describe('SliderField', () => {
  it('legt Bereich und Schrittweite fest und meldet eine Zahl', () => {
    const onChange = vi.fn();
    render(
      <SliderField
        label="Arbeitsspeicher"
        labelAside="2 GB"
        value={2048}
        onChange={onChange}
        min={512}
        max={8192}
        step={256}
      />,
    );

    const slider = screen.getByLabelText('Arbeitsspeicher');
    expect(slider.getAttribute('type')).toBe('range');
    expect(slider.getAttribute('step')).toBe('256');

    fireEvent.change(slider, { target: { value: '4096' } });
    expect(onChange).toHaveBeenCalledWith(4096);
  });
});

describe('Toggle', () => {
  it('ist ein Schalter mit vorlesbarem Zustand', () => {
    render(<Toggle label="Automatisch stoppen" checked onChange={() => {}} />);

    const toggle = screen.getByRole('switch', { name: 'Automatisch stoppen' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('meldet beim Antippen den umgekehrten Zustand', () => {
    const onChange = vi.fn();
    render(<Toggle label="Automatisch stoppen" checked={false} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('meldet nichts, solange er gesperrt ist', () => {
    const onChange = vi.fn();
    render(<Toggle label="Automatisch stoppen" checked={false} onChange={onChange} disabled />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ToggleRow', () => {
  it('zeigt Titel und Erläuterung neben dem Schalter', () => {
    render(
      <ToggleRow
        title="Automatische Backups"
        description="Läuft täglich um 04:00 Uhr."
        checked={false}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText('Läuft täglich um 04:00 Uhr.')).toBeDefined();
    expect(screen.getByRole('switch', { name: 'Automatische Backups' })).toBeDefined();
  });

  it('schaltet über den Schalter um', () => {
    const onChange = vi.fn();
    render(<ToggleRow title="Automatische Backups" checked onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch'));

    expect(onChange).toHaveBeenCalledWith(false);
  });
});
