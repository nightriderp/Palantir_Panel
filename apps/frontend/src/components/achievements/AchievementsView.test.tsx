import { type AchievementOverviewDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Erfolgs-Ansicht (Betreiber-Wunsch 21.09.2026).
 *
 * Schwerpunkt ist das, was die Ansicht selbst entscheidet: Was sie von einem
 * verschlossenen geheimen Abzeichen zeigt (nämlich nichts), welche Titel sie
 * zur Wahl stellt (nur die vom Backend gelieferten) und dass ein Titelwechsel
 * die Übersicht aus der Antwort ersetzt, statt neu zu laden.
 */

function uebersicht(patch: Partial<AchievementOverviewDto> = {}): AchievementOverviewDto {
  return {
    entries: [
      {
        id: 'grundsteinleger',
        category: 'server',
        name: 'Grundsteinleger',
        description: 'Du hast deinen ersten Server angelegt.',
        title: null,
        secret: false,
        unlockedAt: '2026-09-01T10:00:00.000Z',
      },
      {
        id: 'flottenkommando',
        category: 'server',
        name: 'Flottenkommando',
        description: 'Lege insgesamt fünf Server an.',
        title: 'Flottenkommando',
        secret: false,
        unlockedAt: null,
      },
      {
        id: 'nachtschicht',
        category: 'konto',
        name: '',
        description: '',
        title: null,
        secret: true,
        unlockedAt: null,
      },
    ],
    unlockedCount: 1,
    totalCount: 3,
    level: { level: 1, required: 0, label: 'Neuling' },
    nextLevel: { level: 2, required: 2, label: 'Eingelebt' },
    availableTitles: [],
    selectedTitle: null,
    permissions: { canChooseTitle: false },
    ...patch,
  };
}

let geladen: AchievementOverviewDto = uebersicht();
const gewaehlt = vi.fn();

vi.mock('@/lib/achievements/api', () => ({
  fetchAchievements: () => Promise.resolve({ success: true, data: geladen, error: null }),
  chooseAchievementTitle: (id: string | null) => {
    gewaehlt(id);

    return Promise.resolve({
      success: true,
      data: uebersicht({
        availableTitles: [{ achievementId: 'nachtschicht', title: 'Nachtschicht' }],
        selectedTitle:
          id === null ? null : { achievementId: 'nachtschicht', title: 'Nachtschicht' },
        permissions: { canChooseTitle: true },
      }),
      error: null,
    });
  },
}));

const { ToastProvider } = await import('@/components/shared');
const { AchievementsView } = await import('./AchievementsView');

function zeigen() {
  return render(
    <ToastProvider>
      <AchievementsView />
    </ToastProvider>,
  );
}

beforeEach(() => {
  geladen = uebersicht();
  gewaehlt.mockClear();
});

describe('Abzeichen anzeigen', () => {
  it('zeigt freigeschaltete mit Beschreibung und Datum', async () => {
    zeigen();

    expect(await screen.findByText('Grundsteinleger')).toBeTruthy();
    expect(screen.getByText('Du hast deinen ersten Server angelegt.')).toBeTruthy();
  });

  it('zeigt verschlossene mit ihrem Hinweis', async () => {
    zeigen();

    expect(await screen.findByText('Flottenkommando')).toBeTruthy();
    expect(screen.getByText('Lege insgesamt fünf Server an.')).toBeTruthy();
  });

  it('verrät von einem verschlossenen Geheimnis weder Namen noch Hinweis', async () => {
    zeigen();

    expect(await screen.findByText('Geheimes Abzeichen')).toBeTruthy();
    expect(screen.queryByText('Nachtschicht')).toBeNull();
  });

  it('nennt Stufe und den Weg zur nächsten', async () => {
    zeigen();

    expect(await screen.findByText(/Stufe 1 · Neuling/)).toBeTruthy();
    expect(screen.getByText(/Noch 1 Abzeichen bis „Eingelebt"/)).toBeTruthy();
  });

  it('meldet auf der höchsten Stufe, dass nichts mehr kommt', async () => {
    geladen = uebersicht({
      unlockedCount: 3,
      level: { level: 7, required: 3, label: 'Vollständig' },
      nextLevel: null,
    });

    zeigen();

    expect(await screen.findByText(/Höchste Stufe erreicht/)).toBeTruthy();
  });
});

describe('Titel wählen', () => {
  it('bietet ohne Titel-Abzeichen nichts zur Wahl an', async () => {
    zeigen();

    await screen.findByText('Grundsteinleger');
    expect(screen.getByText(/Du hast noch keines davon/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keiner' })).toBeNull();
  });

  it('stellt genau die vom Backend gelieferten Titel zur Wahl', async () => {
    geladen = uebersicht({
      availableTitles: [{ achievementId: 'nachtschicht', title: 'Nachtschicht' }],
      permissions: { canChooseTitle: true },
    });

    zeigen();

    expect(await screen.findByRole('button', { name: 'Nachtschicht' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keiner' })).toBeTruthy();
    // `flottenkommando` bringt zwar einen Titel mit, ist aber nicht
    // freigeschaltet – es steht deshalb nicht zur Wahl.
    expect(screen.queryByRole('button', { name: 'Flottenkommando' })).toBeNull();
  });

  it('übernimmt den neuen Stand aus der Antwort, ohne neu zu laden', async () => {
    geladen = uebersicht({
      availableTitles: [{ achievementId: 'nachtschicht', title: 'Nachtschicht' }],
      permissions: { canChooseTitle: true },
    });

    zeigen();

    fireEvent.click(await screen.findByRole('button', { name: 'Nachtschicht' }));

    await waitFor(() => {
      expect(gewaehlt).toHaveBeenCalledWith('nachtschicht');
    });

    // Der gewählte Knopf ist danach gedrückt – aus der Antwort, nicht aus
    // einem zweiten Abruf.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Nachtschicht/ }).getAttribute('aria-pressed'),
      ).toBe('true');
    });
  });

  it('legt den Titel über „Keiner" wieder ab', async () => {
    geladen = uebersicht({
      availableTitles: [{ achievementId: 'nachtschicht', title: 'Nachtschicht' }],
      selectedTitle: { achievementId: 'nachtschicht', title: 'Nachtschicht' },
      permissions: { canChooseTitle: true },
    });

    zeigen();

    fireEvent.click(await screen.findByRole('button', { name: 'Keiner' }));

    await waitFor(() => {
      expect(gewaehlt).toHaveBeenCalledWith(null);
    });
  });
});
