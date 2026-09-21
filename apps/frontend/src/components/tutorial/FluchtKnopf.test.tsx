import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FLUCHT_MAX } from './spott';
import { FluchtKnopf } from './FluchtKnopf';

/**
 * Der ausweichende „Überspringen"-Knopf.
 *
 * Der Scherz ist schnell erzählt; geprüft wird hier vor allem, dass er eine
 * Grenze hat. Ein Knopf, der unendlich flieht, ist keine Pointe mehr, sondern
 * eine Ansicht ohne Ausgang – und der Klick muss jederzeit zählen, auch beim
 * ersten Versuch.
 */

function knopf(): HTMLElement {
  return screen.getByRole('button');
}

describe('FluchtKnopf', () => {
  it('weicht beim Darüberfahren aus und ändert dabei seine Beschriftung', () => {
    render(<FluchtKnopf onTreffer={() => undefined} />);

    expect(knopf().textContent).toBe('Überspringen');

    fireEvent.mouseEnter(knopf());

    expect(knopf().textContent).toBe('Fast!');
  });

  it('gibt nach FLUCHT_MAX Versuchen auf und bleibt stehen', () => {
    const geflohen = vi.fn();
    render(<FluchtKnopf onTreffer={() => undefined} onFlucht={geflohen} />);

    for (let i = 0; i < FLUCHT_MAX + 3; i += 1) fireEvent.mouseEnter(knopf());

    expect(geflohen).toHaveBeenCalledTimes(FLUCHT_MAX);
    expect(geflohen).toHaveBeenLastCalledWith(FLUCHT_MAX);
    expect(knopf().textContent).toBe('Na gut. Du gewinnst.');
  });

  it('nimmt den Klick auch an, bevor er aufgegeben hat', () => {
    const getroffen = vi.fn();
    render(<FluchtKnopf onTreffer={getroffen} />);

    fireEvent.mouseEnter(knopf());
    fireEvent.click(knopf());

    expect(getroffen).toHaveBeenCalledTimes(1);
  });

  it('flieht nicht vor der Tastatur – ein Fokus verschiebt ihn nicht', () => {
    const geflohen = vi.fn();
    render(<FluchtKnopf onTreffer={() => undefined} onFlucht={geflohen} />);

    fireEvent.focus(knopf());

    expect(geflohen).not.toHaveBeenCalled();
    expect(knopf().textContent).toBe('Überspringen');
  });
});
