import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_LENGTH,
  altchaChallengeSchema,
  loginInputSchema,
  loginResultSchema,
  passwordSchema,
  registerInputSchema,
  twoFactorCodeSchema,
  usernameSchema,
} from './auth.js';

describe('Benutzername (Pflichtenheft §7)', () => {
  it('nimmt gängige Namen an und entfernt umschließenden Leerraum', () => {
    expect(usernameSchema.parse('  alex  ')).toBe('alex');
    expect(usernameSchema.parse('alex.mueller_1')).toBe('alex.mueller_1');
  });

  it('lehnt zu kurze, zu lange und formal falsche Namen ab', () => {
    expect(usernameSchema.safeParse('al').success).toBe(false);
    expect(usernameSchema.safeParse('a'.repeat(33)).success).toBe(false);
    expect(usernameSchema.safeParse('.alex').success).toBe(false);
    expect(usernameSchema.safeParse('alex-').success).toBe(false);
    expect(usernameSchema.safeParse('alex müller').success).toBe(false);
  });
});

describe('Passwort (Pflichtenheft §7)', () => {
  it('verlangt die Mindestlänge von 12 Zeichen', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  it('schneidet Leerzeichen nicht weg – sie sind Teil des Passworts', () => {
    const withSpaces = ' ein langes passwort ';
    expect(passwordSchema.parse(withSpaces)).toBe(withSpaces);
  });
});

describe('Login-Eingabe', () => {
  it('prüft das Passwort beim Login nicht auf Länge', () => {
    // Bestandskonten können älteren Regeln folgen; eine Längenmeldung würde
    // außerdem verraten, wie das hinterlegte Passwort aussieht.
    expect(loginInputSchema.safeParse({ username: 'alex', password: 'kurz' }).success).toBe(true);
  });

  it('verlangt beide Felder', () => {
    expect(loginInputSchema.safeParse({ username: '', password: 'x' }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: 'alex', password: '' }).success).toBe(false);
  });
});

describe('Registrierung (Lastenheft §3.1)', () => {
  const valid = {
    username: 'alex',
    password: 'ein-sehr-langes-passwort',
    altcha: 'eyJhbGciOiJTSEEtMjU2In0=',
  };

  it('nimmt eine vollständige Eingabe an; der Anzeigename bleibt optional', () => {
    expect(registerInputSchema.parse(valid).displayName).toBeUndefined();
    expect(registerInputSchema.parse({ ...valid, displayName: 'Alex' }).displayName).toBe('Alex');
  });

  it('besteht auf der gelösten ALTCHA-Challenge', () => {
    expect(registerInputSchema.safeParse({ ...valid, altcha: '' }).success).toBe(false);
    const { altcha: _altcha, ...withoutAltcha } = valid;
    expect(registerInputSchema.safeParse(withoutAltcha).success).toBe(false);
  });

  it('lehnt ein zu kurzes Passwort ab', () => {
    expect(registerInputSchema.safeParse({ ...valid, password: 'kurz' }).success).toBe(false);
  });
});

describe('2FA-Code (Pflichtenheft §7)', () => {
  it('entfernt Leerzeichen und Bindestriche aus kopierten Codes', () => {
    expect(twoFactorCodeSchema.parse('123 456')).toBe('123456');
    expect(twoFactorCodeSchema.parse('abcd-efgh')).toBe('abcdefgh');
  });

  it('nimmt TOTP- und Backup-Codes an, lehnt Unfug ab', () => {
    expect(twoFactorCodeSchema.safeParse('123456').success).toBe(true);
    expect(twoFactorCodeSchema.safeParse('A1B2C3D4E5F6').success).toBe(true);
    expect(twoFactorCodeSchema.safeParse('12345').success).toBe(false);
    expect(twoFactorCodeSchema.safeParse('123/456').success).toBe(false);
  });
});

describe('Login-Ergebnis', () => {
  const account = {
    id: '11111111-1111-4111-8111-111111111111',
    displayName: 'Alex',
    username: 'alex',
    isOwner: false,
    banned: false,
    awaitingApproval: true,
    twoFactorEnabled: false,
    roles: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Gast', isProtected: true }],
    authMethods: [
      { type: 'password' as const, providerDisplayName: null, linkedAt: '2026-08-26T10:00:00Z' },
    ],
    createdAt: '2026-08-26T10:00:00Z',
    permissions: {
      canCreateServer: false,
      canViewAnyServer: false,
      canManageAnyBackup: false,
      canManageUsers: false,
      canManageRoles: false,
      canManageNotifications: false,
      canViewNodes: false,
      canManageNodes: false,
      canManageAddresses: false,
      canViewAuditLog: false,
      canModerateMessages: false,
      canManageGameTypes: false,
    },
  };

  it('nimmt das abgeschlossene Ergebnis an', () => {
    const parsed = loginResultSchema.parse({ status: 'authenticated', account });
    expect(parsed.status).toBe('authenticated');
  });

  it('nimmt den 2FA-Zwischenschritt an', () => {
    const parsed = loginResultSchema.parse({
      status: 'two_factor_required',
      twoFactorToken: 'zwischen-token',
      expiresAt: '2026-08-26T10:05:00Z',
    });
    expect(parsed.status).toBe('two_factor_required');
  });

  it('lehnt einen Zwischenschritt ab, der ein Konto mitschickt', () => {
    const result = loginResultSchema.safeParse({
      status: 'two_factor_required',
      twoFactorToken: 'zwischen-token',
      expiresAt: '2026-08-26T10:05:00Z',
      account,
    });
    // Zusatzfelder werden von Zod entfernt, das Konto darf aber nie ankommen:
    expect(result.success && 'account' in result.data).toBe(false);
  });
});

describe('ALTCHA-Challenge (Pflichtenheft §3)', () => {
  const challenge = {
    algorithm: 'SHA-256' as const,
    challenge: 'a3f1',
    salt: 'salz',
    maxnumber: 100000,
    signature: 'signatur',
  };

  it('nimmt eine vollständige Challenge an', () => {
    expect(altchaChallengeSchema.parse(challenge)).toEqual(challenge);
  });

  it('lehnt ein anderes Verfahren und einen Nicht-Hex-Hash ab', () => {
    expect(altchaChallengeSchema.safeParse({ ...challenge, algorithm: 'SHA-1' }).success).toBe(
      false,
    );
    expect(altchaChallengeSchema.safeParse({ ...challenge, challenge: 'zzz' }).success).toBe(false);
  });
});
