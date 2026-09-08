import {
  type AccountDto,
  type ErrorCode,
  type FontDto,
  type GlobalPermissions,
  type InstanceSettingsDto,
} from '@palantir/contracts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { FontsView } from './FontsView';
import { fontErrorMessage } from './fontLabels';

/**
 * Schriftverwaltung (Arbeitspaket S-3).
 *
 * Geprüft wird, was man einer Ansicht nicht ansieht und was beim nächsten
 * Umbau still kaputtgehen kann:
 *
 * - Beide Herkünfte stehen in derselben Liste – mitgeliefert und hochgeladen.
 * - Ein Löschknopf erscheint **nur** bei `permissions.canDelete`. Eine
 *   Schaltfläche, die sicher am Backend scheitert, ist keine Aktion, sondern
 *   eine Falle; der Grund steht stattdessen daneben.
 * - Jeder Fehlercode des Backends wird zu einem deutschen Satz, der sagt, was
 *   zu tun ist.
 * - Die Auswahl schickt die Kennung der Schrift – und beim Zurücksetzen
 *   ausdrücklich `null`, nicht etwa die Kennung der Vorgabeschrift. Nur so
 *   bleibt „Vorgabe" eine Aussage über die Instanz und keine Momentaufnahme.
 */

const api = vi.hoisted(() => ({
  fetchFonts: vi.fn(),
  uploadFont: vi.fn(),
  deleteFont: vi.fn(),
  reloadFontStylesheet: vi.fn(),
  fetchInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
}));
const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null }));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: sitzung.account, loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/fonts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchFonts: api.fetchFonts,
  uploadFont: api.uploadFont,
  deleteFont: api.deleteFont,
  reloadFontStylesheet: api.reloadFontStylesheet,
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
    canManageGameTypes: false,
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

function schrift(overrides: Partial<FontDto> = {}): FontDto {
  return {
    id: 'bundled-space-grotesk',
    family: 'Space Grotesk',
    label: 'Space Grotesk',
    source: 'bundled',
    format: 'woff2',
    sizeBytes: 42_000,
    uploadedAt: null,
    uploadedByDisplayName: null,
    variable: true,
    weightRange: { min: 300, max: 700 },
    monospace: false,
    permissions: { canDelete: false },
    ...overrides,
  };
}

const HOCHGELADEN = schrift({
  id: '44444444-4444-4444-8444-444444444444',
  family: 'Atkinson Hyperlegible',
  label: 'Atkinson Hyperlegible',
  source: 'uploaded',
  uploadedAt: '2026-09-01T12:00:00.000Z',
  uploadedByDisplayName: 'Admina',
  variable: false,
  weightRange: { min: 400, max: 400 },
  permissions: { canDelete: true },
});

function einstellungen(overrides: Partial<InstanceSettingsDto> = {}): InstanceSettingsDto {
  return {
    selfRegistrationEnabled: true,
    uiFontId: null,
    monospaceFontId: null,
    updatedAt: null,
    permissions: { canEdit: true },
    ...overrides,
  };
}

function ok<T>(data: T) {
  return { success: true as const, data, error: null };
}

function fehler(code: ErrorCode) {
  return { success: false as const, data: null, error: { code, message: 'technisch' } };
}

async function zeichne() {
  render(
    <ToastProvider>
      <FontsView />
    </ToastProvider>,
  );
  await screen.findByRole('button', { name: 'Schrift hochladen' });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();

  api.fetchFonts.mockResolvedValue(ok([schrift(), HOCHGELADEN]));
  api.fetchInstanceSettings.mockResolvedValue(ok(einstellungen()));
  api.updateInstanceSettings.mockImplementation(async () => ok(einstellungen()));
  api.deleteFont.mockResolvedValue(ok(null));
  api.uploadFont.mockResolvedValue(ok(HOCHGELADEN));

  sitzung.account = konto(berechtigungen({ canManageUsers: true }));
});

describe('Schriftliste', () => {
  it('zeigt mitgelieferte und hochgeladene Schriften mit ihrer Herkunft', async () => {
    await zeichne();

    // Innerhalb der Liste, nicht irgendwo auf der Seite: Dieselben Namen stehen
    // auch in den beiden Auswahlfeldern darüber.
    const liste = within(await screen.findByRole('list'));

    expect(liste.getAllByText('Space Grotesk').length).toBeGreaterThan(0);
    expect(liste.getAllByText('Atkinson Hyperlegible').length).toBeGreaterThan(0);
    expect(liste.getByText('Mitgeliefert')).toBeDefined();
    expect(liste.getByText('Hochgeladen')).toBeDefined();
  });

  it('nennt bei einer hochgeladenen Schrift, wer sie wann hochgeladen hat', async () => {
    await zeichne();

    expect(await screen.findByText(/von Admina/)).toBeDefined();
  });

  it('zeigt eine Vorschau in der Schrift selbst', async () => {
    const { container } = render(
      <ToastProvider>
        <FontsView />
      </ToastProvider>,
    );
    await screen.findByRole('button', { name: 'Schrift hochladen' });

    const proben = [...container.querySelectorAll<HTMLElement>('[style*="font-family"]')];

    expect(proben.some((element) => element.style.fontFamily.includes('Space Grotesk'))).toBe(true);
    expect(
      proben.some((element) => element.style.fontFamily.includes('Atkinson Hyperlegible')),
    ).toBe(true);
  });

  it('bietet den Löschknopf nur an, wo canDelete gesetzt ist', async () => {
    await zeichne();

    // Zwei Schriften, aber nur die hochgeladene ist löschbar.
    expect(screen.getAllByRole('button', { name: 'Löschen' })).toHaveLength(1);
    expect(screen.getByText('Mitgeliefert – nicht löschbar')).toBeDefined();
  });

  it('nennt die Auswahl als Grund, wenn eine hochgeladene Schrift gesperrt ist', async () => {
    api.fetchFonts.mockResolvedValue(ok([{ ...HOCHGELADEN, permissions: { canDelete: false } }]));
    api.fetchInstanceSettings.mockResolvedValue(ok(einstellungen({ uiFontId: HOCHGELADEN.id })));

    await zeichne();

    expect(await screen.findByText('Ausgewählt – erst abwählen')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull();
  });

  it('bleibt für ein Konto ohne user.manage verschlossen', async () => {
    sitzung.account = konto(berechtigungen());

    render(
      <ToastProvider>
        <FontsView />
      </ToastProvider>,
    );

    expect(await screen.findByText('Kein Zugriff')).toBeDefined();
    expect(api.fetchFonts).not.toHaveBeenCalled();
  });
});

describe('Auswahl der beiden Rollen', () => {
  it('schickt die Kennung der gewählten Schrift', async () => {
    await zeichne();

    fireEvent.change(screen.getByLabelText('Oberfläche'), { target: { value: HOCHGELADEN.id } });

    await waitFor(() => {
      expect(api.updateInstanceSettings).toHaveBeenCalled();
    });

    expect(api.updateInstanceSettings.mock.calls[0]?.[0]).toEqual({
      selfRegistrationEnabled: true,
      uiFontId: HOCHGELADEN.id,
    });
  });

  it('schickt beim Zurücksetzen ausdrücklich null – nicht die Kennung der Vorgabe', async () => {
    api.fetchInstanceSettings.mockResolvedValue(ok(einstellungen({ uiFontId: HOCHGELADEN.id })));
    await zeichne();

    fireEvent.change(await screen.findByLabelText('Oberfläche'), { target: { value: '' } });

    await waitFor(() => {
      expect(api.updateInstanceSettings).toHaveBeenCalled();
    });

    expect(api.updateInstanceSettings.mock.calls[0]?.[0]).toEqual({
      selfRegistrationEnabled: true,
      uiFontId: null,
    });
  });

  it('ändert die zweite Rolle nicht mit, wenn die erste wechselt', async () => {
    await zeichne();

    fireEvent.change(screen.getByLabelText('Oberfläche'), { target: { value: HOCHGELADEN.id } });

    await waitFor(() => {
      expect(api.updateInstanceSettings).toHaveBeenCalled();
    });

    expect(api.updateInstanceSettings.mock.calls[0]?.[0]).not.toHaveProperty('monospaceFontId');
  });

  it('markiert eine nicht dicktengleiche Schrift in der Konsolen-Auswahl, ohne sie zu sperren', async () => {
    await zeichne();

    const auswahl = screen.getByLabelText('Konsole, Logs und Adressen');
    const option = within(auswahl).getByText(/Atkinson Hyperlegible \(nicht dicktengleich\)/);

    expect((option as HTMLOptionElement).disabled).toBe(false);
  });

  it('warnt, wenn für die Konsole eine Proportionalschrift gewählt ist', async () => {
    api.fetchInstanceSettings.mockResolvedValue(
      ok(einstellungen({ monospaceFontId: HOCHGELADEN.id })),
    );

    await zeichne();

    expect(
      await screen.findByText(/nicht dicktengleich – Konsolenspalten verrutschen/),
    ).toBeDefined();
  });

  it('holt das Stylesheet neu, damit die Änderung sofort sichtbar wird', async () => {
    await zeichne();

    fireEvent.change(screen.getByLabelText('Oberfläche'), { target: { value: HOCHGELADEN.id } });

    await waitFor(() => {
      expect(api.reloadFontStylesheet).toHaveBeenCalled();
    });
  });
});

describe('Hochladen', () => {
  it('nennt die Regel für den Familiennamen im Formular – vor der Ablehnung', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Schrift hochladen' }));

    const hinweis = await screen.findByText(/ASCII-Buchstaben, Ziffern, einzelne Leerzeichen/);

    expect(hinweis.textContent).toContain('ß');
    expect(hinweis.textContent).toContain('CSS-Regel');
  });

  it('meldet einen unzulässigen Familiennamen schon beim Tippen', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Schrift hochladen' }));
    fireEvent.change(await screen.findByLabelText('Familienname'), {
      target: { value: 'Weißbier' },
    });

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Hochladen' })).toHaveProperty('disabled', true);
  });
});

describe('Fehlermeldungen des Backends', () => {
  const erwartet: ReadonlyArray<[ErrorCode, RegExp]> = [
    ['FONT_FILE_TOO_LARGE', /zu groß/],
    ['FONT_FORMAT_UNSUPPORTED', /Dateiformat wird nicht unterstützt/],
    ['FONT_FILE_INVALID', /passt nicht zu ihrer Endung/],
    ['FONT_FAMILY_TAKEN', /Familiennamen gibt es schon/],
    ['FONT_BUNDLED_PROTECTED', /lassen sich nicht löschen/],
    ['FONT_IN_USE', /gerade ausgewählt/],
    ['FONT_NOT_FOUND', /gibt es nicht mehr/],
  ];

  it.each(erwartet)('übersetzt %s in einen deutschen Satz', (code, muster) => {
    const text = fontErrorMessage(fehler(code));

    expect(text).toMatch(muster);
    // Kein Freitext aus dem Envelope – übersetzt wird allein der Code.
    expect(text).not.toContain('technisch');
  });

  it('zeigt die Meldung im Upload-Dialog statt den Dialog zu schließen', async () => {
    api.uploadFont.mockResolvedValue(fehler('FONT_FAMILY_TAKEN'));
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Schrift hochladen' }));
    fireEvent.change(await screen.findByLabelText('Anzeigename'), { target: { value: 'Inter' } });
    fireEvent.change(screen.getByLabelText('Familienname'), { target: { value: 'Inter' } });
    fireEvent.change(screen.getByLabelText('Schriftdatei'), {
      target: { files: [new File([new Uint8Array([1, 2, 3])], 'inter.woff2')] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));

    expect(await screen.findByText(/Familiennamen gibt es schon/)).toBeDefined();
    expect(screen.getByLabelText('Familienname')).toBeDefined();
  });

  it('meldet den Löschschutz, wenn das Backend ihn erst beim Klick zieht', async () => {
    api.deleteFont.mockResolvedValue(fehler('FONT_IN_USE'));
    await zeichne();

    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }));

    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(dialog.getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(api.deleteFont).toHaveBeenCalledWith(HOCHGELADEN.id);
    });

    expect(await screen.findByText(/gerade ausgewählt/)).toBeDefined();
  });
});
