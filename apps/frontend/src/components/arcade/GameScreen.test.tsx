import { type ArcadeLeaderboardDto } from '@palantir/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { type ApiResult } from '@/lib/api/client';
import { GameScreen } from './GameScreen';

/**
 * Audit-Fundstelle frontend-lib-03 – jedes Rendern startete das Spiel neu.
 *
 * `handleGameOver` hing am Ergebnis von `useApiResource`, das bei jedem Rendern
 * eine neue Identität bekam. Über `onGameOver` → `loop` → `startLoop` → `reset`
 * landete das im Effekt von `GameHost`: Der „Vorbei"-Bildschirm verschwand nach
 * einem Frame, und eine Partie brach ab, sobald die Bestenliste nachlud.
 *
 * Der Test zählt deshalb die Aufrufe von `game.create()`: einmal je Spiel-Id,
 * nicht einmal je Rendern.
 */

const arcade = vi.hoisted(() => {
  const create = vi.fn<(id: string) => void>();
  const spiele = new Map<string, unknown>();

  /** Ein Spiel je Id – dieselbe Identität, damit `GameHost` nichts zurücksetzt. */
  function getArcadeGame(id: string): unknown {
    const vorhanden = spiele.get(id);
    if (vorhanden !== undefined) return vorhanden;

    const spiel = {
      id,
      instructions: `Anleitung ${id}`,
      touch: 'dpad',
      view: { width: 100, height: 100 },
      create: () => {
        create(id);
        return { punkte: 0 };
      },
      step: (state: unknown) => state,
      control: (state: unknown) => state,
      phase: () => 'ready',
      score: () => 0,
      render: () => {},
    };
    spiele.set(id, spiel);
    return spiel;
  }

  return { create, getArcadeGame };
});

vi.mock('./games/index', () => ({ getArcadeGame: arcade.getArcadeGame }));

const api = vi.hoisted(() => ({
  fetchArcadeLeaderboard: vi.fn(),
  submitArcadeScore: vi.fn(),
}));

vi.mock('@/lib/arcade/api', () => api);

const BESTENLISTE: ArcadeLeaderboardDto = {
  gameId: 'kriechpfad',
  entries: [],
  personal: null,
  permissions: { canSubmit: true },
};

const GELADEN: ApiResult<ArcadeLeaderboardDto> = {
  success: true,
  data: BESTENLISTE,
  error: null,
} as ApiResult<ArcadeLeaderboardDto>;

beforeAll(() => {
  // jsdom bringt kein Canvas mit; `GameHost` fragt beim Zeichnen danach.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({}) as unknown as CanvasRenderingContext2D,
  });
});

beforeEach(() => {
  arcade.create.mockClear();
  api.fetchArcadeLeaderboard.mockReset();
  api.submitArcadeScore.mockReset();
});

describe('GameScreen (frontend-lib-03)', () => {
  it('startet das Spiel nicht neu, wenn die Bestenliste nachlädt', async () => {
    let bestenlisteAusliefern: ((ergebnis: ApiResult<ArcadeLeaderboardDto>) => void) | null = null;
    api.fetchArcadeLeaderboard.mockImplementation(
      () =>
        new Promise<ApiResult<ArcadeLeaderboardDto>>((aufloesen) => {
          bestenlisteAusliefern = aufloesen;
        }),
    );

    render(
      <ToastProvider>
        <GameScreen gameId="kriechpfad" onBack={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(arcade.create).toHaveBeenCalledTimes(1);
    });

    // Die Bestenliste kommt erst jetzt an – mitten in der laufenden Partie.
    await act(async () => {
      bestenlisteAusliefern?.(GELADEN);
      await Promise.resolve();
    });

    // Die Bestenliste ist da (leerer Zustand statt Ladeanzeige) …
    await waitFor(() => {
      expect(screen.getByText('Noch keine Ergebnisse')).toBeTruthy();
    });

    // … und die Partie läuft unverändert weiter.
    expect(arcade.create).toHaveBeenCalledTimes(1);
  });

  it('legt bei erneutem Rendern mit derselben Id keine neue Partie an', async () => {
    api.fetchArcadeLeaderboard.mockResolvedValue(GELADEN);

    const baum = (
      <ToastProvider>
        <GameScreen gameId="kriechpfad" onBack={() => {}} />
      </ToastProvider>
    );
    const { rerender } = render(baum);

    await waitFor(() => {
      expect(arcade.create).toHaveBeenCalledTimes(1);
    });

    rerender(baum);
    rerender(baum);

    expect(arcade.create).toHaveBeenCalledTimes(1);
  });

  it('startet dagegen sehr wohl neu, wenn ein anderes Spiel gewählt wird', async () => {
    api.fetchArcadeLeaderboard.mockResolvedValue(GELADEN);

    const { rerender } = render(
      <ToastProvider>
        <GameScreen gameId="kriechpfad" onBack={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(arcade.create).toHaveBeenCalledTimes(1);
    });

    rerender(
      <ToastProvider>
        <GameScreen gameId="ballwechsel" onBack={() => {}} />
      </ToastProvider>,
    );

    await waitFor(() => {
      expect(arcade.create).toHaveBeenCalledTimes(2);
    });
    expect(arcade.create).toHaveBeenLastCalledWith('ballwechsel');
  });
});
