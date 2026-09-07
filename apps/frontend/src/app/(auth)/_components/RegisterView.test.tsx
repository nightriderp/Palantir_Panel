import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Registrierung: zweiter Versuch nach einem Fehlschlag (Fundpunkt
 * frontend-app-01, Pflichtenheft §7/R5).
 *
 * Das Backend löst den ALTCHA-Nachweis **vor** der Namensprüfung ein, und ein
 * Nachweis zählt genau einmal. Ohne Rücksetzen des Widgets scheiterte deshalb
 * jeder weitere Versuch nach `AUTH_USERNAME_TAKEN` mit `AUTH_CAPTCHA_INVALID`,
 * obwohl das Widget „bestanden" zeigte – herauszukommen war nur mit einem
 * Neuladen der Seite.
 *
 * Geprüft wird die Verdrahtung der Ansicht, nicht das Widget selbst: Es steht
 * als Test-Double da, das bei **jeder Montage** eine neue Aufgabe holt und löst
 * – genau das tut das echte Widget in seinem Effekt. Kein Bypass, sondern ein
 * Ersatz an der Modulgrenze (CLAUDE.md §2, wie in `LoginView.test.tsx`).
 */

const replace = vi.fn();
const register = vi.fn();

/** Zählt die Montagen des Widget-Doubles – jede steht für eine frische Aufgabe. */
let widgetMounts = 0;
/** Meldet das Double überhaupt einen Nachweis? (`false` = Aufgabe scheitert.) */
let widgetLoest = true;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

// Nur der Registrierungsaufruf wird ersetzt; `apiUrl` brauchen die
// Anbieter-Schaltflächen daneben unverändert.
vi.mock('@/lib/auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/api')>()),
  register: (...args: unknown[]) => register(...args) as unknown,
}));

vi.mock('./AltchaWidget', () => ({
  AltchaWidget: ({ onSolved }: { onSolved: (payload: string | null) => void }) => {
    const [payload, setPayload] = useState<string | null>(null);

    // Wie im echten Widget: Aufgabe holen und lösen passiert beim Montieren,
    // die Meldung kommt danach – nicht während des Renderns.
    useEffect(() => {
      widgetMounts += 1;
      const frisch = widgetLoest ? `nachweis-${widgetMounts}` : null;
      setPayload(frisch);
      onSolved(frisch);
    }, [onSolved]);

    return <div data-testid="altcha-double">{payload ?? 'kein Nachweis'}</div>;
  },
}));

const { RegisterView } = await import('./RegisterView');
const { AuthRequestError } = await import('@/lib/auth/errors');

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alex',
  username: 'alex',
  isOwner: false,
  banned: false,
  awaitingApproval: true,
  twoFactorEnabled: false,
  roles: [],
  authMethods: [],
  createdAt: '2026-08-26T10:00:00.000Z',
  permissions: {},
};

/** Füllt Benutzername und Passwort und schickt das Formular ab. */
function submitRegistration(username = 'alex'): void {
  fireEvent.change(screen.getByLabelText('Benutzername'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Passwort'), {
    target: { value: 'ein-sehr-langes-passwort' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Registrieren' }));
}

beforeEach(() => {
  replace.mockReset();
  register.mockReset();
  register.mockResolvedValue(ACCOUNT);
  widgetMounts = 0;
  widgetLoest = true;
});

describe('RegisterView – zweiter Versuch nach Fehlschlag (Fundpunkt frontend-app-01)', () => {
  it('schickt den gelösten Nachweis mit der Registrierung mit', async () => {
    render(<RegisterView />);
    submitRegistration();

    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(1);
    });
    expect(register).toHaveBeenCalledWith({
      username: 'alex',
      password: 'ein-sehr-langes-passwort',
      displayName: undefined,
      altcha: 'nachweis-1',
    });
  });

  it('holt nach AUTH_USERNAME_TAKEN eine neue Aufgabe und lässt den zweiten Versuch zu', async () => {
    register.mockRejectedValueOnce(
      new AuthRequestError('Benutzername vergeben', 'AUTH_USERNAME_TAKEN'),
    );

    render(<RegisterView />);
    submitRegistration('alex');

    // Der Fehlschlag ist am Feld sichtbar …
    await waitFor(() => {
      expect(
        screen.getAllByText('Dieser Benutzername ist bereits vergeben.').length,
      ).toBeGreaterThan(0);
    });

    // … und das Widget hat sich neu aufgebaut: frische Aufgabe, frischer Nachweis.
    await waitFor(() => {
      expect(screen.getByTestId('altcha-double').textContent).toBe('nachweis-2');
    });
    expect(widgetMounts).toBe(2);

    // Zweiter Versuch ohne Neuladen der Seite – mit dem neuen Nachweis.
    submitRegistration('alex2');

    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(2);
    });
    expect(register).toHaveBeenLastCalledWith({
      username: 'alex2',
      password: 'ein-sehr-langes-passwort',
      displayName: undefined,
      altcha: 'nachweis-2',
    });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('holt auch nach AUTH_CAPTCHA_INVALID eine neue Aufgabe', async () => {
    register.mockRejectedValueOnce(
      new AuthRequestError('Nachweis ungültig', 'AUTH_CAPTCHA_INVALID'),
    );

    render(<RegisterView />);
    submitRegistration();

    await waitFor(() => {
      expect(screen.getByTestId('altcha-double').textContent).toBe('nachweis-2');
    });

    submitRegistration();

    await waitFor(() => {
      expect(register).toHaveBeenCalledTimes(2);
    });
    expect(register).toHaveBeenLastCalledWith(
      expect.objectContaining({ altcha: 'nachweis-2' }) as unknown,
    );
  });

  it('schickt ohne gelösten Nachweis gar nicht erst ab', async () => {
    // Ohne Nachweis würde das Backend mit AUTH_CAPTCHA_INVALID antworten; die
    // Ansicht soll das schon vorher am Formular zeigen.
    widgetLoest = false;
    render(<RegisterView />);
    submitRegistration();

    await waitFor(() => {
      expect(screen.getByText('Bitte schließe die Sicherheitsprüfung ab.')).toBeDefined();
    });
    expect(register).not.toHaveBeenCalled();
  });
});
