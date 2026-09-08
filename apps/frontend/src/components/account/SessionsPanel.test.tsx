import { type SessionDto, defaultMessageForErrorCode } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { AuthRequestError } from '@/lib/auth/errors';
import { SessionsPanel } from './SessionsPanel';

/**
 * Sitzungsverwaltung im Profil (Lastenheft §3.1, Finding spec-lastenheft-01).
 *
 * Geprüft wird die Ansicht, nicht der Transport: `loadSessions`,
 * `revokeSession` und `revokeOtherSessions` sind ersetzt, alles andere –
 * Bestätigungsdialog, Liste, Meldungen – läuft echt.
 */

const api = vi.hoisted(() => ({
  loadSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
}));

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(''),
}));

vi.mock('@/lib/api/session', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSessions: api.loadSessions,
}));

vi.mock('@/lib/auth/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  revokeSession: api.revokeSession,
  revokeOtherSessions: api.revokeOtherSessions,
}));

function sitzung(overrides: Partial<SessionDto> = {}): SessionDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    deviceInfo: 'Firefox auf Windows',
    ipHint: '203.0.113.x',
    createdAt: '2026-09-01T10:00:00.000Z',
    lastUsedAt: '2026-09-06T09:00:00.000Z',
    expiresAt: '2026-10-01T10:00:00.000Z',
    current: false,
    permissions: { canRevoke: true },
    ...overrides,
  };
}

const AKTUELL = sitzung({
  id: '22222222-2222-4222-8222-222222222222',
  deviceInfo: 'Chrome auf Linux',
  current: true,
});

/** Antwort-Envelope, wie ihn `loadSessions` liefert. */
function geladen(sessions: SessionDto[]) {
  return { success: true, data: sessions, error: null };
}

function zeige(): void {
  render(
    <ToastProvider>
      <SessionsPanel />
    </ToastProvider>,
  );
}

/** Wartet, bis die Liste steht. */
async function fertigGeladen(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Sitzungen werden geladen …')).toBeNull();
  });
}

/** Texte aller eingeblendeten Meldungen. */
function meldungen(): string[] {
  return screen.queryAllByRole('status').map((element) => element.textContent ?? '');
}

/** Den offenen Bestätigungsdialog bestätigen. */
function bestaetige(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Abmelden' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  api.revokeSession.mockResolvedValue(null);
  // Das Backend antwortet mit den verbliebenen Sitzungen (Fundpunkt 140).
  api.revokeOtherSessions.mockResolvedValue([AKTUELL]);
});

describe('SessionsPanel – Geräteübersicht', () => {
  it('listet jede Sitzung mit Gerät, Herkunft und letzter Nutzung', async () => {
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, sitzung()]));
    zeige();
    await fertigGeladen();

    expect(screen.getByText('Chrome auf Linux')).toBeTruthy();
    expect(screen.getByText('Firefox auf Windows')).toBeTruthy();
    expect(screen.getAllByText(/Herkunft 203\.0\.113\.x/).length).toBe(2);
  });

  it('markiert die aktuelle Sitzung und bietet auch für sie ein Abmelden an', async () => {
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, sitzung()]));
    zeige();
    await fertigGeladen();

    // Genau eine Zeile trägt die Markierung …
    expect(screen.getAllByText('Dieses Gerät').length).toBe(1);
    // … und behält trotzdem ihren Knopf, weil `permissions.canRevoke` ihn erlaubt.
    const eigener = screen.getByRole('button', { name: 'Abmelden: dieses Gerät' });
    expect(eigener.hasAttribute('disabled')).toBe(false);
  });

  it('sperrt den Knopf, wenn der Vertrag das Abmelden nicht erlaubt', async () => {
    api.loadSessions.mockResolvedValue(
      geladen([AKTUELL, sitzung({ permissions: { canRevoke: false } })]),
    );
    zeige();
    await fertigGeladen();

    expect(
      screen
        .getByRole('button', { name: 'Abmelden: Firefox auf Windows' })
        .hasAttribute('disabled'),
    ).toBe(true);
    // Ohne abmeldbare Fremdsitzung fehlt auch die Sammelaktion.
    expect(screen.queryByRole('button', { name: 'Alle anderen abmelden' })).toBeNull();
  });

  it('zeigt einen Ladefehler an, statt leer zu bleiben', async () => {
    api.loadSessions.mockResolvedValue({
      success: false,
      data: null,
      error: { code: 'NETWORK_UNAVAILABLE', message: 'Das Backend ist gerade nicht erreichbar.' },
    });
    zeige();
    await fertigGeladen();

    expect(screen.getByText('Das Backend ist gerade nicht erreichbar.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nochmal versuchen' })).toBeTruthy();
  });
});

describe('SessionsPanel – Abmelden', () => {
  it('meldet ein fremdes Gerät nach Bestätigung ab und nimmt es aus der Liste', async () => {
    const fremd = sitzung();
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, fremd]));
    zeige();
    await fertigGeladen();

    fireEvent.click(screen.getByRole('button', { name: 'Abmelden: Firefox auf Windows' }));
    // Ohne Bestätigung passiert nichts.
    expect(api.revokeSession).not.toHaveBeenCalled();

    bestaetige();

    await waitFor(() => {
      expect(screen.queryByText('Firefox auf Windows')).toBeNull();
    });
    expect(api.revokeSession).toHaveBeenCalledWith(fremd.id);
    expect(api.revokeSession).toHaveBeenCalledTimes(1);
    // Die eigene Sitzung bleibt stehen.
    expect(screen.getByText('Chrome auf Linux')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('führt nach dem Abmelden der eigenen Sitzung zurück zur Anmeldung', async () => {
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, sitzung()]));
    zeige();
    await fertigGeladen();

    fireEvent.click(screen.getByRole('button', { name: 'Abmelden: dieses Gerät' }));
    bestaetige();

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith('/login');
    });
    expect(api.revokeSession).toHaveBeenCalledWith(AKTUELL.id);
    expect(router.refresh).toHaveBeenCalled();
  });

  /*
   * Fundpunkt 140: Vorher schickte die Aktion ein `DELETE` je Gerät. Jetzt ist
   * es genau ein Aufruf, und die Liste kommt aus dessen Antwort.
   */
  it('beendet mit „Alle anderen abmelden" jede Sitzung außer der aktuellen – mit einem Aufruf', async () => {
    const ersteFremde = sitzung();
    const zweiteFremde = sitzung({
      id: '33333333-3333-4333-8333-333333333333',
      deviceInfo: 'Safari auf iPhone',
    });
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, ersteFremde, zweiteFremde]));
    zeige();
    await fertigGeladen();

    fireEvent.click(screen.getByRole('button', { name: 'Alle anderen abmelden' }));
    // Ohne Bestätigung passiert nichts.
    expect(api.revokeOtherSessions).not.toHaveBeenCalled();

    bestaetige();

    await waitFor(() => {
      expect(screen.queryByText('Firefox auf Windows')).toBeNull();
    });
    expect(screen.queryByText('Safari auf iPhone')).toBeNull();
    expect(screen.getByText('Chrome auf Linux')).toBeTruthy();

    // Genau ein Aufruf – unabhängig davon, wie viele Geräte betroffen sind.
    expect(api.revokeOtherSessions).toHaveBeenCalledTimes(1);
    expect(api.revokeOtherSessions).toHaveBeenCalledWith();
    // Der Einzelpfad bleibt dabei ungenutzt; die eigene Sitzung wird nie angefasst.
    expect(api.revokeSession).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(meldungen().some((text) => text.includes('2 Geräte wurden abgemeldet.'))).toBe(true);
  });

  it('meldet einen Fehlschlag und lässt die Sitzung in der Liste stehen', async () => {
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, sitzung()]));
    api.revokeSession.mockRejectedValue(
      new AuthRequestError('session not found', 'AUTH_SESSION_NOT_FOUND'),
    );
    zeige();
    await fertigGeladen();

    fireEvent.click(screen.getByRole('button', { name: 'Abmelden: Firefox auf Windows' }));
    bestaetige();

    await waitFor(() => {
      expect(
        meldungen().some((text) =>
          text.includes(defaultMessageForErrorCode('AUTH_SESSION_NOT_FOUND')),
        ),
      ).toBe(true);
    });
    // Kein Absturz, und die Zeile verschwindet nicht auf Verdacht.
    expect(screen.getByText('Firefox auf Windows')).toBeTruthy();
  });

  it('meldet einen Fehlschlag der Sammelaktion und lässt die ganze Liste stehen', async () => {
    /*
     * Der Vorgang ist jetzt atomar: Scheitert er, hat das Backend nichts
     * widerrufen – dann darf auch keine Zeile verschwinden. Vorher konnte ein
     * Teil durchgehen und der Rest sichtbar stehen bleiben.
     */
    const zweiteFremde = sitzung({
      id: '33333333-3333-4333-8333-333333333333',
      deviceInfo: 'Safari auf iPhone',
    });
    api.loadSessions.mockResolvedValue(geladen([AKTUELL, sitzung(), zweiteFremde]));
    api.revokeOtherSessions.mockRejectedValue(
      new AuthRequestError('session not found', 'AUTH_SESSION_NOT_FOUND'),
    );
    zeige();
    await fertigGeladen();

    fireEvent.click(screen.getByRole('button', { name: 'Alle anderen abmelden' }));
    bestaetige();

    await waitFor(() => {
      expect(
        meldungen().some((text) =>
          text.includes(defaultMessageForErrorCode('AUTH_SESSION_NOT_FOUND')),
        ),
      ).toBe(true);
    });
    expect(screen.getByText('Firefox auf Windows')).toBeTruthy();
    expect(screen.getByText('Safari auf iPhone')).toBeTruthy();
    expect(screen.getByText('Chrome auf Linux')).toBeTruthy();
  });
});
