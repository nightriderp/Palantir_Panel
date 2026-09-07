import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDtoRevision, useDtoRevisions } from './useDtoRevision';

/**
 * Fundpunkt event-flow-04 – wie alt sind die REST-Daten einer Ansicht?
 *
 * Zwei Zusagen werden hier festgehalten:
 *
 * 1. Der **erste** Stand zählt als „so alt wie der Seitenaufbau" (Revision 0),
 *    damit ein Live-Ereignis, das während des Ladens eintraf, weiter gewinnt.
 * 2. In einer Liste bekommt nur der **ausgetauschte** Eintrag eine neue Nummer.
 *    Sonst würde der Start eines Servers den Live-Status aller übrigen Karten
 *    verwerfen – `setData` baut ja jedes Mal ein neues Array.
 */

function Einzeln({ dto }: { dto: object | null }) {
  return <span data-testid="revision">{useDtoRevision(dto)}</span>;
}

function Liste({ items }: { items: readonly { id: string }[] }) {
  const revisionen = useDtoRevisions(items);

  return (
    <span data-testid="revisionen">
      {items.map((item) => `${item.id}=${revisionen[item.id]}`).join(' ')}
    </span>
  );
}

describe('useDtoRevision (event-flow-04)', () => {
  it('gibt dem ersten Stand die 0 – beim Erstladen gewinnt der Live-Kanal', () => {
    render(<Einzeln dto={{ status: 'stopped' }} />);

    expect(screen.getByTestId('revision').textContent).toBe('0');
  });

  it('bleibt bei derselben Nummer, solange dasselbe Objekt gezeigt wird', () => {
    const dto = { status: 'stopped' };
    const { rerender } = render(<Einzeln dto={dto} />);

    act(() => {
      rerender(<Einzeln dto={dto} />);
    });

    expect(screen.getByTestId('revision').textContent).toBe('0');
  });

  it('vergibt für jeden weiteren Stand eine höhere Nummer', () => {
    const { rerender } = render(<Einzeln dto={{ status: 'stopped' }} />);

    act(() => {
      rerender(<Einzeln dto={{ status: 'starting' }} />);
    });
    const zweite = Number(screen.getByTestId('revision').textContent);

    act(() => {
      rerender(<Einzeln dto={{ status: 'running' }} />);
    });
    const dritte = Number(screen.getByTestId('revision').textContent);

    expect(zweite).toBeGreaterThan(0);
    expect(dritte).toBeGreaterThan(zweite);
  });
});

describe('useDtoRevisions (event-flow-04)', () => {
  it('nummeriert nur den ausgetauschten Eintrag neu', () => {
    const a = { id: 'srv-a' };
    const b = { id: 'srv-b' };
    const { rerender } = render(<Liste items={[a, b]} />);

    expect(screen.getByTestId('revisionen').textContent).toBe('srv-a=0 srv-b=0');

    // Genau das, was `setData` nach einer Lifecycle-Aktion erzeugt: neues
    // Array, neuer Eintrag für A, unverändertes Objekt für B.
    act(() => {
      rerender(<Liste items={[{ id: 'srv-a' }, b]} />);
    });

    const [neuA, neuB] = screen
      .getByTestId('revisionen')
      .textContent!.split(' ')
      .map((eintrag) => Number(eintrag.split('=')[1]));

    expect(neuA).toBeGreaterThan(0);
    expect(neuB).toBe(0);
  });

  it('gibt einem später hinzukommenden Server ebenfalls die 0', () => {
    const a = { id: 'srv-a' };
    const { rerender } = render(<Liste items={[a] as const} />);

    act(() => {
      rerender(<Liste items={[a, { id: 'srv-neu' }]} />);
    });

    expect(screen.getByTestId('revisionen').textContent).toBe('srv-a=0 srv-neu=0');
  });
});
