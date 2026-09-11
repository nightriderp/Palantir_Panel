import {
  type AccountDto,
  type GlobalPermissions,
  type HostNodeDto,
  type StorageEntryDto,
  type StorageSnapshotDto,
} from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { StorageView } from './StorageView';

/**
 * Node-Platz: Mehrfachauswahl (Fundpunkt 211).
 *
 * Gemessen am laufenden System: Im ganzen Panel stand kein einziges
 * Kontrollkästchen; aufgeräumt wurde Zeile für Zeile, mit einer Rückfrage je
 * Posten. Geprüft wird hier deshalb nicht das Aussehen, sondern die Grenze:
 *
 * - Anhaken lässt sich nur, was der Contract auch löschen lässt
 *   (`permissions.canDelete`) – bei Server-Datenordnern gibt es kein Kästchen,
 *   auch nicht über „alle auswählen".
 * - Die Sammellöschung schickt genau die angehakten Posten, einen nach dem
 *   anderen.
 * - Ein Fehlschlag hält die übrigen nicht auf und wird benannt.
 */

const api = vi.hoisted(() => ({
  fetchNodes: vi.fn(),
  fetchStorageSnapshot: vi.fn(),
  deleteStorageEntry: vi.fn(),
  startStorageScan: vi.fn(),
}));

const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null }));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: sitzung.account, loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchNodes: api.fetchNodes,
  fetchStorageSnapshot: api.fetchStorageSnapshot,
  deleteStorageEntry: api.deleteStorageEntry,
  startStorageScan: api.startStorageScan,
}));

const NODE_ID = '11111111-1111-4111-8111-111111111111';

function berechtigungen(overrides: Partial<GlobalPermissions> = {}): GlobalPermissions {
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
    ...overrides,
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

function node(): HostNodeDto {
  return {
    id: NODE_ID,
    name: 'Homeserver',
    wireguardIp: '10.10.0.2',
    status: 'online',
    statusMessage: null,
    capacity: {
      total: { ramMb: 28_672, cpuCores: 8, diskMb: 2_000_000 },
      allocated: { ramMb: 8192, cpuCores: 2, diskMb: 20_480 },
      available: { ramMb: 20_480, cpuCores: 6, diskMb: 1_979_520 },
    },
    usage: null,
    serverCount: 2,
    lastSeenAt: '2026-09-10T12:00:00.000Z',
    createdAt: '2026-08-01T10:00:00.000Z',
    permissions: { canView: true, canManage: true, canManageStorage: true },
  };
}

function posten(overrides: Partial<StorageEntryDto> = {}): StorageEntryDto {
  return {
    id: '/srv/palantir/backups/a.tar.zst',
    kind: 'backup',
    label: 'Sicherung A',
    path: '/srv/palantir/backups/a.tar.zst',
    sizeBytes: 1024 * 1024 * 1024,
    serverId: null,
    backupId: null,
    imageTag: null,
    inUse: false,
    lastModifiedAt: null,
    deleteBlockedReason: null,
    permissions: { canView: true, canDelete: true },
    ...overrides,
  };
}

const SICHERUNG_A = posten();
const SICHERUNG_B = posten({
  id: '/srv/palantir/backups/b.tar.zst',
  label: 'Sicherung B',
  path: '/srv/palantir/backups/b.tar.zst',
  sizeBytes: 2 * 1024 * 1024 * 1024,
});
const SERVERDATEN = posten({
  id: '/srv/palantir/servers/welt',
  kind: 'serverData',
  label: 'Welt',
  path: '/srv/palantir/servers/welt',
  sizeBytes: 5 * 1024 * 1024 * 1024,
  inUse: true,
  deleteBlockedReason: 'activeServerData',
  permissions: { canView: true, canDelete: false },
});

function schnappschuss(): StorageSnapshotDto {
  return {
    nodeId: NODE_ID,
    ageSeconds: 60,
    permissions: { canView: true, canScan: true },
    breakdown: {
      nodeId: NODE_ID,
      scannedAt: '2026-09-10T12:00:00.000Z',
      totalBytes: 2_000_000_000_000,
      usedBytes: 8 * 1024 * 1024 * 1024,
      freeBytes: 1_990_000_000_000,
      categories: [
        { kind: 'backup', sizeBytes: 3 * 1024 * 1024 * 1024, entryCount: 2 },
        { kind: 'serverData', sizeBytes: 5 * 1024 * 1024 * 1024, entryCount: 1 },
      ],
      entries: [SICHERUNG_A, SICHERUNG_B, SERVERDATEN],
    },
  };
}

function zeichne() {
  return render(
    <ToastProvider>
      <StorageView />
    </ToastProvider>,
  );
}

/** Alle Kästchen der Tabelle, ohne das in der Kopfzeile. */
function kaestchen(): HTMLElement[] {
  return screen
    .getAllByRole('checkbox')
    .filter((element) => element.getAttribute('aria-label') !== 'Docker-Images einbeziehen');
}

beforeEach(() => {
  sitzung.account = konto();
  api.fetchNodes.mockReset();
  api.fetchStorageSnapshot.mockReset();
  api.deleteStorageEntry.mockReset();
  api.startStorageScan.mockReset();

  api.fetchNodes.mockResolvedValue({ success: true, data: [node()], error: null });
  api.fetchStorageSnapshot.mockResolvedValue({
    success: true,
    data: schnappschuss(),
    error: null,
  });
  api.deleteStorageEntry.mockResolvedValue({ success: true, data: null, error: null });
});

describe('Node-Platz – Mehrfachauswahl (Fundpunkt 211)', () => {
  it('bietet ein Kästchen nur für löschbare Posten an', async () => {
    zeichne();
    await screen.findByText('Sicherung A');

    // Kopfzeile + zwei Sicherungen; der Server-Datenordner bekommt keins.
    expect(kaestchen()).toHaveLength(3);
    expect(screen.getByLabelText('„Sicherung A" auswählen')).toBeTruthy();
    expect(screen.queryByLabelText('„Welt" auswählen')).toBeNull();
  });

  it('zeigt Anzahl und Summe der Auswahl', async () => {
    zeichne();
    await screen.findByText('Sicherung A');

    fireEvent.click(screen.getByLabelText('„Sicherung B" auswählen'));

    // Anzahl und Summe stehen in derselben Zeile - 2 GiB ist die Groesse von B.
    expect(screen.getByText(/1 Posten ausgewählt/).textContent).toContain('2 GiB');
  });

  it('wählt über die Kopfzeile nur die löschbaren Posten aus', async () => {
    zeichne();
    await screen.findByText('Sicherung A');

    fireEvent.click(screen.getByLabelText('Alle löschbaren Posten auswählen'));

    // Zwei Sicherungen, nicht drei Posten – der Datenordner bleibt aussen vor.
    expect(screen.getByText(/2 Posten ausgewählt/)).toBeTruthy();
  });

  it('sortiert die Posten nach Groesse, groesste zuerst (Fundpunkt 212)', async () => {
    zeichne();
    await screen.findByText('Sicherung A');

    /*
     * Der Agent liefert die Posten in der Reihenfolge, in der er sie findet -
     * hier A (1 GiB), B (2 GiB), Welt (5 GiB). Wer die Speicheruebersicht
     * aufruft, sucht aber das Grosse zuerst.
     */
    const zeilen = screen.getAllByRole('row').slice(1);
    expect(zeilen.map((zeile) => zeile.textContent?.split('/')[0])).toEqual([
      expect.stringContaining('Welt'),
      expect.stringContaining('Sicherung B'),
      expect.stringContaining('Sicherung A'),
    ]);
  });

  it('schickt die angehakten Posten einen nach dem anderen', async () => {
    zeichne();
    await screen.findByText('Sicherung A');

    fireEvent.click(screen.getByLabelText('Alle löschbaren Posten auswählen'));
    fireEvent.click(screen.getByRole('button', { name: /Ausgewählte löschen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(api.deleteStorageEntry).toHaveBeenCalledTimes(2);
    });
    // In der Reihenfolge der Tabelle, und die steht seit Fundpunkt 212 auf
    // „Groesse absteigend": B (2 GiB) vor A (1 GiB).
    expect(api.deleteStorageEntry).toHaveBeenNthCalledWith(1, NODE_ID, SICHERUNG_B.id);
    expect(api.deleteStorageEntry).toHaveBeenNthCalledWith(2, NODE_ID, SICHERUNG_A.id);
  });

  it('haelt bei einem Fehlschlag nicht an und benennt ihn', async () => {
    api.deleteStorageEntry
      .mockResolvedValueOnce({
        success: false,
        data: null,
        error: { code: 'AGENT_NOT_CONNECTED', message: 'Die Node antwortet nicht.' },
      })
      .mockResolvedValueOnce({ success: true, data: null, error: null });

    zeichne();
    await screen.findByText('Sicherung A');

    fireEvent.click(screen.getByLabelText('Alle löschbaren Posten auswählen'));
    fireEvent.click(screen.getByRole('button', { name: /Ausgewählte löschen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(api.deleteStorageEntry).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText(/1 gelöscht, fehlgeschlagen: Sicherung B/)).toBeTruthy();
  });
});
