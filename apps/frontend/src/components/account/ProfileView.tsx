'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type AuthMethodType, type LinkedAuthMethod } from '@palantir/contracts';
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  PageHeader,
  Panel,
  formatDate,
  useToast,
} from '@/components/shared';
import { OAUTH_PROVIDER_META } from '@/lib/auth/providers';
import { AUTH_ENDPOINTS, apiUrl, unlinkMethod } from '@/lib/auth/api';
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
                <div className="min-w-0">
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
      </ul>

      {openable.length > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-2xs uppercase tracking-wide text-ink-faint">Weitere verbinden</p>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {openable.map((provider) => {
              const meta = OAUTH_PROVIDER_META[provider];
              return (
                <a
                  key={provider}
                  href={apiUrl(AUTH_ENDPOINTS.oauthStart(provider, RETURN_TO))}
                  rel="nofollow"
                  className="flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-base font-semibold no-underline hover:brightness-110"
                  style={{ backgroundColor: meta.brandColor, color: meta.textColor }}
                >
                  <Icon name={meta.icon} size={14} />
                  {AUTH_METHOD_LABEL[provider]} verbinden
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

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
