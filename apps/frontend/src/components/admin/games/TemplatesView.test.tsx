import {
  type AccountDto,
  type GameTypeDto,
  type GlobalPermissions,
  type InstanceSettingsDto,
} from '@palantir/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { gameType } from '../../servers/testFixtures';
import { TemplatesView } from './TemplatesView';

/**
 * Varianten eines Spiels auf einer Karte (Betreiber-Wunsch 20.09.2026).
 *
 * Geprüft wird die gerenderte Seite und nicht nur `buildTemplateGroups`: Was
 * hier zählt, ist, dass die Karte **einen** Bild-Bereich für die ganze Gruppe
 * zeigt und trotzdem **einen Schalter je Ausgabe** – das ist die Zusage, und
 * sie steht in der Zusammensetzung, nicht in der Gruppierungsfunktion.
 */

const api = vi.hoisted(() => ({
  fetchGameTypes: vi.fn(),
  fetchInstanceSettings: vi.fn(),
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

const KONTO: AccountDto = {
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

function minecraft(label: string, id: string): GameTypeDto {
  return gameType({
    id,
    name: `Minecraft (${label})`,
    variantGroup: 'Minecraft',
    variantLabel: label,
    imageVersion: '10',
  });
}

const SPIELE: GameTypeDto[] = [
  minecraft('Paper', 'minecraft-paper'),
  minecraft('Vanilla', 'minecraft-vanilla'),
  minecraft('Fabric', 'minecraft-fabric'),
  minecraft('NeoForge', 'minecraft-neoforge'),
  gameType({ id: 'minecraft-bedrock', name: 'Minecraft (Bedrock)', imageVersion: '1' }),
  gameType({ id: 'valheim', name: 'Valheim', imageVersion: '1' }),
];

const EINSTELLUNGEN: InstanceSettingsDto = {
  selfRegistrationEnabled: true,
  disabledGameTypes: [],
  permissions: { canEdit: true },
} as InstanceSettingsDto;

function zeige(spiele: GameTypeDto[] = SPIELE) {
  sitzung.account = KONTO;
  api.fetchGameTypes.mockResolvedValue({ success: true, data: spiele });
  api.fetchInstanceSettings.mockResolvedValue({ success: true, data: EINSTELLUNGEN });

  return render(
    <ToastProvider>
      <TemplatesView />
    </ToastProvider>,
  );
}

/** Die Karte, auf der die Überschrift steht – Panels tragen keine Rolle. */
function karteMit(text: string): HTMLElement {
  const treffer = screen.getByText(text);
  const karte = treffer.closest('div.flex.flex-col');

  if (karte === null) {
    throw new Error(`Keine Karte um „${text}" gefunden.`);
  }

  return karte as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TemplatesView – Varianten auf einer Karte', () => {
  it('zeigt eine Karte „Minecraft" statt einer je Ausgabe', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    // Die vollständigen Namen der vier Ausgaben stehen nicht mehr als
    // Überschrift da – in der Gruppe stehen die kurzen.
    expect(screen.queryByText('Minecraft (Paper)')).toBeNull();
    expect(screen.queryByText('Minecraft (NeoForge)')).toBeNull();
  });

  it('trägt einen Schalter je Ausgabe – das Angebot bleibt einzeln entscheidbar', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');

    for (const label of ['Paper', 'Vanilla', 'Fabric', 'NeoForge']) {
      expect(within(karte).getByText(label), label).toBeTruthy();
    }

    // Vier Ausgaben, vier Schalter.
    expect(within(karte).getAllByRole('switch')).toHaveLength(4);
  });

  it('zeigt Symbol und Kachelbild einmal für die ganze Gruppe', async () => {
    // Der Grund für die Änderung: Vorher waren es fünf Karten und damit zehn
    // Uploads für dasselbe Bild.
    zeige();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');

    expect(within(karte).getAllByText('Symbol')).toHaveLength(1);
    expect(within(karte).getAllByText('Kachelbild')).toHaveLength(1);
  });

  it('nennt die Image-Version der Gruppe einmal, nicht je Ausgabe', async () => {
    zeige();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    expect(within(karteMit('Minecraft')).getAllByText('v10.0.0')).toHaveLength(1);
  });

  it('lässt Spiele ohne Gruppe unverändert – Bedrock und Valheim je eigene Karte', async () => {
    // Bedrock zeigt auf ein anderes Image und hat darum kein `variantGroup`.
    zeige();

    await waitFor(() => {
      expect(screen.getByText('Minecraft (Bedrock)')).toBeTruthy();
    });

    expect(screen.getByText('Valheim')).toBeTruthy();
    expect(within(karteMit('Minecraft (Bedrock)')).getAllByRole('switch')).toHaveLength(1);
  });

  it('zählt weiterhin jede Vorlage einzeln, nicht die Karten', async () => {
    // „6 von 6 Vorlagen" – die Zusammenfassung spricht von Vorlagen, und
    // Minecraft ist vier davon, auch wenn es eine Karte ist.
    zeige();

    await waitFor(() => {
      expect(screen.getByText(/von 6 Vorlagen/u)).toBeTruthy();
    });
  });
});
