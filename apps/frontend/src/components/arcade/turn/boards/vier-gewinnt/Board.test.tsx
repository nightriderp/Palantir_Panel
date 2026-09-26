import { TURN_GAMES } from '@palantir/arcade';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type TurnSeatInfo } from '../../types';
import { Board } from './Board';

const rules = TURN_GAMES['vier-gewinnt']!;
const seats: TurnSeatInfo[] = [
  { index: 0, name: 'Anna', kind: 'human', color: '#ef4444', isMe: true },
  { index: 1, name: 'Ben', kind: 'human', color: '#3b82f6', isMe: false },
];

describe('Vier-gewinnt-Brett', () => {
  it('Klick auf eine Spalte wirft den Stein', () => {
    const state = rules.setup({ players: 2, seed: 1, options: {} });
    const onMove = vi.fn();
    render(
      <Board
        view={rules.view(state, 0)}
        mySeat={0}
        seats={seats}
        activeSeats={[0]}
        canAct
        onMove={onMove}
        sfx={() => {}}
        finished={false}
      />,
    );
    fireEvent.click(screen.getByLabelText('Spalte 4'));
    expect(onMove).toHaveBeenCalledWith({ column: 3 });
  });
});
