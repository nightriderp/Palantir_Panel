/**
 * Fachliche Regeln von Auth & Identity (Pflichtenheft §7, Lastenheft §3.1).
 *
 * Zentrale Regeln, die ausschließlich hier ausgewertet werden:
 * - Registrierung erzeugt ein Konto mit der geschützten Systemrolle „Gast"
 *   (Lastenheft §3.1, Zusammenspiel mit B2).
 * - Ein unbekannter Benutzername und ein falsches Passwort führen beide zu
 *   `AUTH_INVALID_CREDENTIALS` – und beide durchlaufen eine Argon2-Berechnung,
 *   damit sich Konten auch nicht über die Antwortzeit aufzählen lassen.
 * - Bei aktiver 2FA legt der erste Schritt **keine** Sitzung an, sondern gibt
 *   einen kurzlebigen Zwischen-Token aus (Vertrag aus F1, Pflichtenheft §7).
 * - Weitere Login-Methoden lassen sich nur im eingeloggten Zustand verknüpfen.
 * - Refresh-Token werden bei jeder Nutzung ersetzt; taucht ein bereits
 *   ersetzter Token erneut auf, werden **alle** Sitzungen des Kontos widerrufen.
 * - Die letzte verbliebene Login-Methode kann nicht getrennt werden.
 * - Das Owner-Konto kann sich nicht selbst löschen.
 *
 * Datenbank und HTTP stecken hinter {@link AuthRepository} bzw. bleiben in
 * `routes.ts`; diese Datei ist damit ohne Infrastruktur testbar (CLAUDE.md §4).
 */

import {
  type AccountDto,
  type AccountRoleSummary,
  type AuthMethodType,
  GUEST_ROLE_NAME,
  type LoginResult,
  type OAuthProvider,
  type PasswordResetResultDto,
  type SessionDto,
  type TwoFactorSetupDto,
} from '@palantir/contracts';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  DisableTwoFactorInput,
  LinkPasswordInput,
  LoginInput,
  RegisterInput,
} from '@palantir/validation';
import { buildPermissionActor, type PermissionActor, type RoleRepository } from '../rbac/index.js';
import { toAccountDto, toSessionDto } from './dto.js';
import { AuthError } from './errors.js';
import { generateTemporaryPassword, hashPassword, verifyPassword } from './passwords.js';
import type {
  AuthorizationRequest,
  CallbackQuery,
  PendingAuthorization,
  ProviderRegistry,
} from './providers.js';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from './totp.js';
import {
  createRefreshToken,
  hashRefreshToken,
  signTwoFactorToken,
  verifyTwoFactorToken,
} from './tokens.js';
import type { AuthMethodRecord, AuthRepository, SessionRecord, UserRecord } from './types.js';

/** Was ein Request über seinen Ursprung mitbringt (siehe `request-context.ts`). */
export interface RequestContext {
  readonly deviceInfo: string | null;
  readonly ipHint: string | null;
}

/** Eine frisch erzeugte Sitzung samt der Token, die in Cookies gehören. */
export interface IssuedSession {
  readonly sessionId: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export interface LoginOutcome {
  readonly result: LoginResult;
  /** `null`, solange der zweite Faktor fehlt – dann gibt es noch keine Sitzung. */
  readonly session: IssuedSession | null;
}

/** Ergebnis des zweiten Anmeldeschritts. */
export interface TwoFactorOutcome {
  readonly account: AccountDto;
  readonly session: IssuedSession;
}

export interface ProviderLoginOutcome {
  readonly account: AccountDto;
  readonly session: IssuedSession;
  /** `true`, wenn dabei ein neues Konto entstanden ist (Lastenheft §3.1). */
  readonly created: boolean;
}

export interface AuthServiceOptions {
  readonly repository: AuthRepository;
  /** Aus B2 – für die Gast-Rolle und die effektiven Rechte am Konto-DTO. */
  readonly roles: RoleRepository;
  readonly providers: ProviderRegistry;
  readonly refreshTokenTtlMs: number;
  /** Signaturschlüssel des 2FA-Zwischen-Tokens (derselbe wie beim Access-JWT). */
  readonly jwtSecret: string;
  /** Lebensdauer des 2FA-Zwischen-Tokens (Pflichtenheft §7: 5 Minuten). */
  readonly twoFactorTokenTtlMs: number;
  /** Aussteller-Bezeichnung im Authenticator, üblicherweise die Basis-Domain. */
  readonly totpIssuer: string;
  /** Einspeisbar, damit Tests feste Zeitpunkte setzen können. */
  readonly now?: () => Date;
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly roles: RoleRepository;
  private readonly providers: ProviderRegistry;
  private readonly refreshTokenTtlMs: number;
  private readonly jwtSecret: string;
  private readonly twoFactorTokenTtlMs: number;
  private readonly totpIssuer: string;
  private readonly now: () => Date;

  constructor(options: AuthServiceOptions) {
    this.repository = options.repository;
    this.roles = options.roles;
    this.providers = options.providers;
    this.refreshTokenTtlMs = options.refreshTokenTtlMs;
    this.jwtSecret = options.jwtSecret;
    this.twoFactorTokenTtlMs = options.twoFactorTokenTtlMs;
    this.totpIssuer = options.totpIssuer;
    this.now = options.now ?? ((): Date => new Date());
  }

  // -- Konto laden ----------------------------------------------------------

  /**
   * Baut den {@link PermissionActor} eines Kontos aus Owner-Flag und Rollen.
   *
   * Die Rechteberechnung selbst liegt vollständig in B2 – hier wird nur geladen
   * und weitergereicht.
   */
  async buildActor(user: UserRecord): Promise<PermissionActor> {
    const roles = await this.roles.listRolesForUser(user.id);

    return buildPermissionActor({
      isOwner: user.isOwner,
      roles: roles.map((role) => ({ grantedPermissions: role.permissions })),
    });
  }

  /** Vollständiges Konto-DTO (Pflichtenheft §5.2). */
  async loadAccount(user: UserRecord): Promise<AccountDto> {
    const [roleRecords, methods, actor] = await Promise.all([
      this.roles.listRolesForUser(user.id),
      this.repository.listAuthMethods(user.id),
      this.buildActor(user),
    ]);

    const roles: AccountRoleSummary[] = roleRecords.map((role) => ({
      id: role.id,
      name: role.name,
      isProtected: role.isProtected,
    }));

    return toAccountDto({ user, roles, methods, actor });
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.repository.findUserById(userId);

    if (!user) {
      throw new AuthError('USER_NOT_FOUND');
    }

    return user;
  }

  // -- Registrierung & Login ------------------------------------------------

  /**
   * Registrierung mit Anzeigename und Passwort (Lastenheft §3.1).
   *
   * Das neue Konto bekommt automatisch die Rolle „Gast" und hat damit bis zur
   * Freischaltung keinerlei Berechtigung.
   */
  async register(
    input: RegisterInput,
    context: RequestContext,
  ): Promise<{ account: AccountDto; session: IssuedSession }> {
    if (await this.repository.usernameExists(input.username)) {
      throw new AuthError('AUTH_USERNAME_TAKEN');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.repository.createUser({
      username: input.username,
      // Ohne eigene Angabe übernimmt das Konto den Benutzernamen als
      // Anzeigenamen (so beschrieben in `registerInputSchema`).
      displayName: input.displayName ?? input.username,
    });

    await this.repository.createAuthMethod({ userId: user.id, type: 'password', passwordHash });
    await this.assignGuestRole(user.id);

    const session = await this.issueSession(user.id, context);

    return { account: await this.loadAccount(user), session };
  }

  /**
   * Login mit Anzeigename und Passwort.
   *
   * Auch bei unbekanntem Konto wird ein Argon2-Vergleich gegen einen
   * Wegwerf-Hash gerechnet: sonst würde die deutlich kürzere Antwortzeit
   * verraten, dass es den Namen nicht gibt.
   */
  async login(input: LoginInput, context: RequestContext): Promise<LoginOutcome> {
    const user = await this.repository.findUserByUsername(input.username);
    const method = user ? await this.repository.findAuthMethod(user.id, 'password') : null;

    const passwordMatches = method?.passwordHash
      ? await verifyPassword(method.passwordHash, input.password)
      : await this.burnPasswordComparison(input.password);

    if (!user || !method || !passwordMatches) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS');
    }

    // Erst nach erfolgreicher Passwortprüfung: dass ein Konto gesperrt ist,
    // erfährt nur, wer die Zugangsdaten ohnehin kennt.
    if (user.banned) {
      throw new AuthError('AUTH_ACCOUNT_BANNED');
    }

    if (method.totpSecret && method.totpConfirmedAt) {
      // Zweiter Schritt nötig: noch keine Sitzung, nur ein Zwischen-Token
      // (Vertrag aus F1, Pflichtenheft §7).
      const { token, expiresAt } = await signTwoFactorToken(
        user.id,
        { secret: this.jwtSecret, ttlMs: this.twoFactorTokenTtlMs },
        this.now().getTime(),
      );

      return {
        result: {
          status: 'two_factor_required',
          twoFactorToken: token,
          expiresAt: expiresAt.toISOString(),
        },
        session: null,
      };
    }

    await this.repository.updateAuthMethod(method.id, { lastUsedAt: this.now() });

    const session = await this.issueSession(user.id, context);

    return {
      result: { status: 'authenticated', account: await this.loadAccount(user) },
      session,
    };
  }

  /**
   * Zweiter Anmeldeschritt: Zwischen-Token und TOTP-Code prüfen
   * (Pflichtenheft §7).
   *
   * Ein abgelaufener oder für einen anderen Zweck ausgestellter Token liefert
   * `AUTH_TWO_FACTOR_EXPIRED`, ein falscher Code `AUTH_TWO_FACTOR_INVALID` –
   * das Frontend soll „neu anmelden" von „vertippt" unterscheiden können.
   */
  async completeTwoFactorLogin(
    twoFactorToken: string,
    code: string,
    context: RequestContext,
  ): Promise<TwoFactorOutcome> {
    const userId = await verifyTwoFactorToken(twoFactorToken, { secret: this.jwtSecret });

    if (!userId) {
      throw new AuthError('AUTH_TWO_FACTOR_EXPIRED');
    }

    const user = await this.requireUser(userId);

    if (user.banned) {
      throw new AuthError('AUTH_ACCOUNT_BANNED');
    }

    const method = await this.repository.findAuthMethod(userId, 'password');

    if (!method?.totpSecret || !method.totpConfirmedAt) {
      throw new AuthError('AUTH_TWO_FACTOR_NOT_ENABLED');
    }

    if (!verifyTotp(method.totpSecret, code, this.now().getTime())) {
      throw new AuthError('AUTH_TWO_FACTOR_INVALID');
    }

    await this.repository.updateAuthMethod(method.id, { lastUsedAt: this.now() });

    return {
      account: await this.loadAccount(user),
      session: await this.issueSession(user.id, context),
    };
  }

  /**
   * Rechnet einen Argon2-Vergleich gegen einen konstanten Hash, dessen Passwort
   * niemand kennt. Dient allein dazu, die Antwortzeit anzugleichen; das
   * Ergebnis ist immer `false`.
   */
  private async burnPasswordComparison(password: string): Promise<boolean> {
    AuthService.decoyHash ??= await hashPassword('nicht-vergebenes-vergleichspasswort');

    return verifyPassword(AuthService.decoyHash, password);
  }

  private static decoyHash: string | null = null;

  // -- Sitzungen ------------------------------------------------------------

  private async issueSession(userId: string, context: RequestContext): Promise<IssuedSession> {
    const { token, hash } = createRefreshToken();
    const expiresAt = new Date(this.now().getTime() + this.refreshTokenTtlMs);

    const session = await this.repository.createSession({
      userId,
      refreshTokenHash: hash,
      deviceInfo: context.deviceInfo,
      ipHint: context.ipHint,
      expiresAt,
    });

    return { sessionId: session.id, refreshToken: token, expiresAt };
  }

  /**
   * Tauscht einen Refresh-Token gegen einen neuen (Rotation, Pflichtenheft §7).
   *
   * Wird ein bereits ersetzter oder widerrufener Token vorgelegt, ist das ein
   * starkes Anzeichen dafür, dass er abgegriffen wurde: dann werden **alle**
   * Sitzungen des Kontos widerrufen, nicht nur diese eine.
   */
  async refresh(
    refreshToken: string,
    context: RequestContext,
  ): Promise<{ account: AccountDto; session: IssuedSession }> {
    const tokenHash = hashRefreshToken(refreshToken);
    const session = await this.repository.findSessionByTokenHash(tokenHash);
    const now = this.now();

    if (!session) {
      // Der Token ist entweder nie vergeben worden oder bereits ersetzt. Nur
      // im zweiten Fall ist das ein Diebstahls-Anzeichen.
      const replaced = await this.repository.findSessionByPreviousTokenHash(tokenHash);

      if (replaced) {
        await this.repository.revokeAllSessions(replaced.userId, now);
      }

      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    if (session.revokedAt) {
      await this.repository.revokeAllSessions(session.userId, now);
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.repository.revokeSession(session.id, now);
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    const user = await this.requireUser(session.userId);

    if (user.banned) {
      await this.repository.revokeAllSessions(user.id, now);
      throw new AuthError('AUTH_ACCOUNT_BANNED');
    }

    const { token, hash } = createRefreshToken();
    const expiresAt = new Date(now.getTime() + this.refreshTokenTtlMs);

    await this.repository.rotateSession(session.id, {
      refreshTokenHash: hash,
      previousRefreshTokenHash: tokenHash,
      expiresAt,
      lastUsedAt: now,
    });

    // Gerätekennung und Herkunft mitzuführen wäre möglich, wird aber bewusst
    // nicht getan: die Sitzung soll das Gerät zeigen, an dem sie entstanden ist.
    void context;

    return {
      account: await this.loadAccount(user),
      session: { sessionId: session.id, refreshToken: token, expiresAt },
    };
  }

  /**
   * Löst die Sitzung eines Access-Tokens auf.
   *
   * Prüft zusätzlich zur Signatur, ob die Sitzung noch existiert und nicht
   * widerrufen ist – erst dadurch wirkt ein Remote-Logout sofort und nicht erst
   * mit dem Ablauf des Access-Tokens.
   */
  async resolveSession(sessionId: string): Promise<{ user: UserRecord; session: SessionRecord }> {
    const session = await this.repository.findSessionById(sessionId);
    const now = this.now();

    if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    const user = await this.requireUser(session.userId);

    if (user.banned) {
      throw new AuthError('AUTH_ACCOUNT_BANNED');
    }

    return { user, session };
  }

  /** Sitzungsübersicht des eigenen Kontos (Lastenheft §3.1). */
  async listSessions(userId: string, currentSessionId: string | null): Promise<SessionDto[]> {
    const sessions = await this.repository.listActiveSessions(userId, this.now().getTime());

    return sessions.map((session) => toSessionDto(session, currentSessionId));
  }

  /** Einzelner Remote-Logout (Lastenheft §3.1). */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.repository.findSessionById(sessionId);

    // Eine fremde Sitzung wird wie eine nicht vorhandene behandelt – sonst
    // ließe sich über die Antwort prüfen, ob eine Sitzungs-Id existiert.
    if (!session || session.userId !== userId) {
      throw new AuthError('AUTH_SESSION_NOT_FOUND');
    }

    if (!session.revokedAt) {
      await this.repository.revokeSession(sessionId, this.now());
    }
  }

  /** Abmeldung der aktuellen Sitzung. */
  async logout(sessionId: string): Promise<void> {
    const session = await this.repository.findSessionById(sessionId);

    if (session && !session.revokedAt) {
      await this.repository.revokeSession(sessionId, this.now());
    }
  }

  // -- Anbieter-Login und Account-Linking -----------------------------------

  /** Startet den Redirect zu einem Anbieter. */
  startProviderLogin(provider: OAuthProvider): {
    authorizationUrl: string;
    pending: PendingAuthorization;
  } {
    const adapter = this.providers[provider];

    if (!adapter.isConfigured()) {
      throw new AuthError('AUTH_PROVIDER_NOT_CONFIGURED');
    }

    const authorization: AuthorizationRequest = adapter.buildAuthorization();

    return {
      authorizationUrl: authorization.authorizationUrl,
      pending: { state: authorization.state, codeVerifier: authorization.codeVerifier },
    };
  }

  /**
   * Rückkehr vom Anbieter im **abgemeldeten** Zustand: anmelden oder neu
   * registrieren (Pflichtenheft §7).
   *
   * Ist die Identität bekannt, wird das zugehörige Konto angemeldet. Ist sie
   * unbekannt, entsteht ein neues Konto mit der Rolle „Gast".
   */
  async completeProviderLogin(
    provider: OAuthProvider,
    query: CallbackQuery,
    pending: PendingAuthorization,
    context: RequestContext,
  ): Promise<ProviderLoginOutcome> {
    const identity = await this.providers[provider].completeLogin(query, pending);
    const existing = await this.repository.findAuthMethodByProvider(
      provider,
      identity.providerUserId,
    );

    if (existing) {
      const user = await this.requireUser(existing.userId);

      if (user.banned) {
        throw new AuthError('AUTH_ACCOUNT_BANNED');
      }

      // Anzeigename und Avatar beim Anbieter ändern sich – für die
      // Freischalt-Warteliste soll der aktuelle Stand dort stehen.
      await this.repository.updateAuthMethod(existing.id, {
        providerDisplayName: identity.displayName,
        providerAvatarUrl: identity.avatarUrl,
        lastUsedAt: this.now(),
      });

      return {
        account: await this.loadAccount(user),
        session: await this.issueSession(user.id, context),
        created: false,
      };
    }

    // Der Anzeigename muss nicht eindeutig sein (Vertrag aus F1); eine
    // Anmeldekennung bekommt das Konto erst, wenn ein Passwort verknüpft wird.
    const user = await this.repository.createUser({
      username: null,
      displayName: sanitizeDisplayName(identity.displayName ?? provider),
    });

    await this.repository.createAuthMethod({
      userId: user.id,
      type: provider,
      providerUserId: identity.providerUserId,
      providerDisplayName: identity.displayName,
      providerAvatarUrl: identity.avatarUrl,
    });
    await this.assignGuestRole(user.id);

    return {
      account: await this.loadAccount(user),
      session: await this.issueSession(user.id, context),
      created: true,
    };
  }

  /**
   * Rückkehr vom Anbieter im **eingeloggten** Zustand: die Methode wird mit dem
   * bestehenden Konto verknüpft (Lastenheft §3.1 – Verknüpfen nur eingeloggt).
   */
  async completeProviderLink(
    provider: OAuthProvider,
    query: CallbackQuery,
    pending: PendingAuthorization,
    userId: string,
  ): Promise<AccountDto> {
    const identity = await this.providers[provider].completeLogin(query, pending);
    const existing = await this.repository.findAuthMethodByProvider(
      provider,
      identity.providerUserId,
    );

    if (existing) {
      // Auch dann ein Konflikt, wenn die Methode bereits am eigenen Konto
      // hängt – der Zielzustand ist zwar erreicht, aber der Nutzer hat gerade
      // versucht, eine schon vergebene Identität zu verknüpfen.
      throw new AuthError('AUTH_METHOD_ALREADY_LINKED');
    }

    const user = await this.requireUser(userId);

    if (await this.repository.findAuthMethod(userId, provider)) {
      throw new AuthError('AUTH_METHOD_ALREADY_LINKED');
    }

    await this.repository.createAuthMethod({
      userId,
      type: provider,
      providerUserId: identity.providerUserId,
      providerDisplayName: identity.displayName,
      providerAvatarUrl: identity.avatarUrl,
    });

    return this.loadAccount(user);
  }

  /** Passwort als weitere Login-Methode ergänzen (Lastenheft §3.1). */
  async linkPassword(userId: string, input: LinkPasswordInput): Promise<AccountDto> {
    await this.requireUser(userId);

    if (await this.repository.findAuthMethod(userId, 'password')) {
      throw new AuthError('AUTH_METHOD_ALREADY_LINKED');
    }

    const owner = await this.repository.findUserByUsername(input.username);

    if (owner && owner.id !== userId) {
      throw new AuthError('AUTH_USERNAME_TAKEN');
    }

    await this.repository.createAuthMethod({
      userId,
      type: 'password',
      passwordHash: await hashPassword(input.password),
    });

    // Erst jetzt bekommt das Konto eine Anmeldekennung – vorher gab es nichts,
    // womit man sich per Passwort hätte anmelden können.
    const updated = await this.repository.setUsername(userId, input.username);

    return this.loadAccount(updated);
  }

  /**
   * Login-Methode trennen.
   *
   * Die letzte verbliebene Methode bleibt bestehen – sonst käme niemand mehr in
   * das Konto (Lastenheft §3.1). Wer das Konto loswerden will, löscht es.
   */
  async unlinkMethod(userId: string, type: AuthMethodType): Promise<AccountDto> {
    const user = await this.requireUser(userId);
    const methods = await this.repository.listAuthMethods(userId);
    const target = methods.find((method) => method.type === type);

    if (!target) {
      throw new AuthError('AUTH_METHOD_NOT_FOUND');
    }

    if (methods.length <= 1) {
      throw new AuthError('AUTH_METHOD_LAST_REMAINING');
    }

    await this.repository.deleteAuthMethod(target.id);

    return this.loadAccount(user);
  }

  // -- Passwort -------------------------------------------------------------

  /**
   * Passwortwechsel im eingeloggten Zustand.
   *
   * Löscht anschließend ein gesetztes `mustChangePassword` und widerruft alle
   * **anderen** Sitzungen: wer das Passwort ändert, tut das oft gerade, weil er
   * einen fremden Zugriff vermutet.
   */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    keepSessionId: string | null,
  ): Promise<AccountDto> {
    const user = await this.requireUser(userId);
    const method = await this.repository.findAuthMethod(userId, 'password');

    if (!method?.passwordHash) {
      throw new AuthError('AUTH_METHOD_NOT_FOUND');
    }

    if (!(await verifyPassword(method.passwordHash, input.currentPassword))) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS');
    }

    await this.repository.updateAuthMethod(method.id, {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
    });

    await this.revokeOtherSessions(userId, keepSessionId);

    return this.loadAccount(user);
  }

  /**
   * Vom Admin ausgelöster Passwort-Reset (Lastenheft §3.1 – ohne E-Mail-Versand,
   * Ablauf in Pflichtenheft §7).
   *
   * Der Aufrufer muss `user.manage` besitzen; das prüft die Route über den Guard
   * aus B2. Alle Sitzungen des betroffenen Kontos werden widerrufen.
   */
  async resetPasswordAsAdmin(targetUserId: string): Promise<PasswordResetResultDto> {
    const user = await this.requireUser(targetUserId);
    const method = await this.repository.findAuthMethod(targetUserId, 'password');

    if (!method) {
      throw new AuthError('AUTH_METHOD_NOT_FOUND');
    }

    const temporaryPassword = generateTemporaryPassword();

    await this.repository.updateAuthMethod(method.id, {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    });
    await this.repository.revokeAllSessions(user.id, this.now());

    return { userId: user.id, temporaryPassword };
  }

  // -- 2FA (TOTP) -----------------------------------------------------------

  /**
   * Beginnt die 2FA-Einrichtung und liefert das Geheimnis genau einmal aus
   * (Pflichtenheft §7). Aktiv wird 2FA erst mit {@link confirmTwoFactor}.
   */
  async beginTwoFactorSetup(userId: string): Promise<TwoFactorSetupDto> {
    const user = await this.requireUser(userId);
    const method = await this.repository.findAuthMethod(userId, 'password');

    if (!method) {
      // 2FA gibt es ausschließlich für Passwort-Konten (Pflichtenheft §7).
      throw new AuthError('AUTH_METHOD_NOT_FOUND');
    }

    if (method.totpSecret && method.totpConfirmedAt) {
      throw new AuthError('AUTH_TWO_FACTOR_ALREADY_ENABLED');
    }

    const secret = generateTotpSecret();

    // Eine unbestätigte Einrichtung wird schlicht überschrieben: der Nutzer hat
    // den vorherigen QR-Code dann offensichtlich nicht zu Ende gescannt.
    await this.repository.updateAuthMethod(method.id, {
      totpSecret: secret,
      totpConfirmedAt: null,
    });

    return {
      secret,
      otpauthUri: buildOtpauthUri({
        secretBase32: secret,
        accountName: user.displayName,
        issuer: this.totpIssuer,
      }),
    };
  }

  /** Schließt die 2FA-Einrichtung mit einem gültigen Code ab. */
  async confirmTwoFactor(userId: string, code: string): Promise<AccountDto> {
    const user = await this.requireUser(userId);
    const method = await this.repository.findAuthMethod(userId, 'password');

    if (!method?.totpSecret) {
      throw new AuthError('AUTH_TWO_FACTOR_NOT_ENABLED');
    }

    if (method.totpConfirmedAt) {
      throw new AuthError('AUTH_TWO_FACTOR_ALREADY_ENABLED');
    }

    if (!verifyTotp(method.totpSecret, code, this.now().getTime())) {
      throw new AuthError('AUTH_TWO_FACTOR_INVALID');
    }

    await this.repository.updateAuthMethod(method.id, { totpConfirmedAt: this.now() });

    return this.loadAccount(user);
  }

  /** 2FA abschalten – verlangt Passwort **und** gültigen Code (Pflichtenheft §7). */
  async disableTwoFactor(userId: string, input: DisableTwoFactorInput): Promise<AccountDto> {
    const user = await this.requireUser(userId);
    const method = await this.repository.findAuthMethod(userId, 'password');

    if (!method?.totpSecret || !method.totpConfirmedAt) {
      throw new AuthError('AUTH_TWO_FACTOR_NOT_ENABLED');
    }

    if (!method.passwordHash || !(await verifyPassword(method.passwordHash, input.password))) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS');
    }

    if (!verifyTotp(method.totpSecret, input.code, this.now().getTime())) {
      throw new AuthError('AUTH_TWO_FACTOR_INVALID');
    }

    await this.repository.updateAuthMethod(method.id, {
      totpSecret: null,
      totpConfirmedAt: null,
    });

    return this.loadAccount(user);
  }

  /**
   * 2FA-Wiederherstellung durch einen Admin (Pflichtenheft §7).
   *
   * Bewusst der einzige Weg an einer verlorenen 2FA vorbei – es gibt keine
   * Wiederherstellungscodes. Der Aufrufer braucht `user.manage`; das prüft die
   * Route über den Guard aus B2.
   */
  async disableTwoFactorAsAdmin(targetUserId: string): Promise<void> {
    await this.requireUser(targetUserId);

    const method = await this.repository.findAuthMethod(targetUserId, 'password');

    if (!method?.totpSecret || !method.totpConfirmedAt) {
      throw new AuthError('AUTH_TWO_FACTOR_NOT_ENABLED');
    }

    await this.repository.updateAuthMethod(method.id, {
      totpSecret: null,
      totpConfirmedAt: null,
    });
  }

  // -- Konto-Löschung -------------------------------------------------------

  /**
   * Selbstständige Konto-Löschung (Lastenheft §3.1).
   *
   * Der Anzeigename muss abgetippt werden. Hat das Konto eine Passwort-Methode,
   * kommt das Passwort dazu. Das Owner-Konto kann sich nicht selbst löschen –
   * sonst stünde die Instanz ohne Owner da (Lastenheft §2).
   */
  async deleteAccount(userId: string, input: DeleteAccountInput): Promise<void> {
    const user = await this.requireUser(userId);

    if (user.isOwner) {
      throw new AuthError('AUTH_OWNER_PROTECTED');
    }

    // Bestätigt wird mit der Anmeldekennung, sonst mit dem Anzeigenamen –
    // reine Provider-Konten haben keine Kennung.
    const expectedName = user.username ?? user.displayName;

    if (input.confirmName.toLowerCase() !== expectedName.toLowerCase()) {
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 'Der eingegebene Name stimmt nicht.');
    }

    const method = await this.repository.findAuthMethod(userId, 'password');

    if (method?.passwordHash) {
      if (!input.password || !(await verifyPassword(method.passwordHash, input.password))) {
        throw new AuthError('AUTH_INVALID_CREDENTIALS');
      }
    }

    // `AuthMethod`, `Session` und `UserRole` hängen mit `ON DELETE CASCADE` am
    // Konto und verschwinden mit (Pflichtenheft §6).
    await this.repository.deleteUser(userId);
  }

  // -- Hilfsfunktionen ------------------------------------------------------

  /**
   * Weist die geschützte Systemrolle „Gast" zu (Lastenheft §3.1, B2).
   *
   * Fehlt die Rolle, ist die Ersteinrichtung nicht vollständig durchlaufen
   * (`pnpm --filter @palantir/backend db:seed`, SETUP.md §2.4). Das ist ein
   * Betriebsfehler und keine Nutzereingabe – deshalb eine gewöhnliche Ausnahme
   * mit klarem Hinweis statt eines Fehlercodes aus dem Katalog.
   */
  private async assignGuestRole(userId: string): Promise<void> {
    const guestRole = await this.roles.findByName(GUEST_ROLE_NAME);

    if (!guestRole) {
      throw new Error(
        `Die Systemrolle "${GUEST_ROLE_NAME}" fehlt. Bitte einmalig ` +
          '"pnpm --filter @palantir/backend db:seed" ausführen (SETUP.md §2.4).',
      );
    }

    await this.roles.assignToUser(userId, guestRole.id);
  }

  private async revokeOtherSessions(userId: string, keepSessionId: string | null): Promise<void> {
    const sessions = await this.repository.listActiveSessions(userId, this.now().getTime());
    const now = this.now();

    for (const session of sessions) {
      if (session.id !== keepSessionId) {
        await this.repository.revokeSession(session.id, now);
      }
    }
  }
}

/**
 * Passt einen vom Provider gelieferten Namen an `displayNameSchema` an
 * (2–32 Zeichen nach Entfernen von umschließendem Leerraum).
 *
 * Bewusst schonend: der Anzeigename muss nicht eindeutig sein und darf
 * Leerzeichen und Sonderzeichen enthalten – gekürzt wird nur, was das Schema
 * ablehnen würde. Bleibt nichts Brauchbares übrig, etwa bei einem rein aus
 * Emoji bestehenden Namen, tritt ein neutraler Ersatz an seine Stelle.
 */
export function sanitizeDisplayName(preferred: string): string {
  const cleaned = preferred.normalize('NFC').replace(/\s+/gu, ' ').trim().slice(0, 32);

  return cleaned.length >= 2 ? cleaned : 'Neues Konto';
}

export type { AuthMethodRecord, SessionRecord, UserRecord };
