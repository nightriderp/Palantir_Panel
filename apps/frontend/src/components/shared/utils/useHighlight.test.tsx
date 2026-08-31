import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHighlight } from './useHighlight';

/** Zwei Zeilen, beide mit Ref und Klasse – wie in den Listenansichten. */
function Liste() {
  const highlight = useHighlight();

  return (
    <ul>
      {['a', 'b'].map((id) => (
        <li key={id} ref={highlight.ref(id)} data-testid={id} className={highlight.className(id)}>
          {highlight.matches(id) ? 'gemeint' : 'gewöhnlich'}
        </li>
      ))}
    </ul>
  );
}

function mitAdresse(suche: string): void {
  window.history.replaceState(null, '', `/liste${suche}`);
}

// jsdom kennt `scrollIntoView` nicht – im Browser gibt es die Methode immer.
const scroll = vi.fn();

beforeEach(() => {
  scroll.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: scroll,
  });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('useHighlight', () => {
  it('erkennt den Eintrag aus der Adresszeile', () => {
    mitAdresse('?highlight=b');
    render(<Liste />);

    expect(screen.getByTestId('b').textContent).toBe('gemeint');
    expect(screen.getByTestId('a').textContent).toBe('gewöhnlich');
    expect(screen.getByTestId('b').className).toContain('ring-brand');
    expect(screen.getByTestId('a').className).toBe('');
  });

  it('hebt ohne Parameter nichts hervor', () => {
    mitAdresse('');
    render(<Liste />);

    expect(screen.getByTestId('a').textContent).toBe('gewöhnlich');
    expect(screen.getByTestId('b').textContent).toBe('gewöhnlich');
    expect(scroll).not.toHaveBeenCalled();
  });

  it('scrollt genau den gemeinten Eintrag in den Blick', () => {
    mitAdresse('?highlight=b');
    render(<Liste />);

    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0]).toBe(screen.getByTestId('b'));
  });
});
