import { TURN_GAMES } from '@palantir/arcade';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type TurnSeatInfo } from '../../types';
import { Board } from './Board';
import { type RisikoMove, type RisikoView } from './types';

/*
 * Rauchtest des Bretts gegen die echten Regeln: Die Sicht kommt aus
 * `game.view`, die Züge, die das Brett vorschlägt, müssen die Regeln annehmen.
 */

const game = TURN_GAMES.risiko;
if (!game) throw new Error('Risiko fehlt im Register.');

const seats: TurnSeatInfo[] = [0, 1, 2].map((index) => ({
  index,
  name: `Spieler ${index + 1}`,
  kind: 'human',
  color: ['#ef4444', '#3b82f6', '#22c55e'][index] ?? '#64748b',
  isMe: index === 0,
}));

function renderBoard(state: unknown, seat: number) {
  const onMove = vi.fn<(move: RisikoMove) => void>();
  const view = game!.view(state, seat) as RisikoView;
  const utils = render(
    <Board
      view={view}
      mySeat={seat}
      seats={seats.map((s) => ({ ...s, isMe: s.index === seat }))}
      activeSeats={[seat]}
      canAct
      onMove={onMove}
      sfx={() => {}}
      finished={false}
    />,
  );
  const polygons = utils.container.querySelectorAll('polygon');
  return { ...utils, onMove, view, polygons };
}

describe('Risiko-Brett', () => {
  it('setzt im Aufbau per Tippen eine Armee', () => {
    const state = game.setup({
      players: 3,
      seed: 3,
      options: { autoPlace: false, quick: false, roundLimit: 0 },
    });
    const seat = game.activeSeats(state)[0] as number;
    const { onMove, view, polygons } = renderBoard(state, seat);
    const own = view.owner.indexOf(seat);
    fireEvent.click(polygons[own] as Element);
    expect(onMove).toHaveBeenCalledWith({ type: 'place', t: own, n: 1 });
    expect(game.applyMove(state, seat, onMove.mock.calls[0]?.[0]).ok).toBe(true);
  });

  it('schlägt einen gültigen Angriff vor', () => {
    let state = game.setup({
      players: 3,
      seed: 5,
      options: { autoPlace: true, quick: false, roundLimit: 0 },
    });
    const seat = game.activeSeats(state)[0] as number;
    const v0 = game.view(state, seat) as RisikoView;
    // Alles auf ein Grenzland setzen, damit sicher angegriffen werden kann.
    const from = v0.owner.findIndex(
      (o, t) => o === seat && (v0.map.adjacency[t] ?? []).some((n) => v0.owner[n] !== seat),
    );
    const r = game.applyMove(state, seat, { type: 'place', t: from, n: v0.reinforcements });
    expect(r.ok).toBe(true);
    if (r.ok) state = r.state;
    const { onMove, view, polygons } = renderBoard(state, seat);
    expect(view.phase).toBe('attack');
    const to = (view.map.adjacency[from] ?? []).find((n) => view.owner[n] !== seat) as number;
    fireEvent.click(polygons[from] as Element);
    fireEvent.click(polygons[to] as Element);
    fireEvent.click(screen.getByRole('button', { name: 'Würfeln' }));
    const move = onMove.mock.calls[0]?.[0];
    expect(move).toMatchObject({ type: 'attack', from, to });
    expect(game.applyMove(state, seat, move).ok).toBe(true);
  });

  it('zeigt fremden Sitzen keine Aktionen', () => {
    const state = game.setup({
      players: 3,
      seed: 5,
      options: { autoPlace: true, quick: false, roundLimit: 0 },
    });
    const other = ((game.activeSeats(state)[0] as number) + 1) % 3;
    const { onMove, view, polygons } = renderBoard(state, other);
    fireEvent.click(polygons[view.owner.indexOf(other)] as Element);
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Setzen' })).toBeNull();
  });
});
