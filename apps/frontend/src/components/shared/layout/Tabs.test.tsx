import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Tabs } from './Tabs';

/**
 * Tastaturbedienung der Reiterleiste nach dem WAI-ARIA-Muster (Review
 * 2026-09-16, Befund 12.6): ein Tabulator-Halt, Pfeile wechseln, Pos1/Ende
 * springen, gesperrte Reiter werden übersprungen.
 */

const REITER = [
  { key: 'uebersicht', label: 'Übersicht' },
  { key: 'konsole', label: 'Konsole' },
  { key: 'dateien', label: 'Dateien', locked: true, lockedReason: 'Nicht freigegeben.' },
  { key: 'einstellungen', label: 'Einstellungen' },
] as const;

type Key = (typeof REITER)[number]['key'];

function Leiste({
  onChange,
  start = 'uebersicht',
}: {
  onChange?: (key: Key) => void;
  start?: Key;
}) {
  const [aktiv, setAktiv] = useState<Key>(start);
  return (
    <Tabs
      items={REITER}
      activeKey={aktiv}
      onChange={(key) => {
        setAktiv(key);
        onChange?.(key);
      }}
    />
  );
}

function reiter(name: string): HTMLElement {
  return screen.getByRole('tab', { name });
}

describe('Tabs – Tastatur (Befund 12.6)', () => {
  it('nur der aktive Reiter liegt in der Tab-Reihenfolge', () => {
    render(<Leiste />);

    expect(reiter('Übersicht').tabIndex).toBe(0);
    expect(reiter('Konsole').tabIndex).toBe(-1);
    expect(reiter('Einstellungen').tabIndex).toBe(-1);
  });

  it('Pfeil rechts wählt den nächsten Reiter und setzt den Fokus dorthin', () => {
    const gewechselt = vi.fn();
    render(<Leiste onChange={gewechselt} />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });

    expect(gewechselt).toHaveBeenCalledWith('konsole');
    expect(reiter('Konsole').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(reiter('Konsole'));
  });

  it('überspringt gesperrte Reiter', () => {
    const gewechselt = vi.fn();
    render(<Leiste onChange={gewechselt} start="konsole" />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });

    // „Dateien" ist gesperrt – es geht direkt weiter zu „Einstellungen".
    expect(gewechselt).toHaveBeenCalledWith('einstellungen');
  });

  it('läuft am Ende wieder von vorn los und rückwärts ans Ende', () => {
    const gewechselt = vi.fn();
    render(<Leiste onChange={gewechselt} start="einstellungen" />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(gewechselt).toHaveBeenLastCalledWith('uebersicht');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(gewechselt).toHaveBeenLastCalledWith('einstellungen');
  });

  it('Pos1 und Ende springen an den Rand', () => {
    const gewechselt = vi.fn();
    render(<Leiste onChange={gewechselt} start="konsole" />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(gewechselt).toHaveBeenLastCalledWith('einstellungen');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Home' });
    expect(gewechselt).toHaveBeenLastCalledWith('uebersicht');
  });

  it('lässt andere Tasten in Ruhe', () => {
    const gewechselt = vi.fn();
    render(<Leiste onChange={gewechselt} />);

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowDown' });

    expect(gewechselt).not.toHaveBeenCalled();
  });

  it('gesperrte Reiter bleiben sichtbar, aber nicht anwählbar', () => {
    render(<Leiste />);

    const gesperrt = reiter('Dateien');
    expect((gesperrt as HTMLButtonElement).disabled).toBe(true);
    expect(gesperrt.title).toBe('Nicht freigegeben.');
  });
});
