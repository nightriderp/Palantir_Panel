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

/** Rolle, soweit die Rechteberechnung sie braucht. */
export interface RoleGrant {
  readonly grantedPermissions: readonly Permission[];
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
}

/**
 * Baut den Handelnden aus Owner-Flag und Rollen.
 *
 * Der Owner erhält den vollständigen Katalog, unabhängig von seinen Rollen –
 * auch dann, wenn ihm gar keine Rolle zugewiesen ist.
 */
export function buildPermissionActor(input: PermissionActorInput): PermissionActor {
  if (input.isOwner) {
    return { isOwner: true, permissions: new Set(PERMISSIONS) };
  }

  const permissions = new Set<Permission>();

  for (const role of input.roles) {
    for (const permission of role.grantedPermissions) {
      permissions.add(permission);
    }
  }

  return { isOwner: false, permissions };
}

/** Handelnder ohne jedes Recht – für nicht angemeldete Zugriffe und Tests. */
export function anonymousActor(): PermissionActor {
  return { isOwner: false, permissions: new Set<Permission>() };
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
