'use client';

import { type AccountDto, type AuthMethodType } from '@palantir/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Badge, Button, FormMessage, Icon, LogoMark, Panel, formatDate } from '@/components/shared';
import { fetchSession, logout } from '@/lib/auth/api';
import { AuthRequestError, messageForThrown } from '@/lib/auth/errors';
import { AUTH_ROUTES, belongsOnPendingScreen, landingPathForAccount } from '@/lib/auth/routes';

import { AuthHeading } from './AuthHeading';

/**
 * Gast-Wartebildschirm (Lastenheft §2 und §3.1).
 *
 * Jedes frisch registrierte Konto erhält die geschützte Systemrolle „Gast" und
 * hat bis zur Freischaltung durch einen Admin keinerlei Berechtigungen. Diese
 * Ansicht erklärt den Zustand, statt den Nutzer auf eine leere Serverliste oder
 * eine Fehlermeldung laufen zu lassen.
 *
 * Ob gewartet wird, entscheidet ausschließlich `AccountDto.awaitingApproval` aus
 * dem Backend – hier wird nichts aus Rollen oder Permissions hergeleitet
 * (Pflichtenheft §5.2).
 */

/** Beschriftung der verknüpften Anmeldeverfahren – für die Wiedererkennung. */
const AUTH_METHOD_LABEL: Record<AuthMethodType, string> = {
  password: 'Passwort',
  discord: 'Discord',
  twitch: 'Twitch',
  steam: 'Steam',
};

type LoadState =
  { kind: 'loading' } | { kind: 'ready'; account: AccountDto } | { kind: 'error'; message: string };

export function PendingView() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const account = await fetchSession();

      if (!belongsOnPendingScreen(account)) {
        // Freigeschaltet (oder gesperrt) – die Ansicht hat sich erledigt.
        router.replace(landingPathForAccount(account));
        return;
      }
      setState({ kind: 'ready', account });
    } catch (thrown) {
      if (thrown instanceof AuthRequestError && thrown.code === 'AUTH_REQUIRED') {
        router.replace(AUTH_ROUTES.login);
        return;
      }
      setState({ kind: 'error', message: messageForThrown(thrown) });
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function checkAgain() {
    setChecking(true);
    await load();
    setChecking(false);
  }

  async function signOut() {
    try {
      await logout();
    } catch {
      // Auch wenn das Abmelden am Backend scheitert, gehört der Nutzer zurück
      // auf die Anmeldeseite – dort wird ein weiterer Versuch möglich.
    }
    router.replace(AUTH_ROUTES.login);
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <LogoMark size={40} />
        <p className="text-base text-ink-muted">Konto wird geladen …</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <>
        <AuthHeading
          title="Konto konnte nicht geladen werden"
          description="Der Stand deines Kontos ließ sich gerade nicht abrufen."
        />
        <FormMessage>{state.message}</FormMessage>
        <div className="mt-3.5 flex flex-col gap-2.5">
          <Button variant="primary" fullWidth onClick={() => void checkAgain()} disabled={checking}>
            {checking ? 'Wird geprüft …' : 'Erneut versuchen'}
          </Button>
          <Button variant="secondary" fullWidth onClick={() => void signOut()}>
            Abmelden
          </Button>
        </div>
      </>
    );
  }

  const { account } = state;

  return (
    <>
      <AuthHeading
        title={`Hallo ${account.displayName}`}
        description="Dein Konto ist angelegt und wartet auf die Freischaltung durch einen Administrator."
      />

      <Panel variant="raised" className="flex gap-3">
        <Icon name="clock" size={18} className="mt-px shrink-0 text-warning" />
        <div className="text-base text-ink-muted">
          <p>
            Bis dahin hat dein Konto die Rolle <strong className="text-ink">Gast</strong> und noch
            keine Berechtigungen. Sobald jemand dich freischaltet, stehen Serververwaltung, Chat und
            Backups offen – du musst dich dafür nicht neu registrieren.
          </p>
          <p className="mt-2.5">
            Ein Administrator sieht deine Anmeldung in der Warteliste. Ein Hinweis über den üblichen
            Weg (Discord, Sprachchat) beschleunigt das oft.
          </p>
        </div>
      </Panel>

      <Panel variant="outline" className="mt-3.5">
        <dl className="flex flex-col gap-2.5 text-base">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">Benutzername</dt>
            <dd className="font-mono">{account.username ?? '—'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">Registriert am</dt>
            <dd>{formatDate(account.createdAt)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">Rollen</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {account.roles.length === 0 ? (
                <span className="text-ink-faint">—</span>
              ) : (
                account.roles.map((role) => (
                  <Badge key={role.id} tone="neutral">
                    {role.name}
                  </Badge>
                ))
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">Anmeldung über</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              {account.authMethods.length === 0 ? (
                <span className="text-ink-faint">—</span>
              ) : (
                account.authMethods.map((method) => (
                  <Badge key={`${method.type}-${method.linkedAt}`} tone="brand">
                    {method.providerDisplayName ?? AUTH_METHOD_LABEL[method.type]}
                  </Badge>
                ))
              )}
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="mt-5 flex flex-col gap-2.5">
        <Button
          variant="primary"
          fullWidth
          iconLeft="restart"
          onClick={() => void checkAgain()}
          disabled={checking}
        >
          {checking ? 'Wird geprüft …' : 'Freischaltung prüfen'}
        </Button>
        <Button variant="secondary" fullWidth iconLeft="logout" onClick={() => void signOut()}>
          Abmelden
        </Button>
      </div>
    </>
  );
}
