import { TURN_GAMES } from '@palantir/arcade';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type TurnSeatInfo } from '../../types';
import { Board } from './Board';

const rules = TURN_GAMES.dame!;
const seats: TurnSeatInfo[] = [
  { index: 0, name: 'Anna', kind: 'human', color: '#ef4444', isMe: true },
  { index: 1, name: 'Ben', kind: 'human', color: '#3b82f6', isMe: false },
];

function sq(name: string): number {
  return (Number(name[1]) - 1) * 8 + 'abcdefgh'.indexOf(name[0]!);
}

function setup(board: string) {
  const state = { ...rules.setup({ players: 2, seed: 1, options: {} }), board };
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
  return onMove;
}

function boardWith(pieces: Record<string, string>): string {
  const cells = Array.from({ length: 64 }, () => '.');
  for (const [name, ch] of Object.entries(pieces)) cells[sq(name)] = ch;
  return cells.join('');
}

describe('Damebrett', () => {
  it('Mehrfachsprung Feld für Feld', () => {
    const onMove = setup(boardWith({ a1: 'w', b2: 'b', d4: 'b', h8: 'b' }));
    fireEvent.click(screen.getByLabelText('a1'));
    fireEvent.click(screen.getByLabelText('c3'));
    expect(onMove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('e5'));
    expect(onMove).toHaveBeenCalledWith({ path: [sq('a1'), sq('c3'), sq('e5')] });
  });

  it('eindeutiges Endfeld direkt antippen', () => {
    const onMove = setup(boardWith({ a1: 'w', b2: 'b', d4: 'b', h8: 'b' }));
    fireEvent.click(screen.getByLabelText('a1'));
    fireEvent.click(screen.getByLabelText('e5'));
    expect(onMove).toHaveBeenCalledWith({ path: [sq('a1'), sq('c3'), sq('e5')] });
  });
});
