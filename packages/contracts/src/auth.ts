/**
 * Auth- und Konto-DTOs (Pflichtenheft §5.2, §6 und §7).
 *
 * Gemeinsame Vertragsgrenze für die Anmeldung: Backend (B1) liefert diese
 * Strukturen aus, das Frontend (F1) stellt sie dar. Die Berechtigungslogik
 * bleibt vollständig im Backend – das Frontend wertet ausschließlich das
 * `permissions`-Objekt und die daneben stehenden Zustandsfelder aus
 * (CLAUDE.md §3).
 *
 * Ergänzungen sind additiv (neue optionale Felder). Das Entfernen oder
 * Umbenennen eines bestehenden Feldes ist ein Breaking Change und im Commit/PR
 * als solcher zu kennzeichnen.
 */

import { type GlobalPermissions } from './permissions.js';

/**
 * Anmeldeverfahren eines Kontos (Pflichtenheft §6, Entität `AuthMethod`).
 *
 * Mehrere Verfahren pro Konto sind zulässig (Lastenheft §3.1); `password`
 * kommt höchstens einmal vor.
 */
export const AUTH_METHOD_TYPES = ['password', 'discord', 'twitch', 'steam'] as const;

export type AuthMethodType = (typeof AUTH_METHOD_TYPES)[number];

/**
 * Externe Anmeldeverfahren (Lastenheft §3.1).
 *
 * Discord und Twitch laufen über OAuth2, Steam über OpenID 2.0. Für die
 * Oberfläche und den Endpunktpfad verhalten sich alle drei gleich, deshalb
 * stehen sie hier in einer Liste. Die Reihenfolge ist die Anzeigereihenfolge
 * auf der Login-Seite.
 */
export const OAUTH_PROVIDERS = ['discord', 'twitch', 'steam'] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Prüft, ob ein beliebiger String ein bekannter externer Provider ist. */
export function isOAuthProvider(value: string): value is OAuthProvider {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Ein mit dem Konto verknüpftes Anmeldeverfahren (Pflichtenheft §6). */
export interface LinkedAuthMethod {
  type: AuthMethodType;
  /**
   * Anzeigename beim Provider – Discord-Tag, Steam-Profilname, Twitch-Name.
   * Dient der Wiedererkennung in der Admin-Warteliste (Lastenheft §3.1) und in
   * der Kontoübersicht. Bei `password` immer `null`.
   */
  providerDisplayName: string | null;
  /** ISO-8601-Zeitstempel der Verknüpfung. */
  linkedAt: string;
}

/**
 * Rolle am Konto – bewusst nur Name und Schutzstatus.
 *
 * Das vollständige `RoleDto` inklusive Permission-Bündel gehört in die
 * Rollenverwaltung (F10); am Konto genügt der Name für die Anzeige. Rechte
 * leitet das Frontend niemals daraus ab (CLAUDE.md §3).
 */
export interface AccountRoleSummary {
  id: string;
  name: string;
  isProtected: boolean;
}

/**
 * Angemeldetes Konto (Pflichtenheft §6, Entität `User`, plus die berechneten
 * Felder aus §5.2).
 *
 * Wird nach Login, nach Registrierung, nach bestandener 2FA-Prüfung und beim
 * Wiederherstellen einer bestehenden Sitzung ausgeliefert – immer vollständig,
 * nie auf eine einzelne Ansicht zugeschnitten (Pflichtenheft §5.2).
 */
export interface AccountDto {
  id: string;
  displayName: string;
  /**
   * Anmeldename des Passwort-Verfahrens. `null` bei Konten, die ausschließlich
   * über einen externen Provider angelegt wurden und noch kein Passwort haben.
   */
  username: string | null;
  /** Sonderstatus außerhalb des Rollensystems (Lastenheft §2). */
  isOwner: boolean;
  banned: boolean;
  /**
   * Konto ist registriert, aber noch nicht durch einen Admin freigeschaltet
   * (Lastenheft §3.1) – Grundlage für den Gast-Wartebildschirm in F1.
   *
   * Bewusst ein eigenes, serverseitig gesetztes Feld statt eines Rückschlusses
   * aus Rolle oder leerem Permission-Objekt: der Wartezustand ist eine
   * Aussage des Backends, keine Herleitung im Frontend (Pflichtenheft §5.2).
   */
  awaitingApproval: boolean;
  /** TOTP ist für dieses Konto aktiv (Pflichtenheft §7). */
  twoFactorEnabled: boolean;
  roles: AccountRoleSummary[];
  authMethods: LinkedAuthMethod[];
  /** ISO-8601-Zeitstempel. */
  createdAt: string;
  /** Instanzweite Rechte des Kontos (Pflichtenheft §5.2 und §8). */
  permissions: GlobalPermissions;
}

/** Ergebnis einer abgeschlossenen Anmeldung. */
export interface AuthenticatedResult {
  account: AccountDto;
}

/**
 * Zwischenschritt, wenn das Konto 2FA aktiviert hat (Pflichtenheft §7).
 *
 * Das Backend hat Benutzername und Passwort geprüft, aber noch keine Sitzung
 * angelegt. Der kurzlebige `twoFactorToken` erlaubt ausschließlich den zweiten
 * Schritt und ist kein Access-Token.
 */
export interface TwoFactorRequiredResult {
  twoFactorToken: string;
  /** ISO-8601-Zeitstempel, ab dem der Zwischen-Token ungültig ist. */
  expiresAt: string;
}

/**
 * Antwort auf den Login-Versuch.
 *
 * Bewusst als unterschiedene Vereinigung statt als Fehlerfall: „2FA fehlt noch"
 * ist ein regulärer Zwischenschritt, kein Fehler, und trägt deshalb keinen
 * Fehlercode aus dem Katalog (Pflichtenheft §5.1).
 */
export type LoginResult =
  | ({ status: 'authenticated' } & AuthenticatedResult)
  | ({ status: 'two_factor_required' } & TwoFactorRequiredResult);

export const LOGIN_RESULT_STATUSES = ['authenticated', 'two_factor_required'] as const;

export type LoginResultStatus = (typeof LOGIN_RESULT_STATUSES)[number];

/**
 * Von ALTCHA verwendetes Hash-Verfahren (Pflichtenheft §3).
 *
 * Fest auf SHA-256 gelegt: das ist der Standardwert von ALTCHA und die einzige
 * Variante, die das Frontend lösen können muss.
 */
export const ALTCHA_ALGORITHM = 'SHA-256';

/**
 * Proof-of-Work-Aufgabe des selbstgehosteten ALTCHA (Pflichtenheft §3).
 *
 * Das Backend erzeugt sie signiert (`ALTCHA_HMAC_KEY`), das Frontend sucht die
 * Zahl `number` aus `[0, maxnumber]`, für die
 * `SHA-256(salt + number) === challenge` gilt, und schickt die Lösung als
 * `altcha`-Feld der Registrierung zurück.
 */
export interface AltchaChallenge {
  algorithm: typeof ALTCHA_ALGORITHM;
  /** Hex-kodierter Ziel-Hash. */
  challenge: string;
  salt: string;
  /** Obere Grenze der gesuchten Zahl (`ALTCHA_COMPLEXITY`). */
  maxnumber: number;
  /** HMAC-Signatur, mit der das Backend die eigene Challenge wiedererkennt. */
  signature: string;
}

/**
 * Gelöste Challenge, wie sie das Frontend zurückschickt.
 *
 * Wird base64-kodiert als ein einzelner String übertragen (ALTCHA-Konvention),
 * damit die Registrierung nur ein zusätzliches Feld braucht.
 */
export interface AltchaSolution {
  algorithm: typeof ALTCHA_ALGORITHM;
  challenge: string;
  salt: string;
  signature: string;
  /** Gefundene Zahl. */
  number: number;
  /** Dauer der Suche in Millisekunden – rein informativ für das Backend-Log. */
  took?: number;
}
