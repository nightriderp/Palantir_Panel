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
  /**
   * Zeitpunkt der letzten Rotation; `null`, solange nie rotiert wurde.
   *
   * Trägt die Kulanzfrist auf `previousRefreshTokenHash` (Pflichtenheft §7).
   */
  readonly rotatedAt: Date | null;
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
 * Was noch am Konto hängt und seiner Löschung im Weg steht (Audit W2-11).
 *
 * Beide Fremdschlüssel stehen auf `ON DELETE RESTRICT`: `game_servers.owner_id`
 * seit jeher, `backups.owner_id` seit Migration 0026. Ohne Vorprüfung endete
 * die Selbstlöschung deshalb im rohen Postgres-Fehler 23503 und damit in einem
 * 500 (backend-db-05); mit ihr in `ACCOUNT_HAS_SERVERS` (409) und einem Satz,
 * der sagt, was zuerst wegmuss.
 *
 * Bewusst Zahlen statt Listen: Die Antwort nennt keine Namen, sie nennt den
 * Grund – und ein `count(*)` lädt keine fremden Datensätze in ein Modul, das
 * mit ihnen sonst nichts zu tun hat.
 */
export interface AccountBlockers {
  /** Gameserver, deren Besitzer das Konto ist. */
  readonly servers: number;
  /** Sicherungen, deren Besitzer das Konto ist – gleich welchen Zustands. */
  readonly backups: number;
  /**
   * Davon Läufe in `pending`/`running`.
   *
   * Eigener Wert, weil der Nutzer daran nichts ändern kann: Ein laufendes
   * Backup lässt sich nicht löschen (`computeBackupPermissions`), es muss
   * enden oder vom Kehraus (`sweepOrphanedRuns`) abgeräumt werden. Der
   * Hinweistext unterscheidet deshalb „lösche zuerst" von „warte kurz".
   */
  readonly activeBackups: number;
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
  /**
   * Setzt die Anmeldekennung nach, wenn ein Provider-Konto ein Passwort bekommt.
   *
   * `null` gibt sie wieder frei – das tut `unlinkMethod('password')`, damit
   * eine Kennung ohne Passwort-Verfahren nicht dauerhaft belegt bleibt (Audit
   * backend-auth-04).
   */
  setUsername(id: string, username: string | null): Promise<UserRecord>;
  /**
   * Ändert den frei wählbaren Anzeigenamen (Lastenheft §3.1).
   *
   * Bewusst getrennt von {@link setUsername}: Der Anmeldename ist eine Kennung
   * und bleibt fest, der Anzeigename ist reine Darstellung und darf sich
   * jederzeit ändern.
   */
  setDisplayName(id: string, displayName: string): Promise<UserRecord>;
  deleteUser(id: string): Promise<void>;
  /**
   * Zählt, was der Selbstlöschung im Weg steht (Audit W2-11, backend-db-02/05).
   *
   * Liest `game_servers` und `backups` – Tabellen fremder Arbeitspakete, aber
   * dieselbe Datenbank. Der Umweg über deren Dienste wäre teurer als der
   * Nutzen: B1 bräuchte dann zwei weitere Abhängigkeiten, nur um zwei Zahlen zu
   * erfahren, die es nicht bewertet, sondern nur an einen Fehlercode reicht.
   * Dass Repositories Tabellen anderer Pakete lesen, ist im Bestand üblich
   * (`chat/repositories.ts` liest `game_servers`).
   */
  countAccountBlockers(userId: string): Promise<AccountBlockers>;

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
  /**
   * Setzt bei der Rotation neuen Token-Hash, Ablauf und Nutzungszeitpunkt.
   *
   * **Bedingt:** Die Rotation greift nur, wenn in der Ablage noch genau
   * `previousRefreshTokenHash` als aktueller Hash steht – der Hash, den der
   * Aufrufer vorgefunden hat. Das eine Statement ist damit Prüfung und
   * Schreiben zugleich; zwei gleichzeitige Erneuerungen können sich nicht mehr
   * gegenseitig überholen (Pflichtenheft §7).
   *
   * `null` heißt deshalb nicht „Fehler", sondern: eine parallele Anfrage war
   * schneller. Der Aufrufer entscheidet, ob er es erneut versucht.
   */
  rotateSession(
    id: string,
    data: {
      refreshTokenHash: string;
      previousRefreshTokenHash: string;
      expiresAt: Date;
      lastUsedAt: Date;
      rotatedAt: Date;
    },
  ): Promise<SessionRecord | null>;
  revokeSession(id: string, revokedAt: Date): Promise<void>;
  /** Widerruft alle noch offenen Sitzungen eines Kontos. */
  revokeAllSessions(userId: string, revokedAt: Date): Promise<void>;
}
