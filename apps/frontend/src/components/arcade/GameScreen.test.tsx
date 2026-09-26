import { type ArcadeLeaderboardDto, type ArcadeSeedDto } from '@palantir/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { type ApiResult } from '@/lib/api/client';
import { GameScreen } from './GameScreen';

/**
 * Audit-Fundstelle frontend-lib-03 – eine nachladende Bestenliste darf keine
 * laufende Partie neu anlegen.
 *
 * Früher hing das Spielende-Callback am Ergebnis von `useApiResource`, das bei
 * jedem Rendern eine neue Identität bekam; eine Partie brach ab, sobald die
 * Bestenliste nachlud. Im Neubau hängt die Partie am Startwert vom Backend –
 * der Test zählt deshalb, wie oft die Logik eine Partie anlegt (`create`) und
 * wie oft ein Startwert geholt wird: einmal je Spiel, nicht einmal je Rendern.
 */

const spiele = vi.hoisted(() => {
  const create = vi.fn<(id: string) => void>();
  const cache = new Map<string, unknown>();

  /** Eine Zeichenschicht je Id – dieselbe Identität, damit der Wirt nichts neu anlegt. */
  function getRealtimeRenderer(id: string): unknown {
    const vorhanden = cache.get(id);
    if (vorhanden !== undefined) return vorhanden;
    const renderer = {
      id,
      logic: {
        kind: 'realtime',
        id,
        version: 1,
        create: () => {
          create(id);
          return { t: 0 };
        },
        step: (state: unknown) => state,
        isOver: () => false,
        score: () => 0,
        tickMs: () => 16,
      },
      view: { width: 100, height: 100 },
      touch: 'dpad',
      instructions: `Anleitung ${id}`,
      keyInput: () => null,
      render: () => undefined,
    };
    cache.set(id, renderer);
    return renderer;
  }
  return { create, getRealtimeRenderer };
});

vi.mock('./realtime/renderers', () => ({ getRealtimeRenderer: spiele.getRealtimeRenderer }));
// Die Bretter laden sonst alle Regeln – für Echtzeit-Spiele unnötig.
vi.mock('./turn/boards', () => ({ getTurnBoard: () => null }));

const api = vi.hoisted(() => ({
  fetchArcadeLeaderboard: vi.fn(),
  requestArcadeSeed: vi.fn(),
  submitArcadeRun: vi.fn(),
  listArcadeRooms: vi.fn(),
  createArcadeRoom: vi.fn(),
}));
vi.mock('@/lib/arcade/api', () => api);

const BESTENLISTE: ArcadeLeaderboardDto = {
  gameId: 'kriechpfad',
  metric: 'score',
  entries: [],
  personal: null,
  permissions: { canSubmit: true },
};

const GELADEN = {
  success: true,
  data: BESTENLISTE,
  error: null,
} as ApiResult<ArcadeLeaderboardDto>;

const SEED = {
  success: true,
  data: {
    seedId: '00000000-0000-4000-8000-000000000001',
    seed: 42,
    gameId: 'kriechpfad',
    gameVersion: 1,
    expiresAt: '2026-09-26T12:00:00.000Z',
  },
  error: null,
} as ApiResult<ArcadeSeedDto>;

function baum(gameId: 'kriechpfad' | 'ballwechsel') {
  return (
    <ToastProvider>
      <GameScreen gameId={gameId} onBack={() => {}} onOpenRoom={() => {}} />
    </ToastProvider>
  );
}

beforeAll(() => {
  // jsdom bringt kein Canvas mit; ohne Kontext zeichnet der Wirt einfach nicht.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => null,
  });
});

beforeEach(() => {
  spiele.create.mockClear();
  api.fetchArcadeLeaderboard.mockReset();
  api.requestArcadeSeed.mockReset();
  api.requestArcadeSeed.mockResolvedValue(SEED);
});

describe('GameScreen (frontend-lib-03)', () => {
  it('legt die Partie nicht neu an, wenn die Bestenliste nachlädt', async () => {
    let ausliefern: ((ergebnis: ApiResult<ArcadeLeaderboardDto>) => void) | null = null;
    api.fetchArcadeLeaderboard.mockImplementation(
      () =>
        new Promise<ApiResult<ArcadeLeaderboardDto>>((aufloesen) => {
          ausliefern = aufloesen;
        }),
    );

    render(baum('kriechpfad'));
    await waitFor(() => expect(spiele.create).toHaveBeenCalledTimes(1));

    await act(async () => {
      ausliefern?.(GELADEN);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText('Noch keine Ergebnisse')).toBeTruthy());

    expect(spiele.create).toHaveBeenCalledTimes(1);
    expect(api.requestArcadeSeed).toHaveBeenCalledTimes(1);
  });

  it('legt bei erneutem Rendern mit derselben Id keine neue Partie an', async () => {
    api.fetchArcadeLeaderboard.mockResolvedValue(GELADEN);
    const { rerender } = render(baum('kriechpfad'));
    await waitFor(() => expect(spiele.create).toHaveBeenCalledTimes(1));
    rerender(baum('kriechpfad'));
    rerender(baum('kriechpfad'));
    expect(spiele.create).toHaveBeenCalledTimes(1);
  });

  it('legt dagegen sehr wohl neu an, wenn ein anderes Spiel gewählt wird', async () => {
    api.fetchArcadeLeaderboard.mockResolvedValue(GELADEN);
    const { rerender } = render(baum('kriechpfad'));
    await waitFor(() => expect(spiele.create).toHaveBeenCalledTimes(1));
    rerender(baum('ballwechsel'));
    await waitFor(() => expect(spiele.create).toHaveBeenCalledTimes(2));
    expect(spiele.create).toHaveBeenLastCalledWith('ballwechsel');
  });

  it('zeigt die Anleitung der Zeichenschicht', async () => {
    api.fetchArcadeLeaderboard.mockResolvedValue(GELADEN);
    render(baum('kriechpfad'));
    expect(await screen.findByText('Anleitung kriechpfad')).toBeTruthy();
  });

  it('spielt ohne Startwert weiter – nur ohne Wertung', async () => {
    api.fetchArcadeLeaderboard.mockResolvedValue(GELADEN);
    api.requestArcadeSeed.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'Das Backend ist gerade nicht erreichbar.' },
    });
    render(baum('kriechpfad'));
    await waitFor(() => expect(spiele.create).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Ohne Wertung')).toBeTruthy();
  });
});
