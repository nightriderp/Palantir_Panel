/**
 * Berechnung der effektiven Rechte (Pflichtenheft §8) und des serverseitig
 * berechneten `permissions`-Objekts für DTOs (Pflichtenheft §5.2).
 *
 * Zentrale Regeln, die ausschließlich hier ausgewertet werden:
 * - Effektive Rechte eines Nutzers = **Vereinigung** aller Permissions seiner Rollen.
 * - `User.isOwner` liegt außerhalb des Rollensystems und garantiert **immer alle**
 *   Permissions – Schutz vor Selbst-Aussperrung (Lastenheft §2).
 * - Die geschützte Systemrolle „Gast" bringt kein Recht mit; ein Konto ohne
 *   weitere Rolle hat damit nichts (Lastenheft §2, §3.1).
 * - `<basis>.any` gilt bei jeder Ressource, `<basis>.own` nur bei eigenen.
 *
 * Diese Datei kennt bewusst weder Datenbank noch HTTP: sie arbeitet auf reinen
 * Werten und ist deshalb vollständig ohne Infrastruktur testbar (CLAUDE.md §4).
 */

import {
  type GlobalPermissions,
  PERMISSIONS,
  type Permission,
  type PermissionFlags,
  type RolePermissions,
  type ScopedPermissionBase,
} from '@palantir/contracts';
import { hasNonGuestRole, isAwaitingApproval } from './approval.js';

/** Rolle, soweit die Rechteberechnung sie braucht. */
export interface RoleGrant {
  readonly grantedPermissions: readonly Permission[];
  /**
   * Name der Rolle – nur für die Freischalt-Regel ({@link isAccountApproved}).
   *
   * Optional, weil die reine Rechteberechnung ihn nicht braucht: Tests und
   * Aufrufer, die nur Permissions vereinigen wollen, sollen ihn nicht erfinden
   * müssen. Eine Rolle ohne Namen zählt wie jede Rolle, die nicht „Gast" heißt.
   */
  readonly name?: string;
}

/** Eingabe für {@link buildPermissionActor}. */
export interface PermissionActorInput {
  /** `User.isOwner` (Pflichtenheft §6) – außerhalb des Rollensystems. */
  readonly isOwner: boolean;
  /** Alle Rollen des Nutzers; die Reihenfolge ist ohne Bedeutung. */
  readonly roles: readonly RoleGrant[];
}

/**
 * Der Handelnde mit bereits aufgelösten effektiven Rechten.
 *
 * Wird einmal je Request gebaut (siehe `guard.ts`) und danach von allen
 * Berechtigungsprüfungen und DTO-Berechnungen weitergereicht.
 */
export interface PermissionActor {
  readonly isOwner: boolean;
  /** Effektive Permissions – beim Owner der vollständige Katalog. */
  readonly permissions: ReadonlySet<Permission>;
  /**
   * Ist das Konto freigeschaltet? Ergebnis von {@link isAccountApproved}.
   *
   * Steht neben `isOwner` und nicht in `permissions`, weil es keine Permission
   * ist, sondern der Kontostatus aus Lastenheft §3.1: Ein Konto, das noch in
   * der Warteliste steht, hat „keinerlei Zugriff auf Funktionen" – auch nicht
   * auf die, die sonst jede Sitzung offensteht. Der Guard `requireApproved()`
   * liest genau dieses Feld.
   */
  readonly approved: boolean;
}

/**
 * Ist ein Konto freigeschaltet (Lastenheft §3.1)?
 *
 * Reine Übersetzung einer Rollenliste in die **eine** Freischaltregel aus
 * `approval.ts` (`isAwaitingApproval`), damit der Guard `requireApproved()`,
 * das Konto-DTO (B1), die Warteliste (B8) und der Chat (B7) nicht vier
 * Lesarten derselben Sache führen (backend-community-06, security-matrix-06):
 *
 * - Der Owner steht außerhalb des Rollensystems und ist immer freigeschaltet.
 * - Sonst gilt: freigeschaltet, sobald mindestens eine Rolle **nicht** die
 *   geschützte Systemrolle „Gast" ist. Ein Konto ganz ohne Rolle ist damit
 *   nicht freigeschaltet. Eine Rolle ohne Namen zählt wie eine Rolle, die
 *   nicht „Gast" heißt (siehe {@link RoleGrant.name}).
 *
 * Die Sperre bleibt hier außen vor: Ein gesperrtes Konto bekommt gar keine
 * Sitzung mehr (B1 widerruft sie beim Sperren).
 */
export function isAccountApproved(input: {
  readonly isOwner: boolean;
  readonly roles: readonly { readonly name?: string }[];
}): boolean {
  return !isAwaitingApproval({
    isOwner: input.isOwner,
    hasNonGuestRole: hasNonGuestRole(input.roles),
  });
}

/**
 * Baut den Handelnden aus Owner-Flag und Rollen.
 *
 * Der Owner erhält den vollständigen Katalog, unabhängig von seinen Rollen –
 * auch dann, wenn ihm gar keine Rolle zugewiesen ist.
 */
export function buildPermissionActor(input: PermissionActorInput): PermissionActor {
  if (input.isOwner) {
    return { isOwner: true, permissions: new Set(PERMISSIONS), approved: true };
  }

  const permissions = new Set<Permission>();

  for (const role of input.roles) {
    for (const permission of role.grantedPermissions) {
      permissions.add(permission);
    }
  }

  return { isOwner: false, permissions, approved: isAccountApproved(input) };
}

/** Handelnder ohne jedes Recht – für nicht angemeldete Zugriffe und Tests. */
export function anonymousActor(): PermissionActor {
  return { isOwner: false, permissions: new Set<Permission>(), approved: false };
}

export function hasPermission(actor: PermissionActor, permission: Permission): boolean {
  return actor.permissions.has(permission);
}

/** Mindestens eine der genannten Permissions. */
export function hasAnyPermission(
  actor: PermissionActor,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => actor.permissions.has(permission));
}

/** Alle genannten Permissions. */
export function hasAllPermissions(
  actor: PermissionActor,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => actor.permissions.has(permission));
}

/**
 * Auswertung eines `.own`/`.any`-Paares (Pflichtenheft §8).
 *
 * @param isOwn ob die betroffene Ressource dem Handelnden gehört – bzw. er bei
 *   ihr Mitglied ist (`ServerMember`, Arbeitspaket B3).
 */
export function hasScopedPermission(
  actor: PermissionActor,
  base: ScopedPermissionBase,
  isOwn: boolean,
): boolean {
  if (actor.permissions.has(`${base}.any`)) {
    return true;
  }

  return isOwn && actor.permissions.has(`${base}.own`);
}

/**
 * Regel hinter einem einzelnen Flag des `permissions`-Objekts:
 * - `boolean` – bereits entschieden (z. B. weil der Zustand die Aktion verbietet)
 * - `Permission` – genau diese Permission
 * - `readonly Permission[]` – mindestens eine davon
 * - `{ scope, isOwn }` – `.own`/`.any`-Paar
 */
export type PermissionRule =
  | boolean
  | Permission
  | readonly Permission[]
  | { readonly scope: ScopedPermissionBase; readonly isOwn: boolean };

function evaluateRule(actor: PermissionActor, rule: PermissionRule): boolean {
  if (typeof rule === 'boolean') {
    return rule;
  }

  if (typeof rule === 'string') {
    return hasPermission(actor, rule);
  }

  if ('scope' in rule) {
    return hasScopedPermission(actor, rule.scope, rule.isOwn);
  }

  return hasAnyPermission(actor, rule);
}

/**
 * Baut das serverseitig berechnete `permissions`-Objekt eines DTOs
 * (Pflichtenheft §5.2).
 *
 * Wiederverwendbar für jedes DTO: die Flag-Namen kommen aus dem jeweiligen
 * Contract-Typ, die Regeln aus dem Aufrufer.
 *
 * ```ts
 * const permissions = computePermissionFlags<keyof GameServerPermissions>(actor, {
 *   canView: { scope: 'server.view', isOwn },
 *   canDelete: { scope: 'server.delete', isOwn },
 *   // ...
 * });
 * ```
 */
export function computePermissionFlags<TFlag extends string>(
  actor: PermissionActor,
  rules: Record<TFlag, PermissionRule>,
): PermissionFlags<TFlag> {
  const flags = {} as PermissionFlags<TFlag>;

  for (const [flag, rule] of Object.entries(rules) as [TFlag, PermissionRule][]) {
    flags[flag] = evaluateRule(actor, rule);
  }

  return flags;
}

/**
 * Kontobezogenes `permissions`-Objekt des angemeldeten Nutzers
 * (Pflichtenheft §5.2, §8).
 *
 * Hängt am Session-/Konto-DTO (B1) und steuert Navigation und Admin-Bereiche im
 * Frontend. `canViewNodes` ist bewusst auch bei `node.manage` wahr – wer Nodes
 * verwaltet, muss sie sehen können.
 */
export function computeGlobalPermissions(actor: PermissionActor): GlobalPermissions {
  return computePermissionFlags<keyof GlobalPermissions>(actor, {
    canCreateServer: 'server.create',
    canViewAnyServer: 'server.view.any',
    canManageAnyBackup: 'backup.manage.any',
    canManageUsers: 'user.manage',
    canManageRoles: 'role.manage',
    canManageNotifications: 'notification.manage',
    canViewNodes: ['node.view', 'node.manage'],
    canManageNodes: 'node.manage',
    canManageAddresses: 'address.manage',
    canViewAuditLog: 'audit.view',
    canModerateMessages: 'message.moderate',
    canManageGameTypes: 'gametype.manage',
  });
}

/**
 * `permissions`-Objekt eines Rollen-DTOs (Pflichtenheft §5.2).
 *
 * Eine geschützte Systemrolle ist für **niemanden** editier- oder löschbar –
 * auch nicht für den Owner. Genau das verhindert, dass die Gast-Rolle
 * versehentlich verändert oder entfernt wird (Pflichtenheft §8).
 */
export function computeRolePermissions(
  actor: PermissionActor,
  role: { readonly isProtected: boolean },
): RolePermissions {
  return computePermissionFlags<keyof RolePermissions>(actor, {
    canView: ['role.manage', 'user.manage'],
    canEdit: hasPermission(actor, 'role.manage') && !role.isProtected,
    canDelete: hasPermission(actor, 'role.manage') && !role.isProtected,
    canAssign: ['role.manage', 'user.manage'],
  });
}
