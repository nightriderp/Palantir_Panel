'use client';

import { type FormEvent, useState } from 'react';
import { type AccountDto, type TwoFactorSetupDto } from '@palantir/contracts';
import { Button, Icon, Panel, TextField, useToast } from '@/components/shared';
import {
  beginTwoFactorSetup,
  changePassword,
  confirmTwoFactor,
  disableTwoFactor,
  linkPassword,
} from '@/lib/auth/api';
import { messageForThrown } from '@/lib/auth/errors';
import { hasPassword } from './methods';

/**
 * Sicherheits-Abschnitte des Profils (Pflichtenheft §7).
 *
 * Passwort setzen/ändern und die Zwei-Faktor-Authentisierung verwalten. Bewusst
 * knapp: Die eigentliche Prüfung (aktuelles Passwort, gültiger Code) liegt beim
 * Backend; hier werden Eingaben gesammelt und Fehlermeldungen aus dem Katalog
 * angezeigt.
 *
 * Beide Abschnitte standen bis zur Zusammenlegung von Profil und Einstellungen
 * auf einer eigenen Seite. Sie laden das Konto deshalb **nicht** selbst: Es
 * kommt aus der Profil-Ansicht, die es ohnehin schon geholt hat, und geht bei
 * jeder Änderung über `onChanged` dorthin zurück.
 */
export interface SectionProps {
  account: AccountDto;
  onChanged: (account: AccountDto) => void;
}

export function PasswordSection({ account, onChanged }: SectionProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [username, setUsername] = useState('');

  const alreadyHasPassword = hasPassword(account.authMethods);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = alreadyHasPassword
        ? await changePassword({ currentPassword, newPassword })
        : await linkPassword({ username, password: newPassword });
      onChanged(updated);
      toast.success(alreadyHasPassword ? 'Passwort geändert.' : 'Passwort eingerichtet.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      toast.error(messageForThrown(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <h2 className="text-xl font-semibold text-ink">Passwort</h2>
      <p className="mt-0.5 text-sm text-ink-soft">
        {alreadyHasPassword
          ? 'Ändere dein Passwort. Mindestens 12 Zeichen.'
          : 'Richte einen Benutzernamen und ein Passwort ein, um dich auch ohne externen Anbieter anzumelden.'}
      </p>

      <form className="mt-4 flex flex-col gap-3" onSubmit={onSubmit}>
        {alreadyHasPassword ? (
          <TextField
            label="Aktuelles Passwort"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
            inputProps={{ required: true }}
          />
        ) : (
          <TextField
            label="Benutzername"
            autoComplete="username"
            value={username}
            onChange={setUsername}
            inputProps={{ required: true }}
          />
        )}
        <TextField
          label={alreadyHasPassword ? 'Neues Passwort' : 'Passwort'}
          type="password"
          autoComplete="new-password"
          hint="Mindestens 12 Zeichen."
          value={newPassword}
          onChange={setNewPassword}
          inputProps={{ required: true }}
        />
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {alreadyHasPassword ? 'Passwort ändern' : 'Passwort einrichten'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

export function TwoFactorSection({ account, onChanged }: SectionProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState<TwoFactorSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');

  async function onBeginSetup() {
    setBusy(true);
    try {
      setSetup(await beginTwoFactorSetup());
    } catch (err) {
      toast.error(messageForThrown(err));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await confirmTwoFactor({ code });
      onChanged(updated);
      toast.success('Zwei-Faktor-Authentisierung ist aktiv.');
      setSetup(null);
      setCode('');
    } catch (err) {
      toast.error(messageForThrown(err));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const updated = await disableTwoFactor({ password: disablePassword, code });
      onChanged(updated);
      toast.success('Zwei-Faktor-Authentisierung deaktiviert.');
      setDisablePassword('');
      setCode('');
    } catch (err) {
      toast.error(messageForThrown(err));
    } finally {
      setBusy(false);
    }
  }

  async function copySecret() {
    if (!setup) {
      return;
    }
    try {
      await navigator.clipboard.writeText(setup.secret);
      toast.success('Geheimnis kopiert.');
    } catch {
      // Zwischenablage nicht verfügbar (kein HTTPS/Berechtigung) – der Wert
      // steht zum Abtippen ohnehin sichtbar daneben.
    }
  }

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-ink">Zwei-Faktor-Authentisierung</h2>
        {account.twoFactorEnabled ? (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <Icon name="shield" size={14} /> aktiv
          </span>
        ) : null}
      </div>

      {account.twoFactorEnabled ? (
        <form className="mt-4 flex flex-col gap-3" onSubmit={onDisable}>
          <p className="text-sm text-ink-soft">
            Zum Deaktivieren dein Passwort und einen aktuellen Code aus der Authenticator-App
            eingeben.
          </p>
          <TextField
            label="Passwort"
            type="password"
            autoComplete="current-password"
            value={disablePassword}
            onChange={setDisablePassword}
            inputProps={{ required: true }}
          />
          <TextField
            label="Code"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
            inputProps={{ inputMode: 'numeric', required: true }}
          />
          <div>
            <Button type="submit" variant="danger" disabled={busy}>
              2FA deaktivieren
            </Button>
          </div>
        </form>
      ) : setup ? (
        <form className="mt-4 flex flex-col gap-3" onSubmit={onConfirm}>
          <p className="text-sm text-ink-soft">
            Füge das Geheimnis in deiner Authenticator-App hinzu (oder öffne die
            <code className="mx-1 rounded bg-fill px-1 text-xs">otpauth</code>-Adresse) und gib dann
            den angezeigten Code ein.
          </p>
          <div className="rounded-md border border-line bg-fill p-3">
            <p className="text-2xs uppercase tracking-wide text-ink-faint">Geheimnis</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all font-mono text-sm text-ink">{setup.secret}</code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                iconLeft="copy"
                onClick={copySecret}
              >
                Kopieren
              </Button>
            </div>
            <p className="mt-2 break-all text-2xs text-ink-faint">{setup.otpauthUri}</p>
          </div>
          <TextField
            label="Code aus der App"
            autoComplete="one-time-code"
            value={code}
            onChange={setCode}
            inputProps={{ inputMode: 'numeric', required: true }}
          />
          <div className="flex gap-2.5">
            <Button type="submit" variant="primary" disabled={busy}>
              Aktivieren
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setSetup(null);
                setCode('');
              }}
            >
              Abbrechen
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4">
          <p className="text-sm text-ink-soft">
            Schütze dein Konto mit einem zeitbasierten Einmalcode (TOTP) aus einer
            Authenticator-App.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="primary"
              iconLeft="shield"
              disabled={busy}
              onClick={onBeginSetup}
            >
              2FA einrichten
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
