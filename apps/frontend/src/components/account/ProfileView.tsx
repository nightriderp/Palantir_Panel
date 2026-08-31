'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type AccountDto, type AuthMethodType, type LinkedAuthMethod } from '@palantir/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  DangerConfirmDialog,
  Icon,
  PageHeader,
  Panel,
  formatDate,
  useToast,
} from '@/components/shared';
import { OAUTH_PROVIDER_META } from '@/lib/auth/providers';
import { AUTH_ENDPOINTS, apiUrl, deleteAccount, unlinkMethod } from '@/lib/auth/api';
import { messageForThrown } from '@/lib/auth/errors';
import { loadAccount } from '@/lib/api/session';
import { useApiResource } from '@/lib/api/useApiResource';
import { AUTH_METHOD_LABEL, linkableProviders, methodDetail } from './methods';

/** Rücksprungziel für die Provider-Verknüpfung – muss zur Backend-Allowlist passen. */
const RETURN_TO = '/profil';

/**
 * Profil-Seite (Lastenheft §3.1).
 *
 * Zeigt die Kontodaten und verwaltet die verknüpften Anmeldeverfahren: Discord,
 * Twitch und Steam lassen sich hier nachträglich verbinden oder wieder trennen.
 * Das Verbinden ist eine echte Weiterleitung zum Anbieter (kein `fetch`); nach
 * der Rückkehr landet man über `returnTo` wieder hier.
 */
export function ProfileView() {
  const { data: account, loading, error, setData } = useApiResource(() => loadAccount(), []);
  const toast = useToast();
  const searchParams = useSearchParams();

  // Rückmeldung der Provider-Rückkehr (?linked=… / ?error=…) einmalig anzeigen.
  useEffect(() => {
    const linked = searchParams.get('linked');
    const failed = searchParams.get('error');
    if (linked) {
      toast.success(`${AUTH_METHOD_LABEL[linked as AuthMethodType] ?? linked} wurde verknüpft.`);
    } else if (failed) {
      toast.error('Die Verknüpfung ist fehlgeschlagen. Bitte versuche es erneut.');
    }
    // Bewusst nur beim ersten Rendern: die Query ändert sich hier nicht weiter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <PageHeader title="Profil" subtitle="Dein Konto und die verknüpften Anmeldeverfahren." />

      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-5">
        {loading ? (
          <p className="text-base text-ink-muted">Konto wird geladen …</p>
        ) : error ? (
          <p className="text-base text-danger">{error}</p>
        ) : account ? (
          <>
            <Panel>
              <div className="flex items-start justify-between gap-4">
                <span
                  aria-hidden
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-soft text-4xl font-bold text-brand"
                >
                  {account.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-xl font-semibold text-ink">{account.displayName}</h2>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {account.username ? `@${account.username}` : 'Kein Passwort-Login eingerichtet'}
                  </p>
                </div>
                {account.isOwner ? <Badge tone="brand">Owner</Badge> : null}
              </div>

              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-ink-faint">Rollen</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {account.roles.length > 0 ? (
                      account.roles.map((role) => (
                        <Badge key={role.id} tone="neutral">
                          {role.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-ink-faint">keine</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-2xs uppercase tracking-wide text-ink-faint">Mitglied seit</dt>
                  <dd className="mt-1 text-base text-ink-muted">{formatDate(account.createdAt)}</dd>
                </div>
              </dl>
            </Panel>

            <LinkedMethodsPanel
              methods={account.authMethods}
              onUnlinked={(updated) => setData(updated)}
            />

            <DeleteAccountPanel account={account} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function LinkedMethodsPanel({
  methods,
  onUnlinked,
}: {
  methods: LinkedAuthMethod[];
  onUnlinked: (account: Awaited<ReturnType<typeof unlinkMethod>>) => void;
}) {
  const toast = useToast();
  const [pendingUnlink, setPendingUnlink] = useState<AuthMethodType | null>(null);
  const [busy, setBusy] = useState(false);

  const openable = linkableProviders(methods);

  async function confirmUnlink() {
    if (pendingUnlink === null) {
      return;
    }
    setBusy(true);
    try {
      const updated = await unlinkMethod(pendingUnlink);
      onUnlinked(updated);
      toast.success(`${AUTH_METHOD_LABEL[pendingUnlink]} wurde getrennt.`);
      setPendingUnlink(null);
    } catch (error) {
      toast.error(messageForThrown(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="text-xl font-semibold text-ink">Anmeldeverfahren</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        Verbinde weitere Konten, um dich damit anzumelden. Das letzte verbliebene Verfahren lässt
        sich nicht trennen.
      </p>

      <ul className="mt-4 flex flex-col divide-y divide-line">
        {methods.map((method) => (
          <li key={method.type} className="flex items-center gap-3 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fill-strong text-ink-muted">
              <Icon name={method.type === 'password' ? 'key' : 'user'} size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base text-ink">{AUTH_METHOD_LABEL[method.type]}</p>
              <p className="truncate text-xs text-ink-faint">
                {methodDetail(method) ?? 'aktiv'} · seit {formatDate(method.linkedAt)}
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              iconLeft="close"
              disabled={method.canUnlink !== true}
              onClick={() => setPendingUnlink(method.type)}
            >
              Trennen
            </Button>
          </li>
        ))}

        {/* Noch nicht verbundene Anbieter stehen in derselben Liste wie die
            verknüpften – eine Zeile je Verfahren, wie im Mockup. Vorher waren
            es breite Knöpfe in den Farben der Anbieter; nebeneinander sah das
            aus, als wären es zwei verschiedene Dinge. */}
        {openable.map((provider) => {
          const meta = OAUTH_PROVIDER_META[provider];
          return (
            <li key={provider} className="flex items-center gap-3 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-fill-strong text-ink-faint">
                <Icon name={meta.icon} size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base text-ink">{AUTH_METHOD_LABEL[provider]}</p>
                <p className="text-xs text-ink-faint">nicht verbunden</p>
              </div>
              <a
                href={apiUrl(AUTH_ENDPOINTS.oauthStart(provider, RETURN_TO))}
                rel="nofollow"
                className="shrink-0 rounded-md border border-line-strong bg-fill px-3 py-1.5 text-sm font-semibold text-ink no-underline hover:brightness-110"
              >
                Verbinden
              </a>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-xs text-ink-faint">
        Ein Passwort-Login lässt sich unter{' '}
        <Link href="/einstellungen" className="text-brand no-underline hover:text-brand-bright">
          Einstellungen
        </Link>{' '}
        einrichten oder ändern.
      </p>

      <ConfirmDialog
        open={pendingUnlink !== null}
        onClose={() => (busy ? undefined : setPendingUnlink(null))}
        title="Anmeldeverfahren trennen"
        message={
          pendingUnlink
            ? `${AUTH_METHOD_LABEL[pendingUnlink]} wird von deinem Konto getrennt. Du kannst es später erneut verbinden.`
            : ''
        }
        confirmLabel="Trennen"
        onConfirm={confirmUnlink}
        busy={busy}
      />
    </Panel>
  );
}

/**
 * „Konto löschen" (Mockup, Lastenheft §3.1).
 *
 * Endgültig: Bestätigt wird mit der Anmeldekennung, und wo ein Passwort-Login
 * besteht, verlangt das Backend zusätzlich das Passwort. Das Owner-Konto lässt
 * sich nicht löschen (`AUTH_OWNER_PROTECTED`) – statt eines Knopfes, der
 * immer scheitert, steht dort der Grund.
 */
function DeleteAccountPanel({ account }: { account: AccountDto }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const needsPassword = account.authMethods.some((method) => method.type === 'password');
  // Bestätigt wird mit der Kennung; reine Provider-Konten haben keine und
  // bestätigen deshalb mit dem Anzeigenamen – dieselbe Regel wie im Backend.
  const confirmName = account.username ?? account.displayName;

  async function confirm() {
    setBusy(true);
    try {
      await deleteAccount({
        confirmName,
        ...(needsPassword ? { password } : {}),
      });
      toast.success('Dein Konto wurde gelöscht.');
      router.push('/login');
    } catch (thrown) {
      toast.error(messageForThrown(thrown));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className="border-danger-line bg-danger-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-md font-semibold text-danger">Konto löschen</h2>
          <p className="mt-0.5 text-sm text-ink-muted">Kann nicht rückgängig gemacht werden.</p>
        </div>

        {account.isOwner ? (
          <p className="text-sm text-ink-faint">Das Owner-Konto lässt sich nicht löschen.</p>
        ) : (
          <Button variant="danger" onClick={() => setOpen(true)}>
            Löschen
          </Button>
        )}
      </div>

      <DangerConfirmDialog
        open={open}
        onClose={() => (busy ? undefined : setOpen(false))}
        busy={busy}
        title="Konto löschen?"
        confirmationPhrase={confirmName}
        extraBlocked={needsPassword && password.length === 0}
        message="Dein Konto wird endgültig gelöscht, mit allen Anmeldeverfahren und Rollen. Server, die dir gehören, musst du vorher selbst entfernen."
        extra={
          needsPassword ? (
            <label className="block text-sm text-ink-muted">
              Zur Sicherheit dein Passwort:
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                className="mt-2 w-full rounded-md border border-line-strong bg-fill px-3 py-2.5 text-base text-ink outline-none focus-visible:border-brand"
              />
            </label>
          ) : null
        }
        onConfirm={() => void confirm()}
      />
    </Panel>
  );
}
