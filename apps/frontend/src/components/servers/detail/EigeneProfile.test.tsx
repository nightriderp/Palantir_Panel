import { type UserPresetDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { EigeneProfile } from './EigeneProfile';

/** Eigene Profile der Steuerung (Idee P / A2, 26.09.2026). */
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
  values: { gameMode: 'custom', bots: 0 },
  createdAt: '2026-09-26T10:00:00.000Z',
  updatedAt: '2026-09-26T10:00:00.000Z',
  permissions: { canEdit: true, canDelete: true },
};

function zeichne(entwurf = { gameMode: 'competitive', bots: 3, alt: 'x' }) {
  const onWaehlen = vi.fn();
  render(
    <ToastProvider>
      <EigeneProfile
        gameType="cs2"
        entwurf={entwurf}
        felder={['gameMode', 'bots']}
        onWaehlen={onWaehlen}
      />
    </ToastProvider>,
  );

  return onWaehlen;
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.fetchUserPresets.mockResolvedValue({ success: true, data: [SMOKES], error: null });
});

describe('EigeneProfile', () => {
  it('legt die Werte eines gewählten Profils in den Entwurf', async () => {
    const onWaehlen = zeichne();

    await screen.findByRole('option', { name: 'Smokes' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Eigenes Profil' }), {
      target: { value: 'p1' },
    });

    expect(onWaehlen).toHaveBeenCalledWith({ gameMode: 'custom', bots: 0 });
  });

  it('speichert nur Felder der Steuerung unter dem eingegebenen Namen', async () => {
    api.createUserPreset.mockResolvedValue({
      success: true,
      data: { ...SMOKES, id: 'p2', name: 'Neu' },
      error: null,
    });
    zeichne();

    fireEvent.click(await screen.findByRole('button', { name: 'Als Profil speichern' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name des Profils' }), {
      target: { value: 'Neu' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(api.createUserPreset).toHaveBeenCalledWith({
        gameType: 'cs2',
        name: 'Neu',
        values: { gameMode: 'competitive', bots: 3 },
      });
    });
  });

  it('löscht erst nach Bestätigung', async () => {
    api.deleteUserPreset.mockResolvedValue({ success: true, data: null, error: null });
    zeichne();

    await screen.findByRole('option', { name: 'Smokes' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Eigenes Profil' }), {
      target: { value: 'p1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(api.deleteUserPreset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Wirklich löschen?' }));
    await waitFor(() => {
      expect(api.deleteUserPreset).toHaveBeenCalledWith('p1');
    });
  });
});
