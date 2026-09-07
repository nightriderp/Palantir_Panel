import { ERROR_CATALOG } from '@palantir/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthRequestError } from '@/lib/auth/errors';

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
const verifyTwoFactor = vi.fn();

/** Steuert, was das Widget-Double als Nachweis meldet. */
let solvedPayload: string | null = 'geloest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

// Nur die beiden Anmeldeaufrufe werden ersetzt; `apiUrl` brauchen die
// Anbieter-Schaltflächen daneben unverändert.
vi.mock('@/lib/auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/api')>()),
  login: (...args: unknown[]) => login(...args) as unknown,
  verifyTwoFactor: (...args: unknown[]) => verifyTwoFactor(...args) as unknown,
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

/** Schickt den 2FA-Code des zweiten Schritts ab. */
function submitCode(code: string): void {
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
}

/**
 * Erster Schritt mit aktivierter 2FA – danach steht die Ansicht auf „Bestätigung".
 *
 * Der Zwischen-Token lebt nur im Speicher der Ansicht (Pflichtenheft §7); dass
 * er von hier bis in den zweiten Aufruf durchgereicht wird, ist der Punkt.
 */
async function reachTwoFactorStep(twoFactorToken = 'zwischen-token'): Promise<void> {
  login.mockResolvedValue({ status: 'two_factor_required', twoFactorToken });
  render(<LoginView />);
  submitCredentials();

  await waitFor(() => {
    expect(screen.getByText('Bestätigung')).toBeDefined();
  });
}

beforeEach(() => {
  replace.mockReset();
  login.mockReset();
  login.mockResolvedValue({ status: 'authenticated', account: ACCOUNT });
  verifyTwoFactor.mockReset();
  verifyTwoFactor.mockResolvedValue(ACCOUNT);
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

/**
 * Zweiter Anmeldeschritt (Audit W3-12, `frontend-app-10` / `test-gaps-06`).
 *
 * Der Schritt ist ein Auth-Flow im Sinne von CLAUDE.md §4 und war bisher ohne
 * Test: Der Zwischen-Token aus dem ersten Schritt liegt nur im Speicher der
 * Ansicht, und ob er unverändert im zweiten Aufruf landet, hing an nichts.
 */
describe('LoginView – zweiter Schritt (Pflichtenheft §7)', () => {
  it('wechselt nach two_factor_required auf die Code-Eingabe, ohne weiterzuleiten', async () => {
    await reachTwoFactorStep();

    expect(screen.getByLabelText('Code')).toBeDefined();
    // Erst der bestätigte Code führt weiter – der erste Schritt allein nicht.
    expect(replace).not.toHaveBeenCalled();
    expect(verifyTwoFactor).not.toHaveBeenCalled();
  });

  it('schickt den Zwischen-Token aus dem ersten Schritt mit dem Code mit', async () => {
    await reachTwoFactorStep('zwischen-token-42');
    submitCode('123456');

    await waitFor(() => {
      expect(verifyTwoFactor).toHaveBeenCalledTimes(1);
    });
    expect(verifyTwoFactor).toHaveBeenCalledWith({
      twoFactorToken: 'zwischen-token-42',
      code: '123456',
    });
  });

  it('leitet nach bestätigtem Code auf das Dashboard weiter', async () => {
    await reachTwoFactorStep();
    submitCode('123456');

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith('/servers');
    });
  });

  it('schickt einen zu kurzen Code gar nicht erst ab', async () => {
    // `twoFactorInputSchema` prüft die Länge; ohne die Vorprüfung liefe jeder
    // Vertipper gegen das gemeinsame Rate-Limit von Login und zweitem Schritt.
    await reachTwoFactorStep();
    submitCode('12');

    await waitFor(() => {
      expect(screen.getByLabelText('Code')).toBeDefined();
    });
    expect(verifyTwoFactor).not.toHaveBeenCalled();
  });

  it('bleibt bei falschem Code im zweiten Schritt stehen und zeigt die Meldung', async () => {
    await reachTwoFactorStep();
    verifyTwoFactor.mockRejectedValue(new AuthRequestError('roh', 'AUTH_TWO_FACTOR_INVALID'));
    submitCode('000000');

    // Angezeigt wird der Katalogtext zum Code, nicht die rohe Meldung – der
    // Katalog ist die eine Stelle, an der die deutschen Sätze stehen.
    await waitFor(() => {
      expect(screen.getByText(ERROR_CATALOG.AUTH_TWO_FACTOR_INVALID.defaultMessage)).toBeDefined();
    });
    // Ein Rückwurf auf den ersten Schritt würde den Zwischen-Token verwerfen,
    // obwohl er noch gilt – der Nutzer müsste sein Passwort erneut eingeben.
    expect(screen.getByLabelText('Code')).toBeDefined();
    expect(replace).not.toHaveBeenCalled();
  });

  it('beginnt bei abgelaufenem Zwischen-Token wieder von vorn', async () => {
    // `AUTH_TWO_FACTOR_EXPIRED` ist der einzige Code, der den Neustart auslöst
    // (`shouldRestartLogin`): Der Token ist weg, ein zweiter Code hilft nicht.
    await reachTwoFactorStep();
    verifyTwoFactor.mockRejectedValue(new AuthRequestError('roh', 'AUTH_TWO_FACTOR_EXPIRED'));
    submitCode('123456');

    await waitFor(() => {
      expect(screen.getByLabelText('Benutzername')).toBeDefined();
    });
    expect(screen.queryByLabelText('Code')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('führt „Zurück" auf den ersten Schritt und verwirft den Zwischen-Token', async () => {
    await reachTwoFactorStep();
    fireEvent.click(screen.getByRole('button', { name: '← Zurück' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Benutzername')).toBeDefined();
    });

    /*
     * Ohne verworfenen Token bliebe ein alter Zwischen-Token liegen und der
     * nächste Anmeldeversuch bestätigte ihn statt des neuen.
     */
    login.mockResolvedValue({
      status: 'two_factor_required',
      twoFactorToken: 'zwischen-token-neu',
    });
    submitCredentials();

    await waitFor(() => {
      expect(screen.getByLabelText('Code')).toBeDefined();
    });
    submitCode('123456');

    await waitFor(() => {
      expect(verifyTwoFactor).toHaveBeenCalledWith({
        twoFactorToken: 'zwischen-token-neu',
        code: '123456',
      });
    });
  });
});
