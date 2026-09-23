import {
  type AccountDto,
  type GameTypeDto,
  type GlobalPermissions,
  type InstanceSettingsDto,
} from '@palantir/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    canManagePanelBackups: false,
    canManageUsers: false,
    canManageInstance: false,
    canManageRoles: false,
    canManageNotifications: false,
    canViewNodes: false,
    canManageNodes: false,
    canManageAddresses: false,
    canViewAuditLog: false,
    canArchiveAuditLog: false,
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
    supportsVersionChoice: false,
    defaultPorts: [25_565],
    resourceDefaults: { ramMb: 4096, diskMb: 10_240 },
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

  it('nennt oben, wie viele Vorlagen angeboten werden', async () => {
    api.fetchInstanceSettings.mockResolvedValue({
      success: true,
      data: einstellungen({ disabledGameTypes: ['valheim'] }),
      error: null,
    });

    zeichne();

    expect(await screen.findByText('1 von 2 Vorlagen werden angeboten.')).toBeTruthy();
  });

  it('schreibt die Beschreibung nicht in die Kachel, sondern daran', async () => {
    // Mit dreizehn Spielen wurde die Liste laenger als der Bildschirm. Die
    // Beschreibung braucht niemand beim Umschalten - sie haengt als Titel am
    // Namen, fuer den, der sie sucht.
    zeichne();

    const name = await screen.findByText('Minecraft (Paper)');

    expect(screen.queryByText('Ein Minecraft-Server.')).toBeNull();
    expect(name.getAttribute('title')).toBe('Ein Minecraft-Server.');
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

/**
 * Varianten eines Spiels auf einer Karte (Betreiber-Wunsch 20.09.2026).
 *
 * Minecraft belegte fünf von zwanzig Karten, und jede wollte Symbol und
 * Kachelbild einzeln hochgeladen bekommen. Geprüft wird die gerenderte Seite
 * und nicht nur `buildTemplateGroups`: Die Zusage – **ein** Bild-Bereich je
 * Gruppe, aber **ein Schalter je Ausgabe** – steckt in der Zusammensetzung.
 */

function ausgabe(label: string, id: string): GameTypeDto {
  return spiel({
    id,
    name: `Minecraft (${label})`,
    variantGroup: 'Minecraft',
    variantLabel: label,
    imageVersion: '10',
  });
}

/** Die Karte, in der ein Text steht – die Panels tragen keine Rolle. */
function karteMit(text: string): HTMLElement {
  const karte = screen.getByText(text).closest('div.flex.flex-col');

  if (karte === null) {
    throw new Error(`Keine Karte um „${text}" gefunden.`);
  }

  return karte as HTMLElement;
}

describe('Templates: Varianten auf einer Karte', () => {
  beforeEach(() => {
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [
        ausgabe('Paper', 'minecraft-paper'),
        ausgabe('Vanilla', 'minecraft-vanilla'),
        ausgabe('Fabric', 'minecraft-fabric'),
        ausgabe('NeoForge', 'minecraft-neoforge'),
        // Bedrock steht seit #605 in derselben Gruppe, laeuft aber aus einem
        // eigenen Image - genau der Fall, in dem eine gemeinsame Versionszeile
        // luege.
        spiel({
          id: 'minecraft-bedrock',
          name: 'Minecraft (Bedrock)',
          variantGroup: 'Minecraft',
          variantLabel: 'Bedrock',
          imageVersion: '1',
        }),
        spiel({ id: 'valheim', name: 'Valheim', imageVersion: '1' }),
      ],
      error: null,
    });
  });

  it('zeigt eine Karte „Minecraft" statt einer je Ausgabe', async () => {
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    // Die vollständigen Namen stehen nicht mehr als Überschrift da – in der
    // Gruppe stehen die kurzen.
    expect(screen.queryByText('Minecraft (Paper)')).toBeNull();
    expect(screen.queryByText('Minecraft (NeoForge)')).toBeNull();
  });

  it('trägt einen Schalter je Ausgabe – das Angebot bleibt einzeln entscheidbar', async () => {
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');
    fireEvent.click(within(karte).getByRole('button', { expanded: false }));

    for (const label of ['Paper', 'Vanilla', 'Fabric', 'NeoForge', 'Bedrock']) {
      expect(within(karte).getByText(label), label).toBeTruthy();
    }

    expect(within(karte).getAllByRole('switch')).toHaveLength(5);
  });

  it('zeigt Symbol und Kachelbild einmal für die ganze Gruppe', async () => {
    // Der Grund für die Änderung: vorher fünf Karten und damit zehn Uploads
    // für dasselbe Bild.
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');

    expect(within(karte).getAllByText('Symbol')).toHaveLength(1);
    expect(within(karte).getAllByText('Kachelbild')).toHaveLength(1);
  });

  it('nennt die Image-Version einmal, wenn die Gruppe sich ein Image teilt', async () => {
    // Ohne Bedrock laufen alle vier aus demselben Image - dann sagt eine Zeile
    // alles, und fünfmal dieselbe Zahl saege nichts.
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [
        ausgabe('Paper', 'minecraft-paper'),
        ausgabe('Vanilla', 'minecraft-vanilla'),
        ausgabe('Fabric', 'minecraft-fabric'),
        ausgabe('NeoForge', 'minecraft-neoforge'),
      ],
      error: null,
    });

    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    expect(within(karteMit('Minecraft')).getAllByText('v10.0.0')).toHaveLength(1);
  });

  it('klappt eine Gruppe erst auf Klick auf (Betreiber-Wunsch 23.09.2026)', async () => {
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');

    expect(within(karte).queryAllByRole('switch')).toHaveLength(0);
    expect(within(karte).getByText('5 Varianten · 5 angeboten')).toBeTruthy();

    fireEvent.click(within(karte).getByRole('button', { expanded: false }));

    expect(within(karte).getAllByRole('switch')).toHaveLength(5);
    expect(within(karte).getByRole('button', { expanded: true })).toBeTruthy();
  });

  it('lässt ein Spiel ohne Gruppe unverändert', async () => {
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Valheim')).toBeTruthy();
    });

    expect(within(karteMit('Valheim')).getAllByRole('switch')).toHaveLength(1);
  });

  it('nimmt Bedrock mit in die Gruppe - fünf Schalter auf einer Karte', async () => {
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');
    fireEvent.click(within(karte).getByRole('button', { expanded: false }));

    expect(within(karte).getByText('Bedrock')).toBeTruthy();
    expect(within(karte).getAllByRole('switch')).toHaveLength(5);
  });

  it('zeigt die Version je Variante, wenn die Gruppe sich kein Image teilt', async () => {
    /*
     * Der Fehler, den das behebt: Die Karte nahm die Version der ersten
     * Variante und schrieb sie unter alle. Bedrock lief damit sichtbar unter
     * „v10.0.0", obwohl sein Image auf 1 steht - eine Zahl, die für vier
     * Vorlagen stimmt und für die fünfte nicht.
     */
    zeichne();

    await waitFor(() => {
      expect(screen.getByText('Minecraft')).toBeTruthy();
    });

    const karte = karteMit('Minecraft');
    fireEvent.click(within(karte).getByRole('button', { expanded: false }));

    expect(within(karte).getAllByText('v10.0.0')).toHaveLength(4);
    expect(within(karte).getAllByText('v1.0.0')).toHaveLength(1);
  });

  it('zählt weiterhin Vorlagen und nicht Karten', async () => {
    // Minecraft ist vier Vorlagen, auch wenn es eine Karte ist.
    zeichne();

    await waitFor(() => {
      expect(screen.getByText(/von 6 Vorlagen/u)).toBeTruthy();
    });
  });
});

/**
 * Updates zurückhalten (Betreiber-Wunsch 22.09.2026).
 */
describe('Templates: Updates zurückhalten', () => {
  const MIT_PLUGINS = spiel({ id: 'cs2', name: 'Counter-Strike 2', supportsUpdateHold: true });

  it('zeigt den Schalter nur bei Spielen, die es können', async () => {
    api.fetchGameTypes.mockResolvedValue({
      success: true,
      data: [MIT_PLUGINS, spiel({ id: 'valheim', name: 'Valheim' })],
      error: null,
    });

    zeichne();

    expect(
      await screen.findByRole('switch', { name: 'Counter-Strike 2: Updates zurückhalten' }),
    ).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Valheim: Updates zurückhalten' })).toBeNull();
  });

  it('schickt nur die eigene Liste – das Angebot bleibt, wie es war', async () => {
    api.fetchGameTypes.mockResolvedValue({ success: true, data: [MIT_PLUGINS], error: null });
    api.updateInstanceSettings.mockResolvedValue({
      success: true,
      data: einstellungen({ heldUpdateGameTypes: ['cs2'] }),
      error: null,
    });

    zeichne();

    fireEvent.click(
      await screen.findByRole('switch', { name: 'Counter-Strike 2: Updates zurückhalten' }),
    );

    await waitFor(() => {
      expect(api.updateInstanceSettings).toHaveBeenCalledWith({
        selfRegistrationEnabled: false,
        heldUpdateGameTypes: ['cs2'],
      });
    });
    expect(
      (
        await screen.findByRole('switch', { name: 'Counter-Strike 2: Updates zurückhalten' })
      ).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('zeigt den gespeicherten Stand', async () => {
    api.fetchGameTypes.mockResolvedValue({ success: true, data: [MIT_PLUGINS], error: null });
    api.fetchInstanceSettings.mockResolvedValue({
      success: true,
      data: einstellungen({ heldUpdateGameTypes: ['cs2'] }),
      error: null,
    });

    zeichne();

    expect(
      (
        await screen.findByRole('switch', { name: 'Counter-Strike 2: Updates zurückhalten' })
      ).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
