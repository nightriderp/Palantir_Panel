import { type GameConfigField, type GameTypeDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { gameType, server } from '../testFixtures';
import { LiveControlsCard } from './LiveControlsCard';

/**
 * Live-Steuerung (Betreiber-Wunsch 23.09.2026): Karte, Modus, Bots eines
 * laufenden Servers ändern, ohne Neustart.
 */
const api = vi.hoisted(() => ({
  fetchGameTypes: vi.fn(),
  applyLiveValues: vi.fn(),
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGameTypes: api.fetchGameTypes,
  applyLiveValues: api.applyLiveValues,
}));

function feld(overrides: Partial<GameConfigField> & Pick<GameConfigField, 'key' | 'label'>) {
  return {
    type: 'select',
    defaultValue: '',
    description: 'Beschreibung, die in der Live-Steuerung fehlt.',
    required: false,
    options: [],
    min: null,
    max: null,
    lockedAfterCreate: false,
    ...overrides,
  } as GameConfigField;
}

const MIT_LIVE: GameTypeDto = gameType({
  configFields: [
    feld({
      key: 'map',
      label: 'Startkarte',
      defaultValue: 'de_dust2',
      options: ['de_dust2', 'de_mirage'],
    }),
    feld({ key: 'bots', label: 'Bots', type: 'number', defaultValue: 0, min: 0, max: 10 }),
  ],
  liveControls: [
    {
      id: 'karte',
      label: 'Karte & Modus',
      fields: ['map'],
      commands: ['changelevel {map}'],
      reloadsMap: true,
    },
    { id: 'bots', label: 'Bots', fields: ['bots'], commands: ['bot_quota {bots}'] },
  ],
});

function zeichne(
  status: 'running' | 'stopped',
  liveValues: Record<string, string | number> | null = null,
) {
  const onChanged = vi.fn();
  const dto = { ...server({ id: 's1', status }), liveValues };

  render(
    <ToastProvider>
      <LiveControlsCard server={dto} onChanged={onChanged} />
    </ToastProvider>,
  );

  return { onChanged };
}

beforeEach(() => {
  api.fetchGameTypes.mockReset();
  api.applyLiveValues.mockReset();
  api.fetchGameTypes.mockResolvedValue({ success: true, data: [MIT_LIVE], error: null });
  api.applyLiveValues.mockImplementation((_id: string, werte: Record<string, unknown>) =>
    Promise.resolve({
      success: true,
      data: { ...server({ id: 's1', status: 'running' }), config: werte },
      error: null,
    }),
  );
});

describe('LiveControlsCard', () => {
  it('zeigt nichts bei einem Spiel ohne Live-Steuerung', async () => {
    api.fetchGameTypes.mockResolvedValue({ success: true, data: [gameType()], error: null });
    zeichne('running');

    await waitFor(() => {
      expect(api.fetchGameTypes).toHaveBeenCalled();
    });
    expect(screen.queryByText('Live-Steuerung')).toBeNull();
  });

  it('zeigt die Steuerungen ohne die Beschreibungen der Einstellungen', async () => {
    zeichne('running');

    expect(await screen.findByText('Live-Steuerung')).toBeTruthy();
    expect(screen.getByText('Karte & Modus')).toBeTruthy();
    expect(screen.queryByText('Beschreibung, die in der Live-Steuerung fehlt.')).toBeNull();
  });

  it('ist gesperrt, solange der Server nicht läuft, und sagt warum', async () => {
    zeichne('stopped');

    expect(await screen.findByText(/Geht nur, solange der Server läuft/u)).toBeTruthy();
    expect(screen.getByText(/Was hier geändert wird, bleibt/u)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Übernehmen' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('schickt nur, was sich geändert hat, und reicht den neuen Stand weiter', async () => {
    const { onChanged } = zeichne('running');

    // Abschnitt und Feld heißen beide „Bots“ – gemeint ist das Eingabefeld.
    const bots = (await screen.findByRole('spinbutton', { name: 'Bots' })) as HTMLInputElement;
    fireEvent.change(bots, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => {
      expect(api.applyLiveValues).toHaveBeenCalledWith('s1', { bots: 4 });
    });
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ config: { bots: 4 } }));
  });

  it('warnt, wenn die Karte neu geladen wird', async () => {
    zeichne('running');

    const karte = (await screen.findByLabelText('Startkarte')) as HTMLSelectElement;
    fireEvent.change(karte, { target: { value: 'de_mirage' } });

    expect(screen.getByText(/Karte wird neu geladen/u)).toBeTruthy();
  });

  it('zeigt live Geändertes statt des Startwerts', async () => {
    zeichne('running', { map: 'de_mirage' });

    const karte = (await screen.findByLabelText('Startkarte')) as HTMLSelectElement;
    expect(karte.value).toBe('de_mirage');
  });
});
