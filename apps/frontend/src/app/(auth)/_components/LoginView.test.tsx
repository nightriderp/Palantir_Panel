import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Anmeldung mit ALTCHA (Arbeitspaket R5, Pflichtenheft §7 und §18).
 *
 * Geprüft wird die Verdrahtung der Ansicht, nicht das Widget selbst: Es steht
 * hier als Test-Double, das den gelösten Nachweis sofort meldet – das Rechnen
 * an der Aufgabe ist in `lib/auth/altcha.test.ts` abgedeckt. Kein Bypass,
 * sondern ein Ersatz an der Modulgrenze (CLAUDE.md §2, wie in B1).
 */

const replace = vi.fn();
const login = vi.fn();

/** Steuert, was das Widget-Double als Nachweis meldet. */
let solvedPayload: string | null = 'geloest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

// Nur der Anmeldeaufruf wird ersetzt; `apiUrl` brauchen die Anbieter-Schaltflächen
// daneben unverändert.
vi.mock('@/lib/auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/api')>()),
  login: (...args: unknown[]) => login(...args) as unknown,
}));

vi.mock('./AltchaWidget', () => ({
  AltchaWidget: ({ onSolved }: { onSolved: (payload: string | null) => void }) => {
    // Wie im echten Widget: die Meldung kommt nach dem Rendern, nicht währenddessen.
    useEffect(() => {
      onSolved(solvedPayload);
    }, [onSolved]);

    return <div data-testid="altcha-double" />;
  },
}));

const { LoginView } = await import('./LoginView');

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alex',
  username: 'alex',
  isOwner: false,
  banned: false,
  awaitingApproval: false,
  twoFactorEnabled: false,
  roles: [],
  authMethods: [],
  createdAt: '2026-08-26T10:00:00.000Z',
  permissions: {},
};

/** Füllt Benutzername und Passwort und schickt das Formular ab. */
function submitCredentials(): void {
  fireEvent.change(screen.getByLabelText('Benutzername'), { target: { value: 'alex' } });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'ein-sehr-langes-passwort' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
}

beforeEach(() => {
  replace.mockReset();
  login.mockReset();
  login.mockResolvedValue({ status: 'authenticated', account: ACCOUNT });
  solvedPayload = 'geloest';
});

describe('LoginView – ALTCHA (Pflichtenheft §7, §18)', () => {
  it('bindet die Sicherheitsprüfung in die Anmeldung ein', () => {
    render(<LoginView />);

    expect(screen.getByTestId('altcha-double')).toBeDefined();
  });

  it('schickt den gelösten Nachweis mit dem Anmeldeversuch mit', async () => {
    render(<LoginView />);
    submitCredentials();

    await waitFor(() => {
      expect(login).toHaveBeenCalledTimes(1);
    });
    expect(login).toHaveBeenCalledWith({
      username: 'alex',
      password: 'ein-sehr-langes-passwort',
      altcha: 'geloest',
    });
  });

  it('schickt ohne gelösten Nachweis gar nicht erst ab', async () => {
    // Ohne Nachweis würde das Backend mit AUTH_CAPTCHA_INVALID antworten; die
    // Ansicht soll das schon vorher am Formular zeigen.
    solvedPayload = null;
    render(<LoginView />);
    submitCredentials();

    await waitFor(() => {
      expect(screen.getByText('Bitte schließe die Sicherheitsprüfung ab.')).toBeDefined();
    });
    expect(login).not.toHaveBeenCalled();
  });
});
