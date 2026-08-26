'use client';

import { type ErrorCode } from '@palantir/contracts';
import { loginInputSchema, twoFactorInputSchema } from '@palantir/validation';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, FormMessage, TextField } from '@/components/shared';
import { login, verifyTwoFactor } from '@/lib/auth/api';
import {
  AuthRequestError,
  isBlockingError,
  messageForErrorCode,
  messageForThrown,
  shouldRestartLogin,
} from '@/lib/auth/errors';
import { AUTH_ROUTES, landingPathForAccount } from '@/lib/auth/routes';

import { AuthHeading } from './AuthHeading';
import { AuthDivider, OAuthButtons } from './OAuthButtons';

/**
 * Anmeldung mit Benutzername und Passwort sowie über Discord, Twitch und Steam
 * (Lastenheft §3.1, Referenz-Mockup „Willkommen zurück").
 *
 * Die 2FA-Eingabe ist ein zweiter Schritt derselben Ansicht, keine eigene Route:
 * der Zwischen-Token lebt nur im Speicher und würde einen Seitenwechsel nicht
 * überstehen (Pflichtenheft §7).
 */

type Step = 'credentials' | 'two-factor';

interface FieldErrors {
  username?: string;
  password?: string;
  code?: string;
}

export function LoginView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * Fehler, bei denen ein sofortiger neuer Versuch nichts bringt (Sperre,
   * Rate-Limit). Die Schaltfläche bleibt bedienbar – sie zu sperren würde die
   * Ansicht in eine Sackgasse führen –, die Meldung wechselt aber den Ton.
   */
  const [blocking, setBlocking] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Fehler eines Provider-Rücklaufs (Discord/Twitch/Steam).
   *
   * Das Backend leitet nach einem gescheiterten Callback auf
   * `/login?error=<CODE>` zurück – ein Fehlercode aus dem Katalog, kein
   * Freitext (Pflichtenheft §5.1).
   */
  const providerErrorCode = searchParams.get('error');
  const providerError = providerErrorCode ? messageForErrorCode(providerErrorCode) : null;

  function handleFailure(thrown: unknown) {
    const code: ErrorCode | null = thrown instanceof AuthRequestError ? thrown.code : null;
    setFormError(messageForThrown(thrown));
    setBlocking(isBlockingError(code));

    if (shouldRestartLogin(code)) {
      setStep('credentials');
      setTwoFactorToken(null);
      setCode('');
      setPassword('');
    }
  }

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setBlocking(false);

    const parsed = loginInputSchema.safeParse({ username, password });
    if (!parsed.success) {
      const flat = parsed.error.flatten().fieldErrors;
      setFieldErrors({ username: flat.username?.[0], password: flat.password?.[0] });
      return;
    }
    setFieldErrors({});
    setBusy(true);

    try {
      const result = await login(parsed.data);
      if (result.status === 'two_factor_required') {
        setTwoFactorToken(result.twoFactorToken);
        setStep('two-factor');
        return;
      }
      router.replace(landingPathForAccount(result.account));
    } catch (thrown) {
      handleFailure(thrown);
    } finally {
      setBusy(false);
    }
  }

  async function submitTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (twoFactorToken === null) {
      // Kann nur passieren, wenn der Schritt ohne ersten Schritt erreicht wird.
      setStep('credentials');
      return;
    }

    const parsed = twoFactorInputSchema.safeParse({ twoFactorToken, code });
    if (!parsed.success) {
      setFieldErrors({ code: parsed.error.flatten().fieldErrors.code?.[0] });
      return;
    }
    setFieldErrors({});
    setBusy(true);

    try {
      const account = await verifyTwoFactor(parsed.data);
      router.replace(landingPathForAccount(account));
    } catch (thrown) {
      handleFailure(thrown);
    } finally {
      setBusy(false);
    }
  }

  function backToCredentials() {
    setStep('credentials');
    setTwoFactorToken(null);
    setCode('');
    setFormError(null);
    setFieldErrors({});
  }

  if (step === 'two-factor') {
    return (
      <>
        <AuthHeading
          title="Bestätigung"
          description="Öffne deine Authenticator-App oder nutze einen Backup-Code."
        />

        <form onSubmit={submitTwoFactor} className="flex flex-col gap-3.5" noValidate>
          <TextField
            label="Code"
            labelVariant="caps"
            value={code}
            onChange={setCode}
            error={fieldErrors.code}
            autoComplete="one-time-code"
            autoFocus
            placeholder="123456"
            inputClassName="py-3.5 text-center font-mono text-3xl tracking-[0.3em]"
            inputProps={{ inputMode: 'numeric', maxLength: 32 }}
          />

          {formError ? (
            <FormMessage tone={blocking ? 'warning' : 'error'}>{formError}</FormMessage>
          ) : null}

          <Button type="submit" variant="primary" fullWidth disabled={busy}>
            {busy ? 'Wird geprüft …' : 'Bestätigen'}
          </Button>
        </form>

        <button
          type="button"
          onClick={backToCredentials}
          className="mt-3.5 w-full text-base text-ink-muted hover:text-ink"
        >
          ← Zurück
        </button>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title="Willkommen zurück"
        description="Melde dich an, um deine Gameserver zu verwalten."
      />

      {providerError ? <FormMessage className="mb-3.5">{providerError}</FormMessage> : null}

      <form onSubmit={submitCredentials} className="flex flex-col gap-3.5" noValidate>
        <TextField
          label="Benutzername"
          labelVariant="caps"
          value={username}
          onChange={setUsername}
          error={fieldErrors.username}
          autoComplete="username"
          placeholder="z. B. alex"
          inputProps={{ autoCapitalize: 'none', spellCheck: false }}
        />
        <TextField
          label="Passwort"
          labelVariant="caps"
          type="password"
          value={password}
          onChange={setPassword}
          error={fieldErrors.password}
          autoComplete="current-password"
          placeholder="••••••••"
        />

        {formError ? (
          <FormMessage tone={blocking ? 'warning' : 'error'}>{formError}</FormMessage>
        ) : null}

        <Button type="submit" variant="primary" fullWidth disabled={busy}>
          {busy ? 'Wird angemeldet …' : 'Anmelden'}
        </Button>
      </form>

      <AuthDivider />
      <OAuthButtons />

      <p className="mt-6 text-center text-base text-ink-muted">
        Noch kein Konto? <Link href={AUTH_ROUTES.register}>Registrieren</Link>
      </p>
    </>
  );
}
