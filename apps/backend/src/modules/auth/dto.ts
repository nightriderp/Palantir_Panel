/**
 * Abbildung Datensatz → DTO (Pflichtenheft §5.2).
 *
 * Die Formen stammen aus `@palantir/contracts` und wurden im Arbeitspaket F1
 * festgelegt (`AccountDto`, `LinkedAuthMethod`, `AccountRoleSummary`); B1 füllt
 * sie. Jedes DTO wird **vollständig** ausgeliefert und trägt sein serverseitig
 * berechnetes `permissions`-Objekt – das Frontend entscheidet nur, was es
 * anzeigt, und leitet keine Berechtigung selbst ab.
 *
 * Geheimnisse verlassen diese Schicht nie: `passwordHash` und `totpSecret`
 * haben in keinem DTO ein Gegenstück.
 */

import {
  type AccountDto,
  type AccountRoleSummary,
  GUEST_ROLE_NAME,
  type LinkedAuthMethod,
  type SessionDto,
} from '@palantir/contracts';
import { type PermissionActor, computeGlobalPermissions } from '../rbac/index.js';
import type { AuthMethodRecord, SessionRecord, UserRecord } from './types.js';

/** 2FA gilt erst als aktiv, wenn die Einrichtung bestätigt wurde. */
export function isTwoFactorActive(method: AuthMethodRecord): boolean {
  return method.totpSecret !== null && method.totpConfirmedAt !== null;
}

/**
 * Ob das Konto noch auf die Freischaltung durch einen Admin wartet
 * (`AccountDto.awaitingApproval`, Lastenheft §3.1).
 *
 * Das ist der Fall, solange es keine Rolle außer der geschützten Systemrolle
 * „Gast" trägt. Der Owner wartet nie. Bewusst hier berechnet und als fertiges
 * Feld ausgeliefert – das Frontend soll den Zustand nicht aus Rollennamen
 * herleiten müssen (Pflichtenheft §5.2).
 */
export function isAwaitingApproval(user: UserRecord, roles: readonly { name: string }[]): boolean {
  if (user.isOwner) {
    return false;
  }

  return roles.every((role) => role.name === GUEST_ROLE_NAME);
}

export function toLinkedAuthMethod(
  method: AuthMethodRecord,
  options: { totalMethods: number },
): LinkedAuthMethod {
  return {
    type: method.type,
    providerUserId: method.providerUserId,
    providerDisplayName: method.providerDisplayName,
    providerAvatarUrl: method.providerAvatarUrl,
    // Das letzte verbliebene Verfahren zu trennen würde das Konto aussperren
    // (Lastenheft §3.1).
    canUnlink: options.totalMethods > 1,
    linkedAt: method.createdAt.toISOString(),
  };
}

export function toSessionDto(session: SessionRecord, currentSessionId: string | null): SessionDto {
  return {
    id: session.id,
    deviceInfo: session.deviceInfo,
    ipHint: session.ipHint,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    current: session.id === currentSessionId,
    // Jede eigene Sitzung ist einzeln abmeldbar, auch die aktuelle – das ist
    // dann schlicht ein Logout (Lastenheft §3.1).
    permissions: { canRevoke: true },
  };
}

export function toAccountDto(input: {
  user: UserRecord;
  roles: readonly AccountRoleSummary[];
  methods: readonly AuthMethodRecord[];
  actor: PermissionActor;
}): AccountDto {
  const passwordMethod = input.methods.find((method) => method.type === 'password');

  return {
    id: input.user.id,
    displayName: input.user.displayName,
    username: input.user.username,
    isOwner: input.user.isOwner,
    banned: input.user.banned,
    awaitingApproval: isAwaitingApproval(input.user, input.roles),
    // 2FA gibt es ausschließlich am Passwort-Verfahren (Pflichtenheft §7).
    twoFactorEnabled: passwordMethod ? isTwoFactorActive(passwordMethod) : false,
    roles: input.roles.map((role) => ({
      id: role.id,
      name: role.name,
      isProtected: role.isProtected,
    })),
    authMethods: input.methods.map((method) =>
      toLinkedAuthMethod(method, { totalMethods: input.methods.length }),
    ),
    mustChangePassword: passwordMethod?.mustChangePassword ?? false,
    createdAt: input.user.createdAt.toISOString(),
    permissions: computeGlobalPermissions(input.actor),
  };
}
