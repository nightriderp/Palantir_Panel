import { type AccountDto, type GlobalPermissions, type HostNodeDto } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { NodesAdminView } from './NodesAdminView';

/**
 * Wartungsschalter der Node-Verwaltung (Lastenheft §3.7).
 *
 * Vorher schaltete die Ansicht den Zustand von Hand um
 * (`status === 'maintenance' ? 'offline' : 'maintenance'`) – „Wartung beenden"
 * schrieb also `offline`, obwohl über den Zustand allein die Agent-Verbindung
 * entscheidet. Jetzt geht nur noch ein Ja/Nein ans Backend; welcher Zustand
 * daraus folgt, entscheidet dort die offene Agent-Sitzung.
 */

const api = vi.hoisted(() => ({
  fetchNodes: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  issueNodeAgentToken: vi.fn(),
}));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: konto(), loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNodes: api.fetchNodes,
  updateNode: api.updateNode,
  deleteNode: api.deleteNode,
  issueNodeAgentToken: api.issueNodeAgentToken,
}));

function berechtigungen(): GlobalPermissions {
  return {
    canCreateServer: false,
    canViewAnyServer: false,
    canManageAnyBackup: false,
    canManageUsers: false,
    canManageRoles: false,
    canManageNotifications: false,
    canViewNodes: true,
    canManageNodes: true,
    canManageAddresses: false,
    canViewAuditLog: false,
    canModerateMessages: false,
    canManageGameTypes: false,
  };
}

function konto(): AccountDto {
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
    permissions: berechtigungen(),
  };
}

function node(overrides: Partial<HostNodeDto> = {}): HostNodeDto {
  const total = { ramMb: 16_384, cpuCores: 8, diskMb: 512_000 };

  return {
    id: 'node-1',
    name: 'Wohnzimmer-PC',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: { total, allocated: { ramMb: 0, cpuCores: 0, diskMb: 0 }, available: total },
    usage: null,
    serverCount: 0,
    lastSeenAt: '2026-08-27T10:00:00.000Z',
    hasAgentToken: false,
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: true, canManageStorage: true },
    ...overrides,
  };
}

async function zeige(zustand: HostNodeDto['status']) {
  api.fetchNodes.mockResolvedValue({ success: true, data: [node({ status: zustand })] });
  api.updateNode.mockResolvedValue({ success: true, data: node({ status: zustand }) });

  render(
    <ToastProvider>
      <NodesAdminView />
    </ToastProvider>,
  );

  await screen.findByText('Wohnzimmer-PC');
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NodesAdminView – Wartungsschalter', () => {
  it('schickt beim Beginn der Wartung { maintenance: true }', async () => {
    await zeige('online');

    fireEvent.click(screen.getByRole('button', { name: 'In Wartung' }));

    await waitFor(() => {
      expect(api.updateNode).toHaveBeenCalledWith('node-1', { maintenance: true });
    });
    expect(await screen.findByText('Node in Wartung genommen.')).toBeTruthy();
  });

  it('schickt beim Beenden der Wartung { maintenance: false } – und kein status', async () => {
    await zeige('maintenance');

    fireEvent.click(screen.getByRole('button', { name: 'Wartung beenden' }));

    await waitFor(() => {
      expect(api.updateNode).toHaveBeenCalledWith('node-1', { maintenance: false });
    });
    expect(await screen.findByText('Wartung beendet.')).toBeTruthy();
  });

  it('setzt den Zustand nirgends von Hand', async () => {
    await zeige('maintenance');

    fireEvent.click(screen.getByRole('button', { name: 'Wartung beenden' }));

    await waitFor(() => expect(api.updateNode).toHaveBeenCalled());

    const [, eingabe] = api.updateNode.mock.calls[0] as [string, Record<string, unknown>];

    expect('status' in eingabe).toBe(false);
    expect(Object.keys(eingabe)).toEqual(['maintenance']);
  });
});
