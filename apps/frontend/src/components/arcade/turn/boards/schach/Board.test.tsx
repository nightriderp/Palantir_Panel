import { TURN_GAMES } from '@palantir/arcade';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type TurnSeatInfo } from '../../types';
import { Board } from './Board';

const rules = TURN_GAMES.schach!;
const seats: TurnSeatInfo[] = [
  { index: 0, name: 'Anna', kind: 'human', color: '#ef4444', isMe: true },
  { index: 1, name: 'Ben', kind: 'human', color: '#3b82f6', isMe: false },
];

function setup(state: unknown, mySeat: number) {
  const onMove = vi.fn();
  render(
    <Board
      view={rules.view(state, mySeat)}
      mySeat={mySeat}
      seats={seats}
      activeSeats={rules.activeSeats(state)}
      canAct
      onMove={onMove}
      sfx={() => {}}
      finished={false}
    />,
  );
  return onMove;
}

describe('Schachbrett', () => {
  it('Figur antippen, dann Zielfeld – meldet den Zug', () => {
    const state = rules.setup({ players: 2, seed: 1, options: {} });
    const onMove = setup(state, 0);
    fireEvent.click(screen.getByLabelText('e2'));
    fireEvent.click(screen.getByLabelText('e4 leer'));
    expect(onMove).toHaveBeenCalledWith({ type: 'zug', from: 12, to: 28 });
  });

  it('Umwandlung fragt nach der Figur', () => {
    let state = rules.setup({ players: 2, seed: 1, options: {} });
    // Weißer Bauer läuft über b6 nach c7 und schlägt dann auf b8.
    for (const [from, to] of [
      [9, 25],
      [54, 46],
      [25, 33],
      [46, 38],
      [33, 41],
      [38, 30],
      [41, 50],
      [30, 22],
    ] as const) {
      const r = rules.applyMove(state, rules.activeSeats(state)[0]!, { type: 'zug', from, to });
      if (!r.ok) throw new Error(r.error);
      state = r.state;
    }
    const onMove = setup(state, 0);
    fireEvent.click(screen.getByLabelText('c7'));
    fireEvent.click(screen.getByLabelText('b8'));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Springer'));
    expect(onMove).toHaveBeenCalledWith({ type: 'zug', from: 50, to: 57, promotion: 'n' });
  });

  it('Schwarz sieht das Brett gedreht', () => {
    const state = rules.setup({ players: 2, seed: 1, options: {} });
    setup(state, 1);
    const cells = screen
      .getAllByRole('button')
      .filter((b) => /^[a-h][1-8]/.test(b.getAttribute('aria-label') ?? ''));
    expect(cells[0]?.getAttribute('aria-label')).toBe('h1');
  });
});
