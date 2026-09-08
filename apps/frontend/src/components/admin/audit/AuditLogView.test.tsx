import { type AccountDto, type GlobalPermissions } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditLogView } from './AuditLogView';

/**
 * Audit-Fundstelle frontend-lib-07, nachgezogen mit Fundpunkt 139.
 *
 * Die Tagesgrenzen der Filter „Ab"/„Bis" lagen ursprünglich in UTC: Ein Admin
 * in Berlin (CEST), der auf „Ab 01.09. Bis 01.09." filterte, verlor die ersten
 * zwei Stunden des gewählten Tages und bekam dafür Einträge des Folgetages.
 *
 * Die reine Rechnung dahinter prüft `components/shared/utils/dayRange.test.ts` –
 * dort liegen die Helfer seit Fundpunkt 139. **Hier** wird geprüft, dass diese
 * Ansicht sie weiter benutzt: dass also genau die lokale Tagesgrenze in der
 * Abfrage landet und nicht wieder ein angehängtes `Z`.
 */

const api = vi.hoisted(() => ({ fetchAuditLog: vi.fn() }));
const sitzung = vi.hoisted(() => ({ account: null as AccountDto | null }));

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: sitzung.account, loading: false, setUser: () => undefined }),
}));

vi.mock('@/lib/api/admin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchAuditLog: api.fetchAuditLog,
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

/** Zeitzone des Testlaufs umstellen – Node wertet `process.env.TZ` neu aus. */
function mitZeitzone(zone: string): () => void {
  const vorher = process.env.TZ;
  process.env.TZ = zone;
  return () => {
    process.env.TZ = vorher;
  };
}

/** Die zuletzt gestellte Abfrage – das, was die Ansicht ans Backend schickt. */
function letzteAbfrage(): { from?: string; to?: string } {
  const aufrufe = api.fetchAuditLog.mock.calls;

  return (aufrufe[aufrufe.length - 1]?.[0] ?? {}) as { from?: string; to?: string };
}

/** Rendert die Ansicht und setzt beide Datumsfelder auf denselben Tag. */
async function filtereAufDen(tag: string) {
  render(<AuditLogView />);

  fireEvent.change(screen.getByLabelText('Ab'), { target: { value: tag } });
  fireEvent.change(screen.getByLabelText('Bis'), { target: { value: tag } });

  await waitFor(() => {
    expect(letzteAbfrage().to).toBeDefined();
  });
}

beforeEach(() => {
  api.fetchAuditLog.mockReset();
  api.fetchAuditLog.mockResolvedValue({
    success: true as const,
    data: { entries: [], total: 0, limit: 50, offset: 0 },
    error: null,
  });
  sitzung.account = konto(berechtigungen({ canViewAuditLog: true }));
});

describe('Audit-Log – Tagesgrenzen in der Zeitzone des Browsers (frontend-lib-07)', () => {
  it('schickt einen vollen Kalendertag – Anfang wie Ende lokal', async () => {
    await filtereAufDen('2026-09-01');

    const { from, to } = letzteAbfrage();
    const von = new Date(String(from));
    const bis = new Date(String(to));

    expect(von.getDate()).toBe(1);
    expect(von.getHours()).toBe(0);
    expect(bis.getDate()).toBe(1);
    expect(bis.getHours()).toBe(23);
    expect(bis.getTime() - von.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('stellt ohne Datumsangabe gar keine Grenze', async () => {
    render(<AuditLogView />);

    await waitFor(() => {
      expect(api.fetchAuditLog).toHaveBeenCalled();
    });

    expect(letzteAbfrage().from).toBeUndefined();
    expect(letzteAbfrage().to).toBeUndefined();
  });

  it('bleibt ohne `canViewAuditLog` stumm', () => {
    sitzung.account = konto(berechtigungen());
    render(<AuditLogView />);

    expect(screen.getByText('Kein Zugriff'));
    expect(api.fetchAuditLog).not.toHaveBeenCalled();
  });
});

describe('Audit-Log in Europe/Berlin – die Fundstelle selbst', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('Europe/Berlin');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  it('schickt 22:00 Uhr UTC des Vortags statt eines angehängten „Z"', async () => {
    await filtereAufDen('2026-09-01');

    expect(letzteAbfrage().from).toBe('2026-08-31T22:00:00.000Z');
    expect(letzteAbfrage().to).toBe('2026-09-01T21:59:59.999Z');
  });
});

describe('Audit-Log in UTC', () => {
  let zuruecksetzen: () => void;

  beforeAll(() => {
    zuruecksetzen = mitZeitzone('UTC');
  });

  afterAll(() => {
    zuruecksetzen();
  });

  it('bleibt in UTC beim bisherigen Ergebnis', async () => {
    await filtereAufDen('2026-09-01');

    expect(letzteAbfrage().from).toBe('2026-09-01T00:00:00.000Z');
    expect(letzteAbfrage().to).toBe('2026-09-01T23:59:59.999Z');
  });
});
