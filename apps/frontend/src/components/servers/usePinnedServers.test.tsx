import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { server as serverFixture } from './testFixtures';
import { usePinnedServers } from './usePinnedServers';

const anheften = vi.fn();
const loesen = vi.fn();

vi.mock('@/lib/api/servers', () => ({
  pinServer: (...args: unknown[]) => anheften(...args) as unknown,
  unpinServer: (...args: unknown[]) => loesen(...args) as unknown,
}));

const SERVER = serverFixture({ id: 'srv-1' });

function Uebersicht({ pinned }: { pinned: boolean }) {
  const server = { ...SERVER, pinned };
  const { pinnedIds, isPinned, togglePin } = usePinnedServers([server]);

  return (
    <div>
      <span data-testid="liste">{pinnedIds.join(',')}</span>
      <span data-testid="status">{isPinned(server.id) ? 'angeheftet' : 'frei'}</span>
      <button type="button" onClick={() => void togglePin(server)}>
        umschalten
      </button>
    </div>
  );
}

beforeEach(() => {
  anheften.mockReset();
  loesen.mockReset();
});

describe('usePinnedServers (Gefundener Punkt 50)', () => {
  it('liest die Anheftung aus dem DTO statt aus dem Browser', () => {
    render(<Uebersicht pinned />);

    expect(screen.getByTestId('status').textContent).toBe('angeheftet');
    expect(screen.getByTestId('liste').textContent).toBe('srv-1');
  });

  it('heftet einen freien Server an', async () => {
    anheften.mockResolvedValue({ success: true, data: { ...SERVER, pinned: true } });

    render(<Uebersicht pinned={false} />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(anheften).toHaveBeenCalledWith('srv-1');
    });
    expect(loesen).not.toHaveBeenCalled();
  });

  it('löst einen angehefteten Server', async () => {
    loesen.mockResolvedValue({ success: true, data: { ...SERVER, pinned: false } });

    render(<Uebersicht pinned />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(loesen).toHaveBeenCalledWith('srv-1');
    });
    expect(anheften).not.toHaveBeenCalled();
  });
});
