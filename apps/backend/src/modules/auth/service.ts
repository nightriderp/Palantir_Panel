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
 * - Admin-Eingriffe (Konto anlegen, Passwort-Reset, 2FA-Abschaltung) folgen der
 *   Rangregel aus B2: `user.manage` allein vergibt keine Verwaltungsrolle und
 *   fasst kein Konto mit Verwaltungsrolle an; das Owner-Konto nie
 *   (Fundpunkte 119 und 124).
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
  type NotificationEventPayloads,
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
  CreateUserInput,
  UpdateProfileInput,
} from '@palantir/validation';
import {
  buildPermissionActor,
  grantsAdministration,
  hasPermission,
  type PermissionActor,
  type RoleRepository,
} from '../rbac/index.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../db/errors.js';
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

/**
 * Kulanzfrist auf den eben ersetzten Refresh-Token (Pflichtenheft §7).
 *
 * Bewusst eine Konstante und keine Einstellung: Der Wert ist eine
 * Sicherheitsabwägung, keine Betriebsgröße. Er soll genau die Spanne abdecken,
 * in der zwei Anfragen desselben Browsers unterwegs sein können (Tab-Wechsel,
 * Middleware neben dem Client, ein Wiederholungsversuch) – lang genug, um
 * legitime Doppelanfragen zu tragen, kurz genug, dass ein abgegriffener Token
 * praktisch immer außerhalb liegt und die Diebstahlerkennung greift.
 */
const REFRESH_ROTATION_GRACE_MS = 30_000;

/**
 * Wie oft die Rotation ein verlorenes Rennen wiederholen darf.
 *
 * Zwei Versuche decken den realistischen Fall ab (genau eine parallele
 * Anfrage). Danach wird abgebrochen, statt unter Dauerlast beliebig viele
 * Token zu erzeugen.
 */
const REFRESH_ROTATION_ATTEMPTS = 3;

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

/** Ereignisse, die B1 auslöst, mit ihrer vertraglichen Nutzlast. */
export interface AuthEventPayloads {
  'user.registered': NotificationEventPayloads['user.registered'];
}

/**
 * Ereignissenke der Notification-Engine (B6), wie sie B3/B5/B7 bekommen.
 *
 * B1 kennt B6 nicht, es meldet nur `user.registered`. `emit()` wirft nie
 * (Pflichtenheft §14), der Registrierungs-Ablauf hängt also nie an der
 * Zustellung.
 *
 * Die Nutzlast kommt aus dem Vertrag statt aus `Record<string, unknown>`: Mit
 * der offenen Form fällt ein fehlendes Feld erst in der Empfängerauflösung auf
 * – und dort still (Audit W1-7, event-flow-02).
 */
export interface AuthEventSink {
  emit(event: 'user.registered', payload: AuthEventPayloads['user.registered']): void;
}

/** Senke, solange B6 nicht eingehängt ist (Tests, Betrieb ohne Notifications). */
export const noopAuthEventSink: AuthEventSink = {
  emit() {
    // absichtlich leer
  },
};

/**
 * Senke für „alle Sitzungen dieses Kontos sind widerrufen" (Audit W2-2,
 * `backend-community-visibility-03`).
 *
 * B1 kennt weder Chat noch Live-Kanal; es meldet nur den Widerruf. Wer daran
 * hängt – der Chat-Verteiler schließt die offenen Sockets des Kontos –
 * entscheidet `server.ts`, genau wie bei {@link AuthEventSink}. `revoked()`
 * wirft nie: Ein Remote-Logout darf nicht daran scheitern, dass ein Verteiler
 * klemmt.
 */
export interface SessionRevocationSink {
  revoked(userId: string): void;
}

/** Senke, solange niemand am Widerruf hängt (Tests, Betrieb ohne Chat). */
export const noopSessionRevocationSink: SessionRevocationSink = {
  revoked() {
    // absichtlich leer
  },
};

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
  /** Notification-Senke aus B6; ohne Angabe wird nichts gemeldet. */
  readonly events?: AuthEventSink;
  /**
   * Empfänger des Sitzungswiderrufs (B7 schließt daraufhin die Live-Sockets des
   * Kontos); ohne Angabe wird nichts gemeldet.
   */
  readonly sessions?: SessionRevocationSink;
  /**
   * Nimmt die Instanz Selbstregistrierungen an? (Mockup-Abgleich 12.1.1.)
   *
   * Kommt aus B8 (`InstanceSettingsService`). Ohne Angabe bleibt die
   * Registrierung offen – so verhielt sich die Instanz, bevor es die
   * Einstellung gab.
   */
  readonly selfRegistration?: () => Promise<boolean>;
  /** Standardrolle beim Anlegen durch einen Admin; Vorgabe "Nutzer". */
  readonly defaultRoleName?: string;
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
  private readonly events: AuthEventSink;
  /** Empfänger des Sitzungswiderrufs (Audit W2-2). */
  private readonly sessions: SessionRevocationSink;
  /**
   * Nimmt die Instanz Selbstregistrierungen an? (Mockup-Abgleich 12.1.1.)
   *
   * Optional: Ohne diese Abhaengigkeit bleibt die Registrierung offen - so
   * verhielt sich die Instanz, bevor es die Einstellung gab. Bewusst eine
   * Funktion und kein Wert: Der Schalter kann sich zur Laufzeit aendern.
   */
  private readonly selfRegistration: (() => Promise<boolean>) | null;
  /** Rolle, die ein vom Admin angelegtes Konto ohne eigene Auswahl bekommt. */
  private readonly defaultRoleName: string;

  constructor(options: AuthServiceOptions) {
    this.repository = options.repository;
    this.roles = options.roles;
    this.providers = options.providers;
    this.refreshTokenTtlMs = options.refreshTokenTtlMs;
    this.jwtSecret = options.jwtSecret;
    this.twoFactorTokenTtlMs = options.twoFactorTokenTtlMs;
    this.totpIssuer = options.totpIssuer;
    this.now = options.now ?? ((): Date => new Date());
    this.events = options.events ?? noopAuthEventSink;
    this.sessions = options.sessions ?? noopSessionRevocationSink;
    this.selfRegistration = options.selfRegistration ?? null;
    this.defaultRoleName = options.defaultRoleName ?? 'Nutzer';
  }

  /**
   * Meldet `user.registered` an die Notification-Engine (Pflichtenheft §14).
   *
   * `awaitingApproval` kommt aus dem fertig gebauten Konto-DTO – dieselbe Regel
   * wie überall (`isAwaitingApproval`, siehe `dto.ts`), nicht hier neu geraten.
   */
  private emitUserRegistered(account: AccountDto): void {
    this.events.emit('user.registered', {
      at: this.now().toISOString(),
      // Eine Registrierung hat keinen auslösenden Dritten: Beim Selbstanlegen
      // ist das Konto selbst der Gegenstand, beim Anlegen durch einen Admin
      // kennt diese Stelle ihn nicht (Pflichtenheft §14).
      actorId: null,
      userId: account.id,
      displayName: account.displayName,
      awaitingApproval: account.awaitingApproval,
    });
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

    // Der Rollenname fließt mit, weil `buildPermissionActor` daraus die
    // Freischaltung ableitet (Lastenheft §3.1) – nicht für die Rechte selbst.
    return buildPermissionActor({
      isOwner: user.isOwner,
      roles: roles.map((role) => ({ grantedPermissions: role.permissions, name: role.name })),
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

  /**
   * Legt ein Konto an und beantwortet die vergebene Kennung fachlich
   * (Audit W2-9, `backend-auth-03`).
   *
   * `usernameExists()` und `createUser()` sind zwei getrennte Anweisungen ohne
   * gemeinsame Transaktion. Zwei gleichzeitige Registrierungen mit demselben
   * Namen bestehen deshalb beide die Vorprüfung; den zweiten Insert fängt erst
   * der partielle Unique-Index `users_username_lower_idx` – bisher als roher
   * Postgres-Fehler und damit als 500. Der Verlierer des Rennens bekommt jetzt
   * dieselbe Antwort wie der Aufrufer, der eine Sekunde später gekommen wäre.
   *
   * Die Vorprüfung an den Aufrufstellen bleibt: Sie ist der übliche Weg und
   * liefert die Ablehnung, ohne ein Konto anzulegen.
   */
  private async createUserOrFail(data: {
    username: string | null;
    displayName: string;
  }): Promise<UserRecord> {
    try {
      return await this.repository.createUser(data);
    } catch (error) {
      if (data.username !== null && isUniqueViolation(error)) {
        throw new AuthError('AUTH_USERNAME_TAKEN');
      }

      throw error;
    }
  }

  /**
   * Schranke für Admin-Eingriffe an fremden Konten (Fundpunkt 124).
   *
   * Das Owner-Konto ändert Passwort und 2FA ausschließlich über die eigenen
   * Routen – kein Admin-Eingriff erreicht es. Ein Konto, dessen Rollen selbst
   * Rollen- oder Nutzerverwaltung verleihen, darf nur anfassen, wer `role.manage`
   * besitzt: dieselbe Regel wie beim Zuweisen solcher Rollen in B2
   * (`requireAssignmentAllowed`). Ohne sie könnte `user.manage` allein jedes
   * Admin-Konto per Passwort-Reset übernehmen.
   */
  private async requireAdminTargetAllowed(
    actor: PermissionActor,
    target: UserRecord,
  ): Promise<void> {
    if (target.isOwner) {
      throw new AuthError(
        'AUTH_OWNER_PROTECTED',
        'Das Owner-Konto lässt sich nicht über Admin-Eingriffe ändern.',
      );
    }

    if (hasPermission(actor, 'role.manage')) {
      return;
    }

    const rollen = await this.roles.listRolesForUser(target.id);

    if (rollen.some((rolle) => grantsAdministration(rolle))) {
      throw new AuthError(
        'PERMISSION_DENIED',
        'Konten mit Rollen- oder Nutzerverwaltung darf nur ändern, wer selbst role.manage besitzt.',
      );
    }
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
    /*
     * Nimmt die Instanz überhaupt neue Konten an? (Mockup-Abgleich 12.1.1.)
     *
     * Vor der Namensprüfung: Ist die Selbstregistrierung zu, soll die Antwort
     * nicht davon abhängen, ob der gewünschte Name frei ist – das verriete,
     * welche Namen es gibt.
     */
    await this.assertRegistrationOpen();

    if (await this.repository.usernameExists(input.username)) {
      throw new AuthError('AUTH_USERNAME_TAKEN');
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.createUserOrFail({
      username: input.username,
      // Ohne eigene Angabe übernimmt das Konto den Benutzernamen als
      // Anzeigenamen (so beschrieben in `registerInputSchema`).
      displayName: input.displayName ?? input.username,
    });

    await this.repository.createAuthMethod({ userId: user.id, type: 'password', passwordHash });
    await this.assignGuestRole(user.id);

    const session = await this.issueSession(user.id, context);

    const account = await this.loadAccount(user);
    this.emitUserRegistered(account);

    return { account, session };
  }

  /**
   * Wirft, wenn die Instanz keine Selbstregistrierung annimmt
   * (Mockup-Abgleich 12.1.1).
   *
   * Oeffentlich, damit die Route sie **vor** der ALTCHA-Pruefung stellen kann:
   * Ist die Registrierung zu, ist ein geloester Nachweis vergebene Rechenzeit.
   * Der Aufruf steht trotzdem auch in `register()` – eine Regel, die nur in der
   * Route steht, gilt beim naechsten Aufrufer nicht mehr.
   */
  async assertRegistrationOpen(): Promise<void> {
    if (this.selfRegistration !== null && !(await this.selfRegistration())) {
      throw new AuthError('AUTH_REGISTRATION_DISABLED');
    }
  }

  /**
   * Konto durch einen Administrator anlegen (Mockup-Abgleich 12.1.1).
   *
   * Unterschiede zur Selbstregistrierung, alle beabsichtigt:
   * - **keine Sitzung**: Angelegt wird ein fremdes Konto, angemeldet bleibt der
   *   Administrator.
   * - **kein ALTCHA**: Den Nachweis legt ab, wer sich selbst registriert.
   * - **sofort freigeschaltet**: Ein vom Admin angelegtes Konto in die eigene
   *   Warteliste zu stellen, wäre eine Bestätigung der eigenen Entscheidung.
   *   Die Rollen kommen mit; ohne Angabe die Standardrolle.
   *
   * Die Sperre der Selbstregistrierung gilt hier **nicht**: Sie richtet sich an
   * Fremde, nicht an den Betreiber.
   */
  async createUserAsAdmin(
    actor: PermissionActor,
    input: CreateUserInput,
    roleIds: readonly string[],
  ): Promise<AccountDto> {
    if (await this.repository.usernameExists(input.username)) {
      throw new AuthError('AUTH_USERNAME_TAKEN');
    }

    /*
     * Rollen werden VOR dem Anlegen geprüft (Fundpunkt 119): Die Schranke aus
     * B2 – `user.manage` allein vergibt keine Rolle, die selbst `role.manage`
     * oder `user.manage` verleiht – gilt hier genauso wie beim regulären
     * Zuweisen über den RoleService. Ein abgelehnter Aufruf hinterlässt kein
     * halbes Konto, und eine unbekannte Rolle endet als benannter Fehler statt
     * als FK-Verletzung.
     */
    const gepruefteRollen: string[] = [];

    for (const roleId of roleIds) {
      const rolle = await this.roles.findById(roleId);

      if (!rolle) {
        throw new AuthError('ROLE_NOT_FOUND');
      }

      if (grantsAdministration(rolle) && !hasPermission(actor, 'role.manage')) {
        throw new AuthError(
          'PERMISSION_DENIED',
          'Rollen mit Rollen- oder Nutzerverwaltung darf nur vergeben, wer selbst role.manage besitzt.',
        );
      }

      gepruefteRollen.push(rolle.id);
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.createUserOrFail({
      username: input.username,
      displayName: input.displayName ?? input.username,
    });

    await this.repository.createAuthMethod({ userId: user.id, type: 'password', passwordHash });

    /*
     * Ohne Auswahl die Standardrolle – dieselbe, die eine Freigabe ueber die
     * Warteliste vergibt. Ein Konto ganz ohne Rolle waere weder freigeschaltet
     * noch wartend: Es taucht in keiner Liste auf und kann nichts.
     */
    const zuweisen =
      gepruefteRollen.length > 0 ? gepruefteRollen : [await this.requireDefaultRoleId()];

    for (const roleId of zuweisen) {
      await this.roles.assignToUser(user.id, roleId);
    }

    return this.loadAccount(user);
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
    // Dieselbe Zeitquelle wie beim Ausstellen (`signTwoFactorToken`) – sonst
    // prüft `jose` gegen die Systemuhr und der Token gilt fälschlich als
    // abgelaufen.
    const userId = await verifyTwoFactorToken(
      twoFactorToken,
      { secret: this.jwtSecret },
      this.now().getTime(),
    );

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

  /**
   * Widerruft **alle** Sitzungen eines Kontos und meldet das der Senke.
   *
   * Einziger Weg zu `repository.revokeAllSessions`, damit kein Pfad den
   * Widerruf vollzieht, ohne die daran hängenden Live-Verbindungen zu schließen
   * (Audit W2-2). Der Einzel-Logout meldet bewusst nichts: Der Verteiler
   * adressiert je Konto, nicht je Sitzung – er würde die übrigen Geräte
   * mitschließen.
   */
  private async revokeEverySession(userId: string, now: Date): Promise<void> {
    await this.repository.revokeAllSessions(userId, now);

    try {
      this.sessions.revoked(userId);
    } catch {
      // Der Widerruf gilt auch dann, wenn der Verteiler klemmt.
    }
  }

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
   *
   * Eine Ausnahme ist die Kulanzfrist unmittelbar nach der Rotation
   * (`REFRESH_ROTATION_GRACE_MS`): Dass zwei Anfragen mit demselben Token
   * eintreffen, ist im Browser der Normalfall und kein Diebstahl – zwei Tabs,
   * die Middleware neben dem Client, ein Wiederholungsversuch nach einem
   * Verbindungsabbruch. Innerhalb der Frist gilt der eben ersetzte Token
   * deshalb weiter und liefert ein frisches Token-Paar, erst danach greift die
   * Diebstahlerkennung (Fundpunkte backend-auth-02, frontend-lib-01).
   */
  async refresh(
    refreshToken: string,
    context: RequestContext,
  ): Promise<{ account: AccountDto; session: IssuedSession }> {
    const tokenHash = hashRefreshToken(refreshToken);
    const now = this.now();
    // Der vorgelegte Token ist entweder der aktuelle oder der eben erst
    // ersetzte; beide Fälle führen auf dieselbe Sitzung.
    const session =
      (await this.repository.findSessionByTokenHash(tokenHash)) ??
      (await this.repository.findSessionByPreviousTokenHash(tokenHash));

    if (!session) {
      // Nie vergeben oder so alt, dass er nicht einmal mehr als vorheriger
      // Token geführt wird – daraus lässt sich kein Diebstahl ableiten.
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    if (session.revokedAt) {
      await this.revokeEverySession(session.userId, now);
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    if (session.refreshTokenHash !== tokenHash && !this.withinRotationGrace(session, now)) {
      // Ein längst ersetzter Token taucht wieder auf: Diebstahls-Anzeichen.
      // Über `revokeEverySession`, damit auch die Live-Kanäle des Kontos
      // schließen (Audit W2-2, backend-community-visibility-03).
      await this.revokeEverySession(session.userId, now);
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      await this.repository.revokeSession(session.id, now);
      throw new AuthError('AUTH_SESSION_EXPIRED');
    }

    const user = await this.requireUser(session.userId);

    if (user.banned) {
      await this.revokeEverySession(user.id, now);
      throw new AuthError('AUTH_ACCOUNT_BANNED');
    }

    const issued = await this.rotateRefreshToken(session, now);

    // Gerätekennung und Herkunft mitzuführen wäre möglich, wird aber bewusst
    // nicht getan: die Sitzung soll das Gerät zeigen, an dem sie entstanden ist.
    void context;

    return { account: await this.loadAccount(user), session: issued };
  }

  /**
   * Liegt die letzte Rotation innerhalb der Kulanzfrist?
   *
   * Nie rotierte Sitzungen (`rotatedAt === null`, u. a. alle Sitzungen aus der
   * Zeit vor der Spalte) fallen bewusst heraus: Ohne Zeitstempel lässt sich
   * „gerade eben" nicht belegen, und im Zweifel gilt die strengere Regel.
   */
  private withinRotationGrace(session: SessionRecord, now: Date): boolean {
    return (
      session.rotatedAt !== null &&
      now.getTime() - session.rotatedAt.getTime() <= REFRESH_ROTATION_GRACE_MS
    );
  }

  /**
   * Rotiert den Refresh-Token der Sitzung und gibt das neue Paar zurück.
   *
   * Das Update ist bedingt (`WHERE refresh_token_hash = <vorgefunden>`). Kommt
   * es auf null Zeilen, hat eine parallele Anfrage zwischen Lesen und
   * Schreiben rotiert. Dann wird der frische Stand gelesen und – solange die
   * Kulanzfrist trägt – erneut rotiert, damit auch der zweite Aufrufer ein
   * gültiges eigenes Token bekommt, statt die Sitzung des ersten zu
   * übernehmen. Der Ausgestellte des Konkurrenten wird dabei zum vorherigen
   * Token und bleibt seinerseits in der Frist gültig.
   *
   * Die Zahl der Versuche ist begrenzt: Ein Dauerrennen soll die Anfrage
   * beenden, nicht endlos Token erzeugen.
   */
  private async rotateRefreshToken(session: SessionRecord, now: Date): Promise<IssuedSession> {
    let current = session;

    for (let versuch = 0; versuch < REFRESH_ROTATION_ATTEMPTS; versuch += 1) {
      const { token, hash } = createRefreshToken();
      const expiresAt = new Date(now.getTime() + this.refreshTokenTtlMs);

      const rotated = await this.repository.rotateSession(current.id, {
        refreshTokenHash: hash,
        previousRefreshTokenHash: current.refreshTokenHash,
        expiresAt,
        lastUsedAt: now,
        rotatedAt: now,
      });

      if (rotated) {
        return { sessionId: rotated.id, refreshToken: token, expiresAt };
      }

      const fresh = await this.repository.findSessionById(current.id);

      if (!fresh || fresh.revokedAt || !this.withinRotationGrace(fresh, now)) {
        throw new AuthError('AUTH_SESSION_EXPIRED');
      }

      current = fresh;
    }

    throw new AuthError('AUTH_SESSION_EXPIRED');
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

  /**
   * Abmeldung, wenn nur noch der Refresh-Token gilt (Fundpunkt frontend-lib-05).
   *
   * Das Zugriffs-Token gilt 15 Minuten, der Refresh-Token 30 Tage. Wer die
   * Seite eine halbe Stunde liegen lässt und dann „Abmelden" drückt, hat kein
   * gültiges Zugriffs-Token mehr – ohne diesen Weg würden nur die Cookies
   * gelöscht, die Sitzung bliebe in der Ablage aber wochenlang gültig und
   * erneuerbar. Der Refresh-Token ist hier der Nachweis; er ist httpOnly und
   * die Route ist wie `/auth/refresh` CSRF-pflichtig.
   *
   * Widerrufen wird ausschließlich die eine zugehörige Sitzung – ein Abmelden
   * darf nie mehr abräumen, als der Nutzer gedrückt hat. Ein eben erst
   * ersetzter Token zählt mit, sonst schlüge das Abmelden direkt nach einer
   * parallelen Erneuerung fehl.
   */
  async logoutByRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(refreshToken);
    const session =
      (await this.repository.findSessionByTokenHash(tokenHash)) ??
      (await this.repository.findSessionByPreviousTokenHash(tokenHash));

    if (session && !session.revokedAt) {
      await this.repository.revokeSession(session.id, this.now());
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

    const account = await this.loadAccount(user);
    // Auch die Erstanmeldung über einen Anbieter ist eine Registrierung
    // (Lastenheft §3.1, `created: true`) und meldet `user.registered`.
    this.emitUserRegistered(account);

    return {
      account,
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
    let updated: UserRecord;

    try {
      updated = await this.repository.setUsername(userId, input.username);
    } catch (error) {
      // Dasselbe Rennen wie bei der Registrierung (Audit W2-9): Zwischen der
      // Prüfung `findUserByUsername` oben und diesem `UPDATE` kann sich ein
      // zweites Konto dieselbe Kennung geben.
      if (isUniqueViolation(error)) {
        throw new AuthError('AUTH_USERNAME_TAKEN');
      }

      throw error;
    }

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
  /**
   * Anzeigenamen des eigenen Kontos ändern (Lastenheft §3.1).
   *
   * Ohne Passwortabfrage: Der Name ist reine Darstellung, keine Kennung – an
   * ihm hängt weder die Anmeldung noch eine Berechtigung. Die Anmeldekennung
   * (`username`) bleibt unangetastet; sie bestätigt weiterhin die
   * Konto-Löschung.
   *
   * Zulässige Länge und das Abschneiden von Leerraum prüft
   * `updateProfileInputSchema` in `@palantir/validation`, bevor der Wert hier
   * ankommt.
   */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<AccountDto> {
    await this.requireUser(userId);

    const updated = await this.repository.setDisplayName(userId, input.displayName);

    return this.loadAccount(updated);
  }

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
   * aus B2. Owner- und Verwaltungskonten unterliegen zusätzlich der Rangregel
   * ({@link requireAdminTargetAllowed}, Fundpunkt 124). Alle Sitzungen des
   * betroffenen Kontos werden widerrufen.
   */
  async resetPasswordAsAdmin(
    actor: PermissionActor,
    targetUserId: string,
  ): Promise<PasswordResetResultDto> {
    const user = await this.requireUser(targetUserId);
    await this.requireAdminTargetAllowed(actor, user);
    const method = await this.repository.findAuthMethod(targetUserId, 'password');

    if (!method) {
      throw new AuthError('AUTH_METHOD_NOT_FOUND');
    }

    const temporaryPassword = generateTemporaryPassword();

    await this.repository.updateAuthMethod(method.id, {
      passwordHash: await hashPassword(temporaryPassword),
      mustChangePassword: true,
    });
    await this.revokeEverySession(user.id, this.now());

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
   * Route über den Guard aus B2. Owner- und Verwaltungskonten unterliegen
   * zusätzlich der Rangregel ({@link requireAdminTargetAllowed}, Fundpunkt 124).
   */
  async disableTwoFactorAsAdmin(actor: PermissionActor, targetUserId: string): Promise<void> {
    const user = await this.requireUser(targetUserId);
    await this.requireAdminTargetAllowed(actor, user);

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
   *
   * **Was am Konto hängt, geht zuerst** (Audit W2-11, backend-db-02/05).
   * `game_servers.owner_id` und `backups.owner_id` stehen auf `RESTRICT`: Beide
   * tragen Dinge, die außerhalb der Datenbank liegen – einen laufenden
   * Container und eine Archivdatei auf der Node. Eine Datenbank-Kaskade würde
   * nur die Zeilen entfernen und beides unerreichbar zurücklassen. Ohne
   * Vorprüfung käme der Fremdschlüsselfehler als 500 zurück; deshalb steht hier
   * `ACCOUNT_HAS_SERVERS` (409) mit einem Satz, der sagt, was zuerst wegmuss.
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

    // Erst nach der Identitätsprüfung: Wer sich nicht ausweisen kann, soll
    // nicht erfahren, wie viele Server oder Sicherungen ein fremdes Konto hat.
    await this.assertNothingBlocksDeletion(userId);

    // `AuthMethod`, `Session` und `UserRole` hängen mit `ON DELETE CASCADE` am
    // Konto und verschwinden mit (Pflichtenheft §6).
    try {
      await this.repository.deleteUser(userId);
    } catch (error) {
      /*
       * Rest des Rennens hinter der Vorprüfung (Audit W2-9): Zwischen
       * `assertNothingBlocksDeletion()` und diesem `DELETE` kann ein Admin dem
       * Konto einen Server übertragen oder eine Sicherung anlegen. `ON DELETE
       * RESTRICT` fängt das ab – bisher als roher 23503 und damit als 500.
       * Fachlich ist es derselbe Fall, den die Vorprüfung meldet.
       */
      if (isForeignKeyViolation(error)) {
        throw new AuthError('ACCOUNT_HAS_SERVERS');
      }

      throw error;
    }

    // Die Sitzungszeilen sind mit der Kaskade schon weg – der Aufruf gilt der
    // Senke: Sie schließt die noch offenen Live-Kanäle des Kontos (Audit W2-2).
    // Bewusst **nach** dem Löschen: Scheitert es doch, bleibt das Konto so, wie
    // es war, statt abgemeldet und trotzdem vorhanden.
    await this.revokeEverySession(userId, this.now());
  }

  /**
   * Wirft `ACCOUNT_HAS_SERVERS` (409), solange noch etwas am Konto hängt.
   *
   * Die Reihenfolge der Prüfungen ist die Reihenfolge, in der der Nutzer
   * aufräumen muss: Ein Server nimmt seine Sicherungen beim Löschen nicht mit
   * (`backups.server_id` wird `NULL`, Lastenheft §3.3), also nennt die Antwort
   * erst die Server und danach die übrig gebliebenen Sicherungen. Ein Satz je
   * Fall statt einer Aufzählung – der nächste Versuch zeigt den nächsten
   * Schritt.
   */
  private async assertNothingBlocksDeletion(userId: string): Promise<void> {
    const blocker = await this.repository.countAccountBlockers(userId);

    if (blocker.servers > 0) {
      // Ohne eigene Nachricht: Der Standardtext des Katalogs beschreibt genau
      // diesen Fall (`ACCOUNT_HAS_SERVERS`).
      throw new AuthError('ACCOUNT_HAS_SERVERS');
    }

    if (blocker.activeBackups > 0) {
      // Daran kann der Nutzer gerade nichts ändern: Ein laufender Vorgang lässt
      // sich nicht löschen, er endet – oder der Kehraus räumt ihn nach seiner
      // Frist ab (`sweepOrphanedRuns`).
      throw new AuthError(
        'ACCOUNT_HAS_SERVERS',
        'Für dieses Konto läuft noch eine Sicherung. Bitte warte, bis sie abgeschlossen ist, und wiederhole den Vorgang.',
      );
    }

    if (blocker.backups > 0) {
      throw new AuthError(
        'ACCOUNT_HAS_SERVERS',
        'Diesem Konto gehören noch Sicherungen. Bitte lösche sie zuerst und wiederhole den Vorgang.',
      );
    }
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
  /**
   * Id der Standardrolle (Mockup-Abgleich 12.1.1).
   *
   * Wie bei der Gast-Rolle: Fehlt sie, ist die Ersteinrichtung nicht
   * durchlaufen – ein Betriebsfehler, keine Nutzereingabe.
   */
  private async requireDefaultRoleId(): Promise<string> {
    const rolle = await this.roles.findByName(this.defaultRoleName);

    if (!rolle) {
      throw new Error(
        `Die Rolle "${this.defaultRoleName}" fehlt. Bitte einmalig ` +
          '"pnpm --filter @palantir/backend db:seed" ausfuehren (SETUP.md §2.4).',
      );
    }

    return rolle.id;
  }

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
