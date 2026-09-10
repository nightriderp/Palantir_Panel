import {
  type AccountDto,
  type GameTypeDto,
  type GlobalPermissions,
  type InstanceSettingsDto,
} from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { TemplatesView } from './TemplatesView';

/**
 * Verwaltung der Spiel-Vorlagen (Wunsch des Betreibers, 2026-09-11).
 *
 * Geprüft wird, was die Ansicht verspricht und was beim nächsten Umbau still
 * kaputtgehen könnte:
 *
 * - Ausschalten schickt den **vollständigen** Zustand. Die Instanz-
 *   Einstellungen kennen keine Teiländerung; wer hier nur die Spieleliste
 *   schickte, setzte die Selbstregistrierung nebenbei auf die Vorgabe zurück.
 * - Ein Spiel, das die Ausbaustufe noch nicht hergibt, lässt sich nicht
 *   einschalten – das ist keine Entscheidung des Administrators.
 * - Ohne das Recht, Instanz-Einstellungen zu ändern, sind die Schalter
 *   gesperrt statt sicher am Backend zu scheitern.
 */

const api = vi.hoisted(() => ({
  fetchGameTypes: vi.fn(),
  fetchInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
}));
const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null }));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: sitzung.account, loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/servers', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchGameTypes: api.fetchGameTypes,
}));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInstanceSettings: api.fetchInstanceSettings,
  updateInstanceSettings: api.updateInstanceSettings,
}));

function berechtigungen(overrides: Partial<GlobalPermissions> = {}): GlobalPermissions {
  return {
    canCreateServer: false,
    canViewAnyServer: false,
    canManageAnyBackup: false,
    canManageUsers: false,
    canManageRoles: false,
    canManageNotifications: false,
    canViewNodes: false,
    canManageNodes: false,
    canManageAddresses: false,
    canViewAuditLog: false,
    canModerateMessages: false,
    canManageGameTypes: true,
    ...overrides,
  };
}

function konto(permissions: GlobalPermissions): AccountDto {
  return {
    id: 'admin-1',
    displayName: 'Admina',
    username: 'admina',
    isOwner: false,
    banned: false,
    awaitingApproval: false,
    twoFactorEnabled: false,
    roles: [],
    authMethods: [],
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions,
  };
}

function spiel(overrides: Partial<GameTypeDto> = {}): GameTypeDto {
  return {
    id: 'minecraft-paper',
    name: 'Minecraft (Paper)',
    description: 'Ein Minecraft-Server.',
    iconUrl: null,
    coverImageUrl: null,
    supportsVirtualHostRouting: true,
    supportsWorldImport: true,
    defaultPorts: [25_565],
    resourceDefaults: { ramMb: 4096, cpuCores: 2, diskMb: 10_240 },
    configFields: [],
    available: true,
    unavailableReason: null,
    ...overrides,
  };
}

function einstellungen(overrides: Partial<InstanceSettingsDto> = {}): InstanceSettingsDto {
  return {
    selfRegistrationEnabled: false,
    uiFontId: null,
    monospaceFontId: null,
    disabledGameTypes: [],
    updatedAt: null,
    permissions: { canEdit: true },
    ...overrides,
  };
}

function zeichne() {
  return render(
    <ToastProvider>
      <TemplatesView />
    </ToastProvider>,
  );
}

beforeEach(() => {
  api.fetchGameTypes.mockReset();
  api.fetchInstanceSettings.mockReset();
  api.updateInstanceSettings.mockReset();

  sitzung.account = konto(berechtigungen());
  api.fetchGameTypes.mockResolvedValue({
    success: true,
    data: [spiel(), spiel({ id: 'valheim', name: 'Valheim' })],
    error: null,
  });
  api.fetchInstanceSettings.mockResolvedValue({
    success: true,
    data: einstellungen(),
    error: null,
  });
  api.updateInstanceSettings.mockImplementation((input: { disabledGameTypes?: string[] }) =>
    Promise.resolve({
      success: true,
      data: einstellungen({ disabledGameTypes: input.disabledGameTypes ?? [] }),
      error: null,
    }),
  );
});

describe('Templates: das Angebot der Instanz', () => {
  it('zeigt jede Vorlage mit einem Schalter', async () => {
    zeichne();

    expect(await screen.findByText('Minecraft (Paper)')).toBeTruthy();
    expect(screen.getByText('Valheim')).toBeTruthy();
  });

  it('schickt beim Ausschalten den vollständigen Zustand', async () => {
    api.fetchInstanceSettings.mockResolvedValue({
      success: true,
      data: einstellungen({ selfRegistrationEnabled: true }),
      error: null,
    });

    zeichne();
    await screen.findByText('Valheim');

    fireEvent.click(screen.getAllByRole('switch')[1] as HTMLElement);

    await waitFor(() => {
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        // Ohne diesen Wert schaltete ein Klick hier die Registrierung mit um.
        selfRegistrationEnabled: true,
        disabledGameTypes: ['valheim'],
      });
    });
  });

  it('schaltet ein ausgeschaltetes Spiel wieder ein', async () => {
    api.fetchInstanceSettings.mockResolvedValue({
      success: true,
      data: einstellungen({ disabledGameTypes: ['valheim'] }),
      error: null,
    });

    zeichne();
    await screen.findByText('Valheim');

    fireEvent.click(screen.getAllByRole('switch')[1] as HTMLElement);

    await waitFor(() => {
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        selfRegistrationEnabled: false,
        disabledGameTypes: [],
      });
    });
  });

  it('lässt ein Spiel der nächsten Ausbaustufe nicht einschalten', async () => {
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [
        spiel({
          id: 'valheim',
          name: 'Valheim',
          available: false,
          unavailableReason: 'Kommt in Ausbaustufe 3 (Lastenheft §3.5).',
        }),
      ],
      error: null,
    });

    zeichne();
    await screen.findByText('Valheim');

    expect((screen.getAllByRole('switch')[0] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Ausbaustufe 3/u)).toBeTruthy();
  });

  it('sperrt die Schalter ohne das Recht auf die Instanz-Einstellungen', async () => {
    api.fetchInstanceSettings.mockResolvedValue({
      success: true,
      data: einstellungen({ permissions: { canEdit: false } }),
      error: null,
    });

    zeichne();
    await screen.findByText('Valheim');

    for (const schalter of screen.getAllByRole('switch')) {
      expect((schalter as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.getByText(/fehlt dir das Recht/u)).toBeTruthy();
  });
});
