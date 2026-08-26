/**
 * Access- und Refresh-Token (Pflichtenheft §7).
 *
 * - **Access-Token:** kurzlebiges JWT, HS256 gegen `JWT_SECRET`. Es trägt nur
 *   `sub` (Konto), `sid` (Sitzung), `iat` und `exp` – bewusst **keine** Rollen
 *   oder Permissions: sonst würde ein Rechteentzug bis zum Ablauf des Tokens
 *   nachwirken. Die Rechte werden je Request aus der Datenbank aufgelöst (B2).
 * - **Refresh-Token:** opak, 32 Zufallsbytes. In der `Session`-Tabelle liegt nur
 *   der SHA-256-Hash. SHA-256 statt Argon2id ist Absicht: der Token hat volle
 *   Zufalls-Entropie, ein langsamer Hash schützt dort vor nichts, läge aber auf
 *   jedem Refresh-Request (begründet in Pflichtenheft §7).
 */

import { createHash, randomBytes } from 'node:crypto';
import { type JWTPayload, SignJWT, jwtVerify } from 'jose';

/** Inhalt des Access-Tokens. */
export interface AccessTokenClaims {
  /** Konto-Id (`User.id`). */
  readonly userId: string;
  /** Sitzungs-Id (`Session.id`) – erlaubt den sofortigen Remote-Logout. */
  readonly sessionId: string;
}

/**
 * Wandelt eine Angabe wie `15m`, `12h`, `30d` oder `900s` in Millisekunden.
 *
 * Bewusst eng gefasst: erlaubt sind ganze Zahlen mit einer Einheit. Eine
 * unlesbare Angabe bricht laut ab, statt still auf einen Standardwert
 * zurückzufallen – bei Token-Lebensdauern wäre ein stiller Fallback die
 * gefährlichere Variante.
 */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(value.trim());
  const unitMs: Record<string, number | undefined> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const factor = match ? unitMs[match[2]?.toLowerCase() ?? ''] : undefined;

  if (!match?.[1] || factor === undefined) {
    throw new Error(
      `Ungültige Zeitangabe "${value}". Erwartet wird z. B. 900s, 15m, 12h oder 30d.`,
    );
  }

  return Number.parseInt(match[1], 10) * factor;
}

/**
 * Signiert das Access-Token.
 *
 * Der Algorithmus steht fest im Header; beim Prüfen wird er ebenso fest
 * erwartet. Damit ist die klassische Algorithmus-Verwechslung ausgeschlossen.
 */
export async function signAccessToken(
  claims: AccessTokenClaims,
  options: { secret: string; ttlMs: number },
  nowMs: number = Date.now(),
): Promise<string> {
  const issuedAtSeconds = Math.floor(nowMs / 1000);

  return new SignJWT({ sid: claims.sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + Math.floor(options.ttlMs / 1000))
    .sign(new TextEncoder().encode(options.secret));
}

/**
 * Prüft ein Access-Token und liefert seinen Inhalt.
 *
 * Gibt `null` zurück, wenn das Token fehlerhaft, falsch signiert oder abgelaufen
 * ist – der Aufrufer behandelt alle drei Fälle gleich (nicht angemeldet).
 */
export async function verifyAccessToken(
  token: string,
  options: { secret: string },
): Promise<AccessTokenClaims | null> {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(options.secret), {
      algorithms: ['HS256'],
    }));
  } catch {
    return null;
  }

  const sessionId = payload.sid;

  if (typeof payload.sub !== 'string' || typeof sessionId !== 'string') {
    return null;
  }

  // Ein Token mit Verwendungszweck ist kein Access-Token – so lässt sich der
  // 2FA-Zwischen-Token nicht als vollwertige Anmeldung einsetzen.
  if (payload.purpose !== undefined) {
    return null;
  }

  return { userId: payload.sub, sessionId };
}

/**
 * Verwendungszweck im Token.
 *
 * Access- und 2FA-Zwischen-Token werden mit demselben Schlüssel signiert; der
 * Zweck trennt sie. Ohne ihn ließe sich ein Zwischen-Token, der nur den zweiten
 * Anmeldeschritt erlauben soll, als vollwertiges Access-Token einsetzen.
 */
const TWO_FACTOR_PURPOSE = 'two_factor';

/**
 * Signiert den kurzlebigen Zwischen-Token des zweiten Anmeldeschritts
 * (Pflichtenheft §7).
 *
 * Er weist ausschließlich nach, dass Benutzername und Passwort bereits geprüft
 * wurden – es hängt noch keine Sitzung daran.
 */
export async function signTwoFactorToken(
  userId: string,
  options: { secret: string; ttlMs: number },
  nowMs: number = Date.now(),
): Promise<{ token: string; expiresAt: Date }> {
  const issuedAtSeconds = Math.floor(nowMs / 1000);
  const expiresAt = new Date(nowMs + options.ttlMs);

  const token = await new SignJWT({ purpose: TWO_FACTOR_PURPOSE })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(options.secret));

  return { token, expiresAt };
}

/**
 * Prüft den Zwischen-Token und liefert die Konto-Id.
 *
 * Gibt `null` zurück, wenn er fehlerhaft, abgelaufen oder für einen anderen
 * Zweck ausgestellt ist – ein Access-Token wird hier also nicht akzeptiert.
 */
export async function verifyTwoFactorToken(
  token: string,
  options: { secret: string },
): Promise<string | null> {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(options.secret), {
      algorithms: ['HS256'],
    }));
  } catch {
    return null;
  }

  if (payload.purpose !== TWO_FACTOR_PURPOSE || typeof payload.sub !== 'string') {
    return null;
  }

  return payload.sub;
}

/** Ein neu erzeugter, opaker Refresh-Token samt seinem Hash für die Datenbank. */
export interface RefreshTokenPair {
  /** Geht ausschließlich in das httpOnly-Cookie. */
  readonly token: string;
  /** Geht ausschließlich in die `Session`-Tabelle. */
  readonly hash: string;
}

/** Erzeugt einen neuen Refresh-Token (32 Zufallsbytes, Base64url). */
export function createRefreshToken(): RefreshTokenPair {
  const token = randomBytes(32).toString('base64url');

  return { token, hash: hashRefreshToken(token) };
}

/** SHA-256 eines Refresh-Tokens, hexadezimal. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
