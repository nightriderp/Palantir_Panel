import { type UserPresetDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { ProfilSpeichern } from './ProfilSpeichern';

/** Eigene Profile speichern und löschen (Idee P / A2, 26.09.2026). */
const api = vi.hoisted(() => ({
  fetchUserPresets: vi.fn(),
  createUserPreset: vi.fn(),
  updateUserPreset: vi.fn(),
  deleteUserPreset: vi.fn(),
}));

vi.mock('@/lib/api/user-presets', () => api);

const SMOKES: UserPresetDto = {
  id: 'p1',
  gameType: 'cs2',
  name: 'Smokes',
  values: { bots: 0 },
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  permissions: { canEdit: true, canDelete: true },
};

function zeichne(gewaehlt: UserPresetDto | null = null) {
  const onGeaendert = vi.fn();
  render(
    <ToastProvider>
      <ProfilSpeichern
        gameType="cs2"
        eigene={[SMOKES]}
        gewaehlt={gewaehlt}
        werte={() => ({ gameMode: 'custom', bots: 2 })}
        onGeaendert={onGeaendert}
      />
    </ToastProvider>,
  );

  return onGeaendert;
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
});

describe('ProfilSpeichern', () => {
  it('klappt über das Speichern-Symbol ein Namensfeld auf und legt an', async () => {
    api.createUserPreset.mockResolvedValue({
      success: true,
      data: { ...SMOKES, id: 'p2', name: 'Neu' },
      error: null,
    });
    const onGeaendert = zeichne();

    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Als eigenes Profil speichern' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name des Profils' }), {
      target: { value: 'Neu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(api.createUserPreset).toHaveBeenCalledWith({
        gameType: 'cs2',
        name: 'Neu',
        values: { gameMode: 'custom', bots: 2 },
      });
    });
    expect(onGeaendert).toHaveBeenCalledWith(expect.objectContaining({ id: 'p2' }));
  });

  it('überschreibt, wenn es den Namen schon gibt', async () => {
    api.updateUserPreset.mockResolvedValue({ success: true, data: SMOKES, error: null });
    zeichne(SMOKES);

    // Mit gewähltem Profil steht dessen Name schon im Feld.
    fireEvent.click(screen.getByRole('button', { name: 'Als eigenes Profil speichern' }));
    fireEvent.click(screen.getByRole('button', { name: 'Überschreiben' }));

    await waitFor(() => {
      expect(api.updateUserPreset).toHaveBeenCalledWith('p1', {
        values: { gameMode: 'custom', bots: 2 },
      });
    });
  });

  it('löscht das gewählte eigene Profil erst nach Bestätigung', async () => {
    api.deleteUserPreset.mockResolvedValue({ success: true, data: null, error: null });
    const onGeaendert = zeichne(SMOKES);

    fireEvent.click(screen.getByRole('button', { name: 'Profil „Smokes“ löschen' }));
    expect(api.deleteUserPreset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Wirklich löschen?' }));

    await waitFor(() => {
      expect(api.deleteUserPreset).toHaveBeenCalledWith('p1');
    });
    expect(onGeaendert).toHaveBeenCalledWith(null);
  });

  it('zeigt ohne gewähltes eigenes Profil keinen Löschknopf', () => {
    zeichne();

    expect(screen.queryByRole('button', { name: /löschen/u })).toBeNull();
  });
});
