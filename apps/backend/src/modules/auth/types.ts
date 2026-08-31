/**
 * Datensätze und Persistenz-Schnittstelle des Auth-Moduls.
 *
 * Die Datenbank steckt hinter {@link AuthRepository}, damit die fachlichen
 * Regeln in `service.ts` ohne laufende Datenbank testbar bleiben (CLAUDE.md §4,
 * analog zum `RoleRepository` in B2 und zum `ContainerRuntime` des Agents).
 */

import { type AuthMethodType } from '@palantir/contracts';

/** Konto, wie es in der Datenbank steht (Entität `User`, Pflichtenheft §6). */
export interface UserRecord {
  readonly id: string;
  /** Anmeldekennung des Passwort-Verfahrens; `null` bei reinen Provider-Konten. */
  readonly username: string | null;
  /** Frei wählbarer Anzeigename – bewusst nicht eindeutig. */
  readonly displayName: string;
  readonly isOwner: boolean;
  readonly banned: boolean;
  readonly createdAt: Date;
}

/** Login-Methode (Entität `AuthMethod`, Pflichtenheft §6). */
export interface AuthMethodRecord {
  readonly id: string;
  readonly userId: string;
  readonly type: AuthMethodType;
  readonly providerUserId: string | null;
  readonly passwordHash: string | null;
  readonly providerDisplayName: string | null;
  readonly providerAvatarUrl: string | null;
  readonly mustChangePassword: boolean;
  readonly totpSecret: string | null;
  /** `null`, solange die 2FA-Einrichtung nicht mit einem Code bestätigt wurde. */
  readonly totpConfirmedAt: Date | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

/** Sitzung (Entität `Session`, Pflichtenheft §6). */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  /** Der bei der letzten Rotation ersetzte Hash – erkennt gestohlene Token. */
  readonly previousRefreshTokenHash: string | null;
  readonly deviceInfo: string | null;
  readonly ipHint: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface CreateAuthMethodData {
  readonly userId: string;
  readonly type: AuthMethodType;
  readonly providerUserId?: string | null;
  readonly passwordHash?: string | null;
  readonly providerDisplayName?: string | null;
  readonly providerAvatarUrl?: string | null;
  readonly mustChangePassword?: boolean;
}

export interface UpdateAuthMethodData {
  readonly passwordHash?: string;
  readonly providerDisplayName?: string | null;
  readonly providerAvatarUrl?: string | null;
  readonly mustChangePassword?: boolean;
  readonly totpSecret?: string | null;
  readonly totpConfirmedAt?: Date | null;
  readonly lastUsedAt?: Date;
}

export interface CreateSessionData {
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly deviceInfo: string | null;
  readonly ipHint: string | null;
  readonly expiresAt: Date;
}

/**
 * Persistenz des Auth-Moduls. Die Drizzle-Implementierung steht in
 * `repository.ts`.
 *
 * Suchen über die Anmeldekennung vergleichen **ohne** Rücksicht auf
 * Groß-/Kleinschreibung – „Spieler" und „spieler" sind dasselbe Konto
 * (Pflichtenheft §7), deckungsgleich mit dem Unique-Index
 * `users_username_lower_idx`.
 */
export interface AuthRepository {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByUsername(username: string): Promise<UserRecord | null>;
  usernameExists(username: string): Promise<boolean>;
  createUser(data: { username: string | null; displayName: string }): Promise<UserRecord>;
  /**
   * Konto mit Owner-Sonderstatus, falls es eines gibt (Lastenheft §2).
   *
   * Genau ein Konto kann ihn tragen; abgesichert ist das über den partiellen
   * Unique-Index `users_single_owner_idx`.
   */
  findOwner(): Promise<UserRecord | null>;
  /**
   * Vergibt den Owner-Sonderstatus an ein Konto (Ersteinrichtung,
   * Pflichtenheft §12.3).
   *
   * Bewusst ohne Gegenstück zum Entziehen: Der Status ist der Schutz davor,
   * dass sich niemand mehr anmelden kann (Lastenheft §2). Ein Wechsel des
   * Owners ist kein Vorgang der Version 1.
   */
  setOwner(id: string): Promise<UserRecord>;
  /** Setzt die Anmeldekennung nach, wenn ein Provider-Konto ein Passwort bekommt. */
  setUsername(id: string, username: string): Promise<UserRecord>;
  /**
   * Ändert den frei wählbaren Anzeigenamen (Lastenheft §3.1).
   *
   * Bewusst getrennt von {@link setUsername}: Der Anmeldename ist eine Kennung
   * und bleibt fest, der Anzeigename ist reine Darstellung und darf sich
   * jederzeit ändern.
   */
  setDisplayName(id: string, displayName: string): Promise<UserRecord>;
  deleteUser(id: string): Promise<void>;

  listAuthMethods(userId: string): Promise<AuthMethodRecord[]>;
  findAuthMethod(userId: string, type: AuthMethodType): Promise<AuthMethodRecord | null>;
  findAuthMethodByProvider(
    type: AuthMethodType,
    providerUserId: string,
  ): Promise<AuthMethodRecord | null>;
  createAuthMethod(data: CreateAuthMethodData): Promise<AuthMethodRecord>;
  updateAuthMethod(id: string, data: UpdateAuthMethodData): Promise<AuthMethodRecord>;
  deleteAuthMethod(id: string): Promise<void>;

  createSession(data: CreateSessionData): Promise<SessionRecord>;
  findSessionById(id: string): Promise<SessionRecord | null>;
  /** Findet die Sitzung zum aktuellen Token-Hash – auch eine widerrufene. */
  findSessionByTokenHash(refreshTokenHash: string): Promise<SessionRecord | null>;
  /**
   * Findet die Sitzung, bei der dieser Hash der **vorherige** war.
   *
   * Ein Treffer bedeutet: Der vorgelegte Token wurde bereits durch einen neuen
   * ersetzt und trotzdem noch einmal benutzt (Pflichtenheft §7).
   */
  findSessionByPreviousTokenHash(refreshTokenHash: string): Promise<SessionRecord | null>;
  /** Nur nicht widerrufene, nicht abgelaufene Sitzungen; neueste zuerst. */
  listActiveSessions(userId: string, nowMs: number): Promise<SessionRecord[]>;
  /** Setzt bei der Rotation neuen Token-Hash, Ablauf und Nutzungszeitpunkt. */
  rotateSession(
    id: string,
    data: {
      refreshTokenHash: string;
      previousRefreshTokenHash: string;
      expiresAt: Date;
      lastUsedAt: Date;
    },
  ): Promise<SessionRecord>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
  /** Widerruft alle noch offenen Sitzungen eines Kontos. */
  revokeAllSessions(userId: string, revokedAt: Date): Promise<void>;
}
