import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rückmeldung der Provider-Rückkehr auf dem Profil (Fundpunkt frontend-lib-11).
 *
 * `/profil?linked=discord` ist das Ziel nach einer erfolgreichen Verknüpfung.
 * Der Wert kommt aus der Adresszeile und landete ungeprüft im grünen
 * Erfolgs-Toast – ein verschickter Link konnte damit beliebigen Text in der
 * eigenen Oberfläche aussprechen (Content-Spoofing; React maskiert, also kein
 * XSS). Geprüft wird hier die Ansicht, nicht die reine Zuordnung – die steht in
 * `methods.test.ts`.
 */

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alex',
  username: 'alex',
  isOwner: false,
  banned: false,
  awaitingApproval: false,
  twoFactorEnabled: false,
  roles: [],
  authMethods: [
    { type: 'password', providerDisplayName: null, linkedAt: '2026-08-01T00:00:00.000Z' },
  ],
  createdAt: '2026-08-26T10:00:00.000Z',
  permissions: {},
};

let query = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => query,
}));

// Nur die Ladefunktionen werden ersetzt; alles andere an der Ansicht bleibt
// echt. `loadSessions` gehört dazu, seit das Profil auch die angemeldeten
// Geräte zeigt – ohne den Eintrag liefe der Abschnitt hier in einen echten
// `fetch`.
vi.mock('@/lib/api/session', () => ({
  loadAccount: () => Promise.resolve({ success: true, data: ACCOUNT, error: null }),
  loadSessions: () => Promise.resolve({ success: true, data: [], error: null }),
  BASE_DOMAIN: 'example.tld',
}));

const { ToastProvider } = await import('@/components/shared');
const { ProfileView } = await import('./ProfileView');

function zeigeProfil(): void {
  render(
    <ToastProvider>
      <ProfileView />
    </ToastProvider>,
  );
}

/** Wartet, bis das Konto geladen ist und die Abschnitte stehen. */
async function geladen(): Promise<void> {
  await waitFor(() => {
    expect(screen.queryByText('Konto wird geladen …')).toBeNull();
  });
}

/** Texte aller eingeblendeten Meldungen. */
function meldungen(): string[] {
  return screen.queryAllByRole('status').map((element) => element.textContent ?? '');
}

beforeEach(() => {
  query = new URLSearchParams();
});

describe('ProfileView – Rückmeldung aus ?linked= (Fundpunkt frontend-lib-11)', () => {
  it('bestätigt eine Verknüpfung mit der Beschriftung aus AUTH_METHOD_LABEL', async () => {
    query = new URLSearchParams('linked=discord');
    zeigeProfil();

    await waitFor(() => {
      expect(meldungen().some((text) => text.includes('Discord wurde verknüpft.'))).toBe(true);
    });
  });

  it('zeigt bei einem untergeschobenen Freitext gar keine Meldung', async () => {
    query = new URLSearchParams('linked=Dein Konto wurde gesperrt, melde dich unter boese.tld');
    zeigeProfil();

    // Die Ansicht muss trotzdem laufen …
    await geladen();
    // … und darf den fremden Satz nirgends aussprechen.
    expect(meldungen()).toEqual([]);
    expect(screen.queryByText(/boese\.tld/)).toBeNull();
  });

  it('meldet einen gescheiterten Rücklauf mit festem Text, ohne den Code zu zeigen', async () => {
    query = new URLSearchParams('error=AUTH_METHOD_ALREADY_LINKED');
    zeigeProfil();

    await waitFor(() => {
      expect(meldungen().some((text) => text.includes('Die Verknüpfung ist fehlgeschlagen.'))).toBe(
        true,
      );
    });
    expect(screen.queryByText(/AUTH_METHOD_ALREADY_LINKED/)).toBeNull();
  });

  it('zeigt ohne Query keine Meldung', async () => {
    zeigeProfil();

    await geladen();
    expect(meldungen()).toEqual([]);
  });
});
