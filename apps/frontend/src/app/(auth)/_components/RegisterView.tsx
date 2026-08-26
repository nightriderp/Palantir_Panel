'use client';

import { type ErrorCode } from '@palantir/contracts';
import { PASSWORD_MIN_LENGTH, registerInputSchema } from '@palantir/validation';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';

import { Button } from '@/components/shared';
import { register } from '@/lib/auth/api';
import { AuthRequestError, isBlockingError, messageForThrown } from '@/lib/auth/errors';
import { AUTH_ROUTES, landingPathForAccount } from '@/lib/auth/routes';

import { AltchaWidget } from './AltchaWidget';
import { AuthField } from './AuthField';
import { AuthFormMessage } from './AuthFormMessage';
import { AuthHeading } from './AuthHeading';
import { AuthDivider, OAuthButtons } from './OAuthButtons';

/**
 * Registrierung eines Passwort-Kontos (Lastenheft §3.1, Referenz-Mockup
 * „Konto erstellen").
 *
 * Die Registrierung ist offen – kein Invite-Zwang. Der Schutz gegen
 * automatisierte Anlage besteht aus dem selbstgehosteten ALTCHA-Widget und dem
 * IP-Rate-Limit im Backend (Pflichtenheft §7).
 */

interface FieldErrors {
  username?: string;
  password?: string;
  displayName?: string;
  altcha?: string;
}

export function RegisterView() {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [altcha, setAltcha] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSolved = useCallback((payload: string | null) => {
    setAltcha(payload);
    if (payload !== null) {
      setFieldErrors((current) => ({ ...current, altcha: undefined }));
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setBlocking(false);

    const parsed = registerInputSchema.safeParse({
      username,
      password,
      // Leeres Feld heißt „aus dem Benutzernamen ableiten" – das Backend
      // übernimmt das, deshalb wird das Feld gar nicht erst mitgeschickt.
      displayName: displayName.trim() === '' ? undefined : displayName,
      altcha: altcha ?? '',
    });

    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        username: flat.username?.[0],
        password: flat.password?.[0],
        displayName: flat.displayName?.[0],
        altcha: flat.altcha?.[0],
      });
      return;
    }
    setFieldErrors({});
    setBusy(true);

    try {
      const account = await register(parsed.data);
      router.replace(landingPathForAccount(account));
    } catch (thrown) {
      const code: ErrorCode | null = thrown instanceof AuthRequestError ? thrown.code : null;
      setFormError(messageForThrown(thrown));
      setBlocking(isBlockingError(code));

      if (code === 'AUTH_USERNAME_TAKEN') {
        setFieldErrors({ username: messageForThrown(thrown) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AuthHeading
        title="Konto erstellen"
        description="Neue Konten starten als Gast, bis ein Administrator sie freischaltet."
      />

      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <AuthField
          label="Benutzername"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={fieldErrors.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="z. B. alex"
        />
        <AuthField
          label="Passwort"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldErrors.password}
          autoComplete="new-password"
          placeholder="••••••••"
          hint={`Mindestens ${PASSWORD_MIN_LENGTH} Zeichen.`}
        />
        <AuthField
          label="Anzeigename (optional)"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={fieldErrors.displayName}
          autoComplete="nickname"
          placeholder="Wird sonst aus dem Benutzernamen abgeleitet"
        />

        <AltchaWidget onSolved={handleSolved} />
        {fieldErrors.altcha ? (
          <p className="-mt-1.5 text-sm text-danger">{fieldErrors.altcha}</p>
        ) : null}

        {formError ? (
          <AuthFormMessage tone={blocking ? 'warning' : 'error'}>{formError}</AuthFormMessage>
        ) : null}

        <Button type="submit" variant="primary" fullWidth disabled={busy}>
          {busy ? 'Konto wird erstellt …' : 'Registrieren'}
        </Button>
      </form>

      <AuthDivider />
      <OAuthButtons />

      <p className="mt-6 text-center text-base text-ink-muted">
        Schon ein Konto? <Link href={AUTH_ROUTES.login}>Anmelden</Link>
      </p>
    </>
  );
}
