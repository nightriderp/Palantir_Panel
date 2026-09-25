import { type GameConfigField, type GameTypeDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { gameType, server } from '../testFixtures';
import { LiveControlsCard } from './LiveControlsCard';

/**
 * Steuerung (Betreiber-Wunsch 23.09.2026): Karte, Modus, Bots ändern – bei
 * laufendem Server sofort, bei ausgeschaltetem für den nächsten Start.
 */
const api = vi.hoisted(() => ({
  fetchGameTypes: vi.fn(),
  applyLiveValues: vi.fn(),
  runLifecycleAction: vi.fn(),
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGameTypes: api.fetchGameTypes,
  applyLiveValues: api.applyLiveValues,
  runLifecycleAction: api.runLifecycleAction,
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
  status: 'running' | 'stopped' | 'starting',
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
  api.runLifecycleAction.mockReset();
  api.runLifecycleAction.mockResolvedValue({
    success: true,
    data: server({ id: 's1', status: 'running' }),
    error: null,
  });
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
    expect(screen.queryByText('Steuerung')).toBeNull();
  });

  it('zeigt die Steuerungen ohne die Beschreibungen der Einstellungen', async () => {
    zeichne('running');

    expect(await screen.findByText('Steuerung')).toBeTruthy();
    expect(screen.getByText('Karte & Modus')).toBeTruthy();
    expect(screen.queryByText('Beschreibung, die in der Live-Steuerung fehlt.')).toBeNull();
  });

  it('nimmt bei ausgeschaltetem Server Werte für den nächsten Start', async () => {
    const { onChanged } = zeichne('stopped');

    expect(await screen.findByText(/gelten beim nächsten Start/u)).toBeTruthy();
    const bots = (await screen.findByRole('spinbutton', { name: 'Bots' })) as HTMLInputElement;
    fireEvent.change(bots, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => {
      expect(api.applyLiveValues).toHaveBeenCalledWith('s1', { bots: 2 });
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('ist gesperrt, solange der Server startet oder stoppt, und sagt warum', async () => {
    zeichne('starting');

    expect(await screen.findByText(/startet oder stoppt gerade/u)).toBeTruthy();
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

  it('schickt einen Schalter als Wahrheitswert (CS2 Schritt 5)', async () => {
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [
        gameType({
          configFields: [
            feld({
              key: 'allRounds',
              label: 'Alle Runden spielen',
              type: 'toggle',
              defaultValue: false,
            }),
          ],
          liveControls: [
            { id: 'runden', label: 'Runden', fields: ['allRounds'], commands: ['{allRounds}'] },
          ],
        }),
      ],
      error: null,
    });
    zeichne('running');

    fireEvent.click(await screen.findByRole('switch', { name: 'Alle Runden spielen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => {
      expect(api.applyLiveValues).toHaveBeenCalledWith('s1', { allRounds: true });
    });
  });

  it('fasst Steuerungen einer Gruppe unter einer Überschrift zusammen', async () => {
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [
        gameType({
          configFields: [
            feld({
              key: 'alle',
              label: 'Alle Runden spielen',
              type: 'toggle',
              defaultValue: false,
            }),
            feld({ key: 'plugins', label: 'MetaMod', type: 'toggle', defaultValue: false }),
          ],
          liveControls: [
            { id: 'runden', label: 'Runden', group: 'Schalter', fields: ['alle'], commands: [] },
            {
              id: 'plugins',
              label: 'MetaMod',
              group: 'Schalter',
              fields: ['plugins'],
              commands: [],
              requiresRestart: true,
            },
          ],
        }),
      ],
      error: null,
    });
    zeichne('running');

    const gruppe = await screen.findByRole('region', { name: 'Schalter' });
    expect(within(gruppe).getByRole('switch', { name: 'Alle Runden spielen' })).toBeTruthy();
    expect(within(gruppe).getByRole('switch', { name: 'MetaMod' })).toBeTruthy();
    // Die einzelnen Überschriften der Steuerungen entfallen in der Gruppe.
    expect(screen.queryByText('Runden')).toBeNull();
  });

  it('setzt Schalter einer Gruppe ins Raster, Auswahlfelder darunter (25.09.2026)', async () => {
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [
        gameType({
          configFields: [
            feld({ key: 'muni', label: 'Unendlich Munition', type: 'toggle', defaultValue: false }),
            feld({
              key: 'modus',
              label: 'Spielmodus-Plugin',
              type: 'select',
              defaultValue: 'none',
              options: ['none', 'retakes'],
            }),
          ],
          liveControls: [
            { id: 'muni', label: 'Munition', group: 'Training', fields: ['muni'], commands: [] },
            { id: 'modus', label: 'Modus', group: 'Training', fields: ['modus'], commands: [] },
          ],
        }),
      ],
      error: null,
    });
    zeichne('running');

    const gruppe = await screen.findByRole('region', { name: 'Training' });
    // Der Text steht neben dem Schalter, nicht als eigene Überschrift darüber.
    expect(within(gruppe).getByText('Unendlich Munition')).toBeTruthy();
    expect(within(gruppe).getByRole('combobox')).toBeTruthy();

    fireEvent.click(within(gruppe).getByRole('switch', { name: 'Unendlich Munition' }));
    fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => {
      expect(api.applyLiveValues).toHaveBeenCalledWith('s1', { muni: true });
    });
  });

  describe('Plugins (Fundpunkt 361)', () => {
    const MIT_PLUGINS: GameTypeDto = gameType({
      configFields: [
        feld({ key: 'bots', label: 'Bots', type: 'number', defaultValue: 0, min: 0, max: 10 }),
        feld({ key: 'plugins', label: 'Plugins laden', type: 'toggle', defaultValue: false }),
        feld({
          key: 'modePlugin',
          label: 'Spielmodus-Plugin',
          defaultValue: 'none',
          options: ['none', 'matchzy', 'retakes'],
          optionLabels: { none: 'Keins', matchzy: 'MatchZy (Turniere)', retakes: 'Retakes' },
        }),
      ],
      liveControls: [
        {
          id: 'bots',
          label: 'Bots',
          fields: ['bots'],
          commands: ['bot_quota {bots}'],
          disabledWhen: {
            field: 'modePlugin',
            values: ['matchzy', 'retakes'],
            hint: 'Bots verwaltet {wert} selbst.',
          },
        },
        {
          id: 'plugins',
          label: 'Plugins',
          fields: ['plugins', 'modePlugin'],
          commands: [],
          requiresRestart: true,
          collapsible: true,
          showHints: true,
        },
      ],
    });

    function mitPlugins(
      status: 'running' | 'stopped',
      config: Record<string, string | number | boolean>,
    ) {
      api.fetchGameTypes.mockResolvedValue({ success: true, data: [MIT_PLUGINS], error: null });
      const onChanged = vi.fn();
      render(
        <ToastProvider>
          <LiveControlsCard
            server={{ ...server({ id: 's1', status }), config }}
            onChanged={onChanged}
          />
        </ToastProvider>,
      );

      return { onChanged };
    }

    it('zeigt den Abschnitt eingeklappt mit Kurzzeile und klappt mit „Anpassen“ auf', async () => {
      mitPlugins('running', { plugins: true, modePlugin: 'retakes' });

      expect(await screen.findByText('Plugins laden · Retakes')).toBeTruthy();
      expect(screen.queryByRole('combobox', { name: 'Spielmodus-Plugin' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Anpassen' }));

      const auswahl = screen.getByRole('combobox', {
        name: 'Spielmodus-Plugin',
      }) as HTMLSelectElement;
      expect(auswahl.value).toBe('retakes');
      // Anzeigenamen statt der gespeicherten Werte.
      expect(screen.getByRole('option', { name: 'MatchZy (Turniere)' })).toBeTruthy();
    });

    it('sperrt die Bots, solange ein Spielmodus-Plugin sie verwaltet, und sagt warum', async () => {
      mitPlugins('running', { plugins: true, modePlugin: 'retakes', bots: 3 });

      const bots = (await screen.findByRole('spinbutton', { name: 'Bots' })) as HTMLInputElement;
      expect(bots.disabled).toBe(true);
      expect(screen.getByText('Bots verwaltet Retakes selbst.')).toBeTruthy();
    });

    it('übernimmt Plugin-Änderungen am laufenden Server und startet neu', async () => {
      const { onChanged } = mitPlugins('running', { plugins: true, modePlugin: 'none' });

      fireEvent.click(await screen.findByRole('button', { name: 'Anpassen' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Spielmodus-Plugin' }), {
        target: { value: 'matchzy' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Übernehmen & neu starten' }));

      await waitFor(() => {
        expect(api.runLifecycleAction).toHaveBeenCalledWith('s1', 'restart');
      });
      expect(api.applyLiveValues).toHaveBeenCalledWith('s1', { modePlugin: 'matchzy' });
      expect(onChanged).toHaveBeenCalledTimes(2);
    });

    it('startet bei ausgeschaltetem Server nicht neu', async () => {
      mitPlugins('stopped', { plugins: false, modePlugin: 'none' });

      fireEvent.click(await screen.findByRole('button', { name: 'Anpassen' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Plugins laden' }));
      fireEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));

      await waitFor(() => {
        expect(api.applyLiveValues).toHaveBeenCalledWith('s1', { plugins: true });
      });
      expect(api.runLifecycleAction).not.toHaveBeenCalled();
    });
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
