import { type AccountDto, type AnnouncementDto, type GlobalPermissions } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { AnnouncementsView } from './AnnouncementsView';

/**
 * Ankündigungen – Ablaufdatum in der Zeitzone des Browsers (Fundpunkt 139).
 *
 * Derselbe Fehler, den W2-22 für das Audit-Log behoben hat, stand hier ein
 * zweites Mal: `${expiresDay}T23:59:59.999Z` von Hand für den Hinweg und
 * `iso.slice(0, 10)` für den Rückweg. Beides in UTC.
 *
 * Geprüft wird deshalb beides und unter mehreren Zeitzonen: dass das gewählte
 * Ablaufdatum als **lokales** Tagesende gesendet wird, und dass ein bereits
 * gespeichertes Ablaufdatum beim Bearbeiten wieder als derselbe Kalendertag im
 * Feld steht – sonst schöbe schon das bloße Öffnen und Speichern das Datum um
 * einen Tag.
 */

const api = vi.hoisted(() => ({
  fetchAnnouncements: vi.fn(),
  createAnnouncement: vi.fn(),
  updateAnnouncement: vi.fn(),
}));
const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null }));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: sitzung.account, loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAnnouncements: api.fetchAnnouncements,
  createAnnouncement: api.createAnnouncement,
  updateAnnouncement: api.updateAnnouncement,
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

function ankuendigung(overrides: Partial<AnnouncementDto> = {}): AnnouncementDto {
  return {
    id: 'ank-1',
    title: 'Wartung',
    body: 'Kurze Wartung heute Abend.',
    severity: 'info',
    publishedByUserId: 'admin-1',
    publishedByDisplayName: 'Admina',
    publishedAt: '2026-08-30T10:00:00.000Z',
    expiresAt: null,
    recipientCount: 12,
    createdAt: '2026-08-30T10:00:00.000Z',
    updatedAt: '2026-08-30T10:00:00.000Z',
    permissions: { canEdit: true, canDelete: true },
    ...overrides,
  };
}

function ok<T>(data: T) {
  return { success: true as const, data, error: null };
}

/** Zeitzone des Testlaufs umstellen – Node wertet `process.env.TZ` neu aus. */
function mitZeitzone(zone: string): () => void {
  const vorher = process.env.TZ;
  process.env.TZ = zone;
  return () => {
    process.env.TZ = vorher;
  };
}

async function zeichne() {
  render(
    <ToastProvider>
      <AnnouncementsView />
    </ToastProvider>,
  );
  await screen.findByRole('button', { name: 'Neue Ankündigung' });
}

/** Neue Ankündigung mit Ablaufdatum anlegen und den gesendeten Rumpf liefern. */
async function veroeffentlicheMitAblauf(tag: string): Promise<{ expiresAt: string | null }> {
  await zeichne();

  fireEvent.click(screen.getByRole('button', { name: 'Neue Ankündigung' }));
  fireEvent.change(await screen.findByLabelText('Titel'), { target: { value: 'Wartung' } });
  fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Kurze Wartung.' } });
  fireEvent.change(screen.getByLabelText('Ablaufdatum (optional)'), { target: { value: tag } });
  fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

  await waitFor(() => {
    expect(api.createAnnouncement).toHaveBeenCalled();
  });

  return api.createAnnouncement.mock.calls[0]?.[0] as { expiresAt: string | null };
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();

  api.fetchAnnouncements.mockResolvedValue(ok([]));
  api.createAnnouncement.mockResolvedValue(ok(ankuendigung()));
  api.updateAnnouncement.mockResolvedValue(ok(ankuendigung()));

  sitzung.account = konto(berechtigungen({ canManageNotifications: true }));
});

describe('Ankündigungen – Ablaufdatum lokal (Fundpunkt 139)', () => {
  it('sendet das Ende des gewählten Kalendertags in der Zeitzone des Browsers', async () => {
    const rumpf = await veroeffentlicheMitAblauf('2026-09-01');
    const ablauf = new Date(String(rumpf.expiresAt));

    expect(ablauf.getFullYear()).toBe(2026);
    expect(ablauf.getMonth()).toBe(8);
    expect(ablauf.getDate()).toBe(1);
    expect(ablauf.getHours()).toBe(23);
    expect(ablauf.getMinutes()).toBe(59);
    expect(ablauf.getSeconds()).toBe(59);
    expect(ablauf.getMilliseconds()).toBe(999);
  });

  it('lässt eine Ankündigung ohne Ablaufdatum unbefristet', async () => {
    await zeichne();

    fireEvent.click(screen.getByRole('button', { name: 'Neue Ankündigung' }));
    fireEvent.change(await screen.findByLabelText('Titel'), { target: { value: 'Wartung' } });
    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Kurze Wartung.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Veröffentlichen' }));

    await waitFor(() => {
      expect(api.createAnnouncement).toHaveBeenCalled();
    });

    expect(
      (api.createAnnouncement.mock.calls[0]?.[0] as { expiresAt: string | null }).expiresAt,
    ).toBeNull();
  });
});

describe('Ankündigungen in Europe/Berlin (Sommerzeit)', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('Europe/Berlin');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  it('sendet 21:59:59.999 Uhr UTC statt eines angehängten „Z"', async () => {
    const rumpf = await veroeffentlicheMitAblauf('2026-09-01');

    expect(rumpf.expiresAt).toBe('2026-09-01T21:59:59.999Z');
  });

  it('stellt ein gespeichertes Ablaufdatum unverändert ins Feld zurück', async () => {
    api.fetchAnnouncements.mockResolvedValue(
      ok([ankuendigung({ expiresAt: '2026-09-01T21:59:59.999Z' })]),
    );
    await zeichne();

    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    const feld = await screen.findByLabelText('Ablaufdatum (optional)');
    expect((feld as HTMLInputElement).value).toBe('2026-09-01');
  });
});

describe('Ankündigungen westlich von Greenwich (America/New_York)', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('America/New_York');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  /*
   * Die Gegenprobe zu Berlin: Hier liegt das lokale Tagesende nach UTC im
   * Folgetag. Ein abgeschnittener Zeitstempel (`iso.slice(0, 10)`) hätte den
   * 2.9. ins Feld geschrieben – das Datum wanderte beim Bearbeiten weiter.
   */
  it('sendet das Tagesende als Zeitstempel des Folgetags', async () => {
    const rumpf = await veroeffentlicheMitAblauf('2026-09-01');

    expect(rumpf.expiresAt).toBe('2026-09-02T03:59:59.999Z');
  });

  it('liest daraus im Formular trotzdem wieder den 1.9.', async () => {
    api.fetchAnnouncements.mockResolvedValue(
      ok([ankuendigung({ expiresAt: '2026-09-02T03:59:59.999Z' })]),
    );
    await zeichne();

    fireEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    const feld = await screen.findByLabelText('Ablaufdatum (optional)');
    expect((feld as HTMLInputElement).value).toBe('2026-09-01');
  });
});
