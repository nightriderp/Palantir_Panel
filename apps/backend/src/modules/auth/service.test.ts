import { GUEST_ROLE_NAME } from '@palantir/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { isAuthError } from './errors.js';
import { AuthService, sanitizeDisplayName } from './service.js';
import {
  type FakeAuthRepository,
  type FakeRoleRepository,
  createFakeAuthRepository,
  createFakeProviderRegistry,
  createFakeRoleRepository,
} from './test-doubles.js';
import { signTwoFactorToken, verifyAccessToken } from './tokens.js';
import { generateTotp } from './totp.js';

const CONTEXT = { deviceInfo: 'Firefox auf Windows', ipHint: '203.0.113.x' };
const REFRESH_TTL_MS = 30 * 86_400_000;
const TWO_FACTOR_TTL_MS = 5 * 60_000;
const JWT_SECRET = 'test-jwt-secret';
const PASSWORD = 'ein-sehr-langes-passwort';
const ALTCHA = 'nachweis-wird-in-der-route-geprueft';

let repository: FakeAuthRepository;
let roles: FakeRoleRepository;
let now: Date;
let service: AuthService;

function build(options: { providers?: ReturnType<typeof createFakeProviderRegistry> } = {}): void {
  repository = createFakeAuthRepository();
  roles = createFakeRoleRepository([{ name: 'Nutzer', permissions: ['server.create'] }]);
  now = new Date('2026-08-26T12:00:00Z');
  service = new AuthService({
    repository,
    roles,
    providers: options.providers ?? createFakeProviderRegistry(),
    refreshTokenTtlMs: REFRESH_TTL_MS,
    jwtSecret: JWT_SECRET,
    twoFactorTokenTtlMs: TWO_FACTOR_TTL_MS,
    totpIssuer: 'palantir.example',
    now: () => now,
  });
}

/** Erwartet, dass ein Aufruf mit genau diesem Fehlercode scheitert. */
async function expectErrorCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toSatisfy(
    (error: unknown) => isAuthError(error) && error.code === code,
    `Fehlercode ${code}`,
  );
}

beforeEach(() => {
  build();
});

describe('Registrierung (Lastenheft §3.1)', () => {
  it('legt ein Konto mit Passwort-Methode und Sitzung an', async () => {
    const { account, session } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    expect(account.displayName).toBe('spieler');
    expect(account.authMethods.map((method) => method.type)).toEqual(['password']);
    expect(session.refreshToken).toHaveLength(43);
    expect(session.expiresAt.getTime()).toBe(now.getTime() + REFRESH_TTL_MS);
  });

  it('vergibt automatisch die Rolle „Gast" (Zusammenspiel mit B2)', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    expect(account.roles.map((role) => role.name)).toEqual([GUEST_ROLE_NAME]);
    expect(account.awaitingApproval).toBe(true);
    // Die Gast-Rolle bringt keinerlei Berechtigung mit.
    expect(Object.values(account.permissions).every((flag) => flag === false)).toBe(true);
  });

  it('speichert das Passwort ausschließlich als Argon2id-Hash', async () => {
    await service.register({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT);

    const stored = repository.methods[0];

    expect(stored?.passwordHash?.startsWith('$argon2id$')).toBe(true);
    expect(JSON.stringify(repository.methods)).not.toContain(PASSWORD);
  });

  it('lehnt einen bereits vergebenen Benutzernamen ab – auch anders geschrieben', async () => {
    await service.register({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT);

    await expectErrorCode(
      service.register({ username: 'SPIELER', password: PASSWORD, altcha: ALTCHA }, CONTEXT),
      'AUTH_USERNAME_TAKEN',
    );
  });

  it('bricht ab, wenn die Systemrolle „Gast" fehlt (Ersteinrichtung unvollständig)', async () => {
    roles.roles.splice(0, roles.roles.length);

    await expect(
      service.register({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT),
    ).rejects.toThrow(/db:seed/);
  });
});

describe('Login (Pflichtenheft §7)', () => {
  beforeEach(async () => {
    await service.register({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT);
  });

  it('meldet mit richtigen Zugangsdaten an', async () => {
    const outcome = await service.login(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    expect(outcome.result.status).toBe('authenticated');
    expect(outcome.session).not.toBeNull();
  });

  it('erkennt den Benutzernamen ohne Rücksicht auf Groß-/Kleinschreibung', async () => {
    const outcome = await service.login(
      { username: 'SpIeLeR', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    expect(outcome.result.status).toBe('authenticated');
  });

  it('antwortet bei falschem Passwort und bei unbekanntem Konto gleich', async () => {
    await expectErrorCode(
      service.login({ username: 'spieler', password: 'falsch-aber-lang', altcha: ALTCHA }, CONTEXT),
      'AUTH_INVALID_CREDENTIALS',
    );

    await expectErrorCode(
      service.login({ username: 'gibtesnicht', password: PASSWORD, altcha: ALTCHA }, CONTEXT),
      'AUTH_INVALID_CREDENTIALS',
    );
  });

  it('lehnt gesperrte Konten mit eigenem Code ab', async () => {
    const user = repository.users[0];
    repository.users[0] = { ...user!, banned: true };

    await expectErrorCode(
      service.login({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT),
      'AUTH_ACCOUNT_BANNED',
    );
  });

  it('verrät über die Sperre nichts, solange das Passwort falsch ist', async () => {
    const user = repository.users[0];
    repository.users[0] = { ...user!, banned: true };

    await expectErrorCode(
      service.login({ username: 'spieler', password: 'falsch-aber-lang', altcha: ALTCHA }, CONTEXT),
      'AUTH_INVALID_CREDENTIALS',
    );
  });
});

describe('2FA (Pflichtenheft §7)', () => {
  let userId: string;

  beforeEach(async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );
    userId = account.id;
  });

  async function enableTwoFactor(): Promise<string> {
    const setup = await service.beginTwoFactorSetup(userId);

    await service.confirmTwoFactor(userId, generateTotp(setup.secret, now.getTime()));

    return setup.secret;
  }

  it('liefert Geheimnis und otpauth-URI und ist erst nach Bestätigung aktiv', async () => {
    const setup = await service.beginTwoFactorSetup(userId);

    expect(setup.otpauthUri).toContain('otpauth://totp/palantir.example:spieler');

    const beforeConfirm = await service.loadAccount(repository.users[0]!);
    expect(beforeConfirm.twoFactorEnabled).toBe(false);

    const account = await service.confirmTwoFactor(
      userId,
      generateTotp(setup.secret, now.getTime()),
    );
    expect(account.twoFactorEnabled).toBe(true);
  });

  it('lehnt die Bestätigung mit falschem Code ab', async () => {
    await service.beginTwoFactorSetup(userId);

    await expectErrorCode(service.confirmTwoFactor(userId, '000000'), 'AUTH_TWO_FACTOR_INVALID');
  });

  it('verlangt beim Login den zweiten Faktor, ohne eine Sitzung auszugeben', async () => {
    await enableTwoFactor();

    const outcome = await service.login(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    expect(outcome.result.status).toBe('two_factor_required');
    expect(outcome.session).toBeNull();
  });

  /** Erster Anmeldeschritt bis zum Zwischen-Token. */
  async function startTwoFactorLogin(): Promise<string> {
    const outcome = await service.login(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    if (outcome.result.status !== 'two_factor_required') {
      throw new Error('Erwartet wurde der Zwischenschritt.');
    }

    return outcome.result.twoFactorToken;
  }

  it('meldet im zweiten Schritt mit gültigem Code an', async () => {
    const secret = await enableTwoFactor();
    const token = await startTwoFactorLogin();

    const outcome = await service.completeTwoFactorLogin(
      token,
      generateTotp(secret, now.getTime()),
      CONTEXT,
    );

    expect(outcome.account.twoFactorEnabled).toBe(true);
    expect(outcome.session.refreshToken).toHaveLength(43);
  });

  it('lehnt einen falschen Code im zweiten Schritt ab', async () => {
    await enableTwoFactor();
    const token = await startTwoFactorLogin();

    await expectErrorCode(
      service.completeTwoFactorLogin(token, '000000', CONTEXT),
      'AUTH_TWO_FACTOR_INVALID',
    );
  });

  it('lehnt einen abgelaufenen Zwischen-Token ab', async () => {
    const secret = await enableTwoFactor();
    // `jose` prüft `exp` gegen die echte Uhr, nicht gegen die eingespeiste
    // Zeit – der Token wird deshalb mit einem Ausstellungszeitpunkt weit in der
    // Vergangenheit erzeugt.
    const { token } = await signTwoFactorToken(
      userId,
      { secret: JWT_SECRET, ttlMs: TWO_FACTOR_TTL_MS },
      Date.now() - 86_400_000,
    );

    await expectErrorCode(
      service.completeTwoFactorLogin(token, generateTotp(secret, now.getTime()), CONTEXT),
      'AUTH_TWO_FACTOR_EXPIRED',
    );
  });

  it('lehnt einen Zwischen-Token mit fremdem Schlüssel ab', async () => {
    const secret = await enableTwoFactor();
    const { token } = await signTwoFactorToken(userId, {
      secret: 'anderer-schluessel',
      ttlMs: TWO_FACTOR_TTL_MS,
    });

    await expectErrorCode(
      service.completeTwoFactorLogin(token, generateTotp(secret, now.getTime()), CONTEXT),
      'AUTH_TWO_FACTOR_EXPIRED',
    );
  });

  it('lässt den Zwischen-Token nicht als Access-Token durchgehen', async () => {
    await enableTwoFactor();
    const token = await startTwoFactorLogin();

    // Der Zwischen-Token trägt einen eigenen Verwendungszweck; ohne diese
    // Trennung wäre er eine vollwertige Anmeldung ohne zweiten Faktor.
    expect(await verifyAccessToken(token, { secret: JWT_SECRET })).toBeNull();
  });

  it('gibt im ersten Schritt keine Sitzung aus', async () => {
    await enableTwoFactor();
    await startTwoFactorLogin();

    // Nur die Sitzung aus der Registrierung – der Login hat keine angelegt.
    expect(repository.sessions).toHaveLength(1);
  });

  it('verlangt zum Abschalten Passwort und Code zusammen', async () => {
    const secret = await enableTwoFactor();
    const code = generateTotp(secret, now.getTime());

    await expectErrorCode(
      service.disableTwoFactor(userId, { password: 'falsch-aber-lang', code }),
      'AUTH_INVALID_CREDENTIALS',
    );
    await expectErrorCode(
      service.disableTwoFactor(userId, { password: PASSWORD, code: '000000' }),
      'AUTH_TWO_FACTOR_INVALID',
    );

    const account = await service.disableTwoFactor(userId, { password: PASSWORD, code });
    expect(account.twoFactorEnabled).toBe(false);
  });

  it('lässt sich vom Admin abschalten – der einzige Weg an einer verlorenen 2FA vorbei', async () => {
    await enableTwoFactor();
    await service.disableTwoFactorAsAdmin(userId);

    const account = await service.loadAccount(repository.users[0]!);
    expect(account.twoFactorEnabled).toBe(false);
    expect(repository.methods[0]?.totpSecret).toBeNull();
  });

  it('gibt es nur für Passwort-Konten', async () => {
    const outcome = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      { state: 'state-discord', codeVerifier: 'verifier-discord' },
      CONTEXT,
    );

    await expectErrorCode(service.beginTwoFactorSetup(outcome.account.id), 'AUTH_METHOD_NOT_FOUND');
  });
});

describe('Sitzungen und Token-Rotation (Pflichtenheft §7)', () => {
  let userId: string;
  let refreshToken: string;
  let sessionId: string;

  beforeEach(async () => {
    const { account, session } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    userId = account.id;
    refreshToken = session.refreshToken;
    sessionId = session.sessionId;
  });

  it('speichert den Refresh-Token nur gehasht', () => {
    expect(repository.sessions[0]?.refreshTokenHash).not.toBe(refreshToken);
    expect(JSON.stringify(repository.sessions)).not.toContain(refreshToken);
  });

  it('tauscht den Token bei jeder Nutzung aus', async () => {
    const { session } = await service.refresh(refreshToken, CONTEXT);

    expect(session.refreshToken).not.toBe(refreshToken);
    expect(session.sessionId).toBe(sessionId);
  });

  it('widerruft bei Wiederverwendung eines ersetzten Tokens alle Sitzungen', async () => {
    await service.login({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT);
    await service.refresh(refreshToken, CONTEXT);

    // Der alte Token taucht erneut auf – Anzeichen für einen Diebstahl.
    await expectErrorCode(service.refresh(refreshToken, CONTEXT), 'AUTH_SESSION_EXPIRED');
    expect(repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('merkt sich den ersetzten Hash, damit ein alter Token erkennbar bleibt', async () => {
    await service.refresh(refreshToken, CONTEXT);

    const stored = repository.sessions[0];

    expect(stored?.previousRefreshTokenHash).not.toBeNull();
    expect(stored?.previousRefreshTokenHash).not.toBe(stored?.refreshTokenHash);
  });

  it('lehnt einen abgelaufenen Token ab', async () => {
    now = new Date(now.getTime() + REFRESH_TTL_MS + 1000);

    await expectErrorCode(service.refresh(refreshToken, CONTEXT), 'AUTH_SESSION_EXPIRED');
  });

  it('lehnt einen unbekannten Token ab', async () => {
    await expectErrorCode(service.refresh('unbekannt', CONTEXT), 'AUTH_SESSION_EXPIRED');
  });

  it('zeigt die eigenen Sitzungen und markiert die aktuelle', async () => {
    await service.login({ username: 'spieler', password: PASSWORD, altcha: ALTCHA }, CONTEXT);

    const sessions = await service.listSessions(userId, sessionId);

    expect(sessions).toHaveLength(2);
    expect(sessions.filter((session) => session.current)).toHaveLength(1);
    expect(sessions.every((session) => session.permissions.canRevoke)).toBe(true);
  });

  it('liefert im Sitzungs-DTO keinen Token', async () => {
    const [session] = await service.listSessions(userId, sessionId);

    expect(JSON.stringify(session)).not.toContain(refreshToken);
    expect(session).not.toHaveProperty('refreshTokenHash');
  });

  it('meldet eine einzelne Sitzung remote ab (Lastenheft §3.1)', async () => {
    const other = await service.login(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await service.revokeSession(userId, other.session!.sessionId);

    const sessions = await service.listSessions(userId, sessionId);
    expect(sessions).toHaveLength(1);
    await expectErrorCode(service.resolveSession(other.session!.sessionId), 'AUTH_SESSION_EXPIRED');
  });

  it('behandelt eine fremde Sitzung wie eine nicht vorhandene', async () => {
    const stranger = await service.register(
      { username: 'fremder', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await expectErrorCode(
      service.revokeSession(userId, stranger.session.sessionId),
      'AUTH_SESSION_NOT_FOUND',
    );
    // Die fremde Sitzung bleibt unangetastet.
    expect(repository.sessions.find((s) => s.id === stranger.session.sessionId)?.revokedAt).toBe(
      null,
    );
  });

  it('macht die Sitzung nach dem Logout unbrauchbar', async () => {
    await service.logout(sessionId);

    await expectErrorCode(service.resolveSession(sessionId), 'AUTH_SESSION_EXPIRED');
  });
});

describe('Anbieter-Login und Account-Linking (Lastenheft §3.1)', () => {
  const pendingDiscord = { state: 'state-discord', codeVerifier: 'verifier-discord' };

  it('legt bei unbekannter Identität ein Konto mit Rolle „Gast" an', async () => {
    const outcome = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      CONTEXT,
    );

    expect(outcome.created).toBe(true);
    expect(outcome.account.roles.map((role) => role.name)).toEqual([GUEST_ROLE_NAME]);
    expect(outcome.account.authMethods[0]?.type).toBe('discord');
    expect(outcome.account.authMethods[0]?.providerUserId).toBe('discord-1234');
  });

  it('meldet bei bekannter Identität dasselbe Konto an', async () => {
    const first = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      CONTEXT,
    );
    const second = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      CONTEXT,
    );

    expect(second.created).toBe(false);
    expect(second.account.id).toBe(first.account.id);
    expect(repository.users).toHaveLength(1);
  });

  it('lässt kollidierende Anzeigenamen zu – eindeutig ist nur der Benutzername', async () => {
    // Der Vertrag aus F1 trennt beide: `username` ist die Anmeldekennung und
    // eindeutig, `displayName` dient nur der Anzeige.
    const existing = await service.register(
      { username: 'discord-nutzer', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    const outcome = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      CONTEXT,
    );

    expect(outcome.account.displayName).toBe('discord-nutzer');
    expect(existing.account.displayName).toBe('discord-nutzer');
    // Ein reines Provider-Konto bekommt noch keine Anmeldekennung.
    expect(outcome.account.username).toBeNull();
    expect(repository.users).toHaveLength(2);
  });

  it('lehnt eine Rückkehr mit falschem state ab', async () => {
    await expect(
      service.completeProviderLogin(
        'discord',
        { state: 'untergeschoben' },
        pendingDiscord,
        CONTEXT,
      ),
    ).rejects.toThrow();
  });

  it('verknüpft eine Methode mit dem eingeloggten Konto', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    const linked = await service.completeProviderLink(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      account.id,
    );

    expect(linked.authMethods.map((method) => method.type).sort()).toEqual(['discord', 'password']);
    expect(repository.users).toHaveLength(1);
  });

  it('lehnt eine bereits anderweitig vergebene Identität ab', async () => {
    await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      CONTEXT,
    );
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await expectErrorCode(
      service.completeProviderLink(
        'discord',
        { state: 'state-discord' },
        pendingDiscord,
        account.id,
      ),
      'AUTH_METHOD_ALREADY_LINKED',
    );
  });

  it('ergänzt ein Passwort zu einem reinen Anbieter-Konto', async () => {
    const outcome = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      CONTEXT,
    );

    const account = await service.linkPassword(outcome.account.id, {
      username: 'neuer-name',
      password: PASSWORD,
    });

    expect(account.authMethods.map((method) => method.type).sort()).toEqual([
      'discord',
      'password',
    ]);
  });

  it('lehnt ein zweites Passwort am selben Konto ab', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await expectErrorCode(
      service.linkPassword(account.id, { username: 'zweiter-name', password: PASSWORD }),
      'AUTH_METHOD_ALREADY_LINKED',
    );
  });

  it('lässt die letzte verbliebene Methode nicht trennen', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await expectErrorCode(
      service.unlinkMethod(account.id, 'password'),
      'AUTH_METHOD_LAST_REMAINING',
    );
    // Das DTO sagt dasselbe, bevor der Nutzer es versucht.
    expect(account.authMethods[0]?.canUnlink).toBe(false);
  });

  it('trennt eine Methode, wenn eine weitere bleibt', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );
    await service.completeProviderLink(
      'discord',
      { state: 'state-discord' },
      pendingDiscord,
      account.id,
    );

    const after = await service.unlinkMethod(account.id, 'discord');

    expect(after.authMethods.map((method) => method.type)).toEqual(['password']);
  });

  it('meldet eine nicht verknüpfte Methode als nicht gefunden', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await expectErrorCode(service.unlinkMethod(account.id, 'steam'), 'AUTH_METHOD_NOT_FOUND');
  });
});

describe('Passwortwechsel und Admin-Reset (Lastenheft §3.1)', () => {
  let userId: string;
  let sessionId: string;

  beforeEach(async () => {
    const { account, session } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );
    userId = account.id;
    sessionId = session.sessionId;
  });

  it('verlangt das aktuelle Passwort', async () => {
    await expectErrorCode(
      service.changePassword(
        userId,
        { currentPassword: 'falsch-aber-lang', newPassword: `${PASSWORD}-neu` },
        sessionId,
      ),
      'AUTH_INVALID_CREDENTIALS',
    );
  });

  it('setzt das neue Passwort und behält die aktuelle Sitzung', async () => {
    const other = await service.login(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await service.changePassword(
      userId,
      { currentPassword: PASSWORD, newPassword: `${PASSWORD}-neu` },
      sessionId,
    );

    const outcome = await service.login(
      { username: 'spieler', password: `${PASSWORD}-neu`, altcha: ALTCHA },
      CONTEXT,
    );
    expect(outcome.result.status).toBe('authenticated');

    // Andere Sitzungen sind weg, die eigene bleibt.
    await expectErrorCode(service.resolveSession(other.session!.sessionId), 'AUTH_SESSION_EXPIRED');
    await expect(service.resolveSession(sessionId)).resolves.toBeTruthy();
  });

  it('erzeugt beim Admin-Reset ein Einmal-Passwort und sperrt das Konto neu', async () => {
    const result = await service.resetPasswordAsAdmin(userId);

    expect(result.temporaryPassword.length).toBeGreaterThan(12);
    // Das Klartext-Passwort steht nirgends in der Ablage.
    expect(JSON.stringify(repository.methods)).not.toContain(result.temporaryPassword);
    expect(repository.methods[0]?.mustChangePassword).toBe(true);
    // Alle Sitzungen des Kontos sind widerrufen.
    expect(repository.sessions.every((session) => session.revokedAt !== null)).toBe(true);

    const outcome = await service.login(
      { username: 'spieler', password: result.temporaryPassword, altcha: ALTCHA },
      CONTEXT,
    );
    expect(outcome.result.status).toBe('authenticated');
  });

  it('räumt das Wechsel-Kennzeichen nach dem Passwortwechsel ab', async () => {
    const result = await service.resetPasswordAsAdmin(userId);
    const outcome = await service.login(
      { username: 'spieler', password: result.temporaryPassword, altcha: ALTCHA },
      CONTEXT,
    );

    expect(
      outcome.result.status === 'authenticated' && outcome.result.account.mustChangePassword,
    ).toBe(true);

    const account = await service.changePassword(
      userId,
      { currentPassword: result.temporaryPassword, newPassword: `${PASSWORD}-neu` },
      outcome.session!.sessionId,
    );

    expect(account.mustChangePassword).toBe(false);
  });

  it('meldet ein unbekanntes Konto beim Reset', async () => {
    await expectErrorCode(
      service.resetPasswordAsAdmin('00000000-0000-4000-8000-000000000000'),
      'USER_NOT_FOUND',
    );
  });
});

describe('Konto-Löschung (Lastenheft §3.1)', () => {
  it('löscht Konto, Methoden und Sitzungen', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await service.deleteAccount(account.id, {
      confirmName: 'spieler',
      password: PASSWORD,
    });

    expect(repository.users).toHaveLength(0);
    expect(repository.methods).toHaveLength(0);
    expect(repository.sessions).toHaveLength(0);
  });

  it('verlangt den abgetippten Anzeigenamen und das Passwort', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );

    await expectErrorCode(
      service.deleteAccount(account.id, {
        confirmName: 'jemand.anders',
        password: PASSWORD,
      }),
      'AUTH_INVALID_CREDENTIALS',
    );
    await expectErrorCode(
      service.deleteAccount(account.id, { confirmName: 'spieler' }),
      'AUTH_INVALID_CREDENTIALS',
    );
    expect(repository.users).toHaveLength(1);
  });

  it('kommt bei reinen Anbieter-Konten ohne Passwort aus', async () => {
    const outcome = await service.completeProviderLogin(
      'discord',
      { state: 'state-discord' },
      { state: 'state-discord', codeVerifier: 'verifier-discord' },
      CONTEXT,
    );

    await service.deleteAccount(outcome.account.id, {
      confirmName: outcome.account.username ?? outcome.account.displayName,
    });

    expect(repository.users).toHaveLength(0);
  });

  it('lässt das Owner-Konto sich nicht selbst löschen (Lastenheft §2)', async () => {
    const { account } = await service.register(
      { username: 'besitzer', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );
    repository.users[0] = { ...repository.users[0]!, isOwner: true };

    await expectErrorCode(
      service.deleteAccount(account.id, {
        confirmName: 'besitzer',
        password: PASSWORD,
      }),
      'AUTH_OWNER_PROTECTED',
    );
  });
});

describe('Konto-DTO (Pflichtenheft §5.2)', () => {
  it('gibt dem Owner alle Rechte, unabhängig von Rollen', async () => {
    await service.register({ username: 'besitzer', password: PASSWORD, altcha: ALTCHA }, CONTEXT);
    repository.users[0] = { ...repository.users[0]!, isOwner: true };

    const account = await service.loadAccount(repository.users[0]!);

    expect(account.isOwner).toBe(true);
    expect(account.awaitingApproval).toBe(false);
    expect(Object.values(account.permissions).every((flag) => flag === true)).toBe(true);
  });

  it('meldet ein Konto mit weiterer Rolle nicht mehr als wartenden Gast', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );
    const userRole = roles.roles.find((role) => role.name === 'Nutzer');
    await roles.assignToUser(account.id, userRole!.id);

    const updated = await service.loadAccount(repository.users[0]!);

    expect(updated.awaitingApproval).toBe(false);
    expect(updated.permissions.canCreateServer).toBe(true);
  });

  it('enthält weder Passwort-Hash noch TOTP-Geheimnis', async () => {
    const { account } = await service.register(
      { username: 'spieler', password: PASSWORD, altcha: ALTCHA },
      CONTEXT,
    );
    const setup = await service.beginTwoFactorSetup(account.id);
    const withTotp = await service.loadAccount(repository.users[0]!);
    const serialized = JSON.stringify(withTotp);

    expect(serialized).not.toContain(setup.secret);
    expect(serialized).not.toContain('argon2');
    expect(serialized).not.toContain('passwordHash');
  });
});

describe('Anzeigename aus Provider-Angaben', () => {
  it('behält Leerzeichen und Satzzeichen – der Anzeigename darf sie tragen', () => {
    // `displayNameSchema` aus F1 begrenzt nur die Länge, nicht den Zeichensatz.
    expect(sanitizeDisplayName('Mein Name!')).toBe('Mein Name!');
    expect(sanitizeDisplayName('  spieler  ')).toBe('spieler');
    expect(sanitizeDisplayName('viel   Leerraum')).toBe('viel Leerraum');
  });

  it('hält die Obergrenze von 32 Zeichen ein', () => {
    expect(sanitizeDisplayName('x'.repeat(50))).toHaveLength(32);
  });

  it('setzt einen Ersatz, wenn nichts Brauchbares übrig bleibt', () => {
    expect(sanitizeDisplayName('   ')).toBe('Neues Konto');
    expect(sanitizeDisplayName('a').length).toBeGreaterThanOrEqual(2);
  });
});
