/**
 * B1 – Auth & Identity (Pflichtenheft §7, Lastenheft §3.1, STRUKTUR.md).
 *
 * Öffentliche Schnittstelle des Moduls für alle anderen Backend-Pakete:
 *
 * - `registerAuthModule()` – hängt Sitzungsauflösung, CSRF-Schutz und alle
 *   `/auth`-Routen in die Fastify-Instanz und verbindet sie mit dem
 *   RBAC-Guard aus B2
 * - `AuthService` – die fachlichen Abläufe (Registrierung, Login, Sitzungen,
 *   Account-Linking, 2FA, Konto-Löschung, Admin-Eingriffe)
 * - `AuthRepository` – Persistenz-Schnittstelle; `createDrizzleAuthRepository()`
 *   ist die Umsetzung darauf
 * - Bausteine, die auch andere Pakete brauchen können: TOTP, ALTCHA,
 *   Rate-Limit, Token-Erzeugung, Passwort-Hashing
 *
 * `request.authUser` und `request.authSessionId` stehen nach dem Registrieren
 * an jedem Request; die effektiven Rechte hängen wie gehabt an
 * `request.permissionActor` (B2).
 */

export { AuthError, isAuthError } from './errors.js';

export { type AuthModuleOptions, registerAuthModule } from './plugin.js';

export {
  AuthService,
  type AuthServiceOptions,
  type IssuedSession,
  type LoginOutcome,
  type ProviderLoginOutcome,
  type RequestContext,
  sanitizeDisplayName,
} from './service.js';

export {
  type AuthMethodRecord,
  type AuthRepository,
  type CreateAuthMethodData,
  type CreateSessionData,
  type SessionRecord,
  type UpdateAuthMethodData,
  type UserRecord,
} from './types.js';

export { createDrizzleAuthRepository } from './repository.js';

export {
  isAwaitingApproval,
  isTwoFactorActive,
  toAccountDto,
  toLinkedAuthMethod,
  toSessionDto,
} from './dto.js';

export {
  type AuthorizationRequest,
  type CallbackQuery,
  type FetchLike,
  type PendingAuthorization,
  type ProviderAdapter,
  type ProviderConfig,
  type ProviderIdentity,
  type ProviderRegistry,
  createProviderRegistry,
} from './providers.js';

export { generateTemporaryPassword, hashPassword, verifyPassword } from './passwords.js';

export {
  type AccessTokenClaims,
  type RefreshTokenPair,
  createRefreshToken,
  hashRefreshToken,
  parseDurationMs,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

export {
  TOTP_ALLOWED_DRIFT_WINDOWS,
  TOTP_PERIOD_SECONDS,
  buildOtpauthUri,
  decodeBase32,
  encodeBase32,
  generateHotp,
  generateTotp,
  generateTotpSecret,
  totpCounterFor,
  verifyTotp,
} from './totp.js';

export { type AltchaOptions, createAltchaChallenge, verifyAltchaSolution } from './altcha.js';

export {
  type RateLimitDecision,
  type RateLimiter,
  type RateLimiterOptions,
  createRateLimiter,
  rateLimitKey,
} from './rate-limit.js';

export { createCsrfToken, csrfTokenMatches, isSafeMethod } from './csrf.js';

export { describeDevice, toIpHint } from './request-context.js';

export {
  ACCESS_COOKIE_NAME,
  type CookieSettings,
  OAUTH_STATE_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  clearSessionCookies,
} from './cookies.js';
