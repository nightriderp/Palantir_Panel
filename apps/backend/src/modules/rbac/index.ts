/**
 * B2 – RBAC / Permissions (Pflichtenheft §8, STRUKTUR.md).
 *
 * Öffentliche Schnittstelle des Moduls für alle anderen Backend-Pakete:
 *
 * - `buildPermissionActor()` / `loadActor()` – effektive Rechte eines Nutzers
 *   (Vereinigung seiner Rollen; Owner bekommt immer alles)
 * - `hasPermission()` / `hasScopedPermission()` – Einzelprüfungen
 * - `computePermissionFlags()` – das `permissions`-Objekt eines DTOs
 *   (Pflichtenheft §5.2); `computeGlobalPermissions()` als kontobezogene
 *   Ausprägung
 * - `requirePermission()` & Co. – Guard für Fastify-Routen
 * - `createRoleService()` – Rollenverwaltung inkl. Schutz der Systemrolle „Gast"
 * - `seedRoles()` – Rollen der Ersteinrichtung
 *
 * Der Permission-Katalog selbst steht in `@palantir/contracts`, damit Backend,
 * Frontend und Agent dieselbe Liste sehen (CLAUDE.md §3).
 */

export { RbacError, isRbacError } from './errors.js';

export {
  type PermissionActor,
  type PermissionActorInput,
  type PermissionRule,
  type RoleGrant,
  anonymousActor,
  buildPermissionActor,
  computeGlobalPermissions,
  computePermissionFlags,
  computeRolePermissions,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasScopedPermission,
} from './permissions.js';

export {
  type CreateRoleData,
  type RoleRecord,
  type RoleRepository,
  type RoleService,
  type SeedRolesResult,
  type UpdateRoleData,
  SEED_ROLES,
  createRoleService,
  seedRoles,
} from './roles.js';

export { createDrizzleRoleRepository } from './repository.js';

export {
  type RbacOptions,
  registerRbac,
  replyWithErrorCode,
  replyWithRbacError,
  requireActor,
  requireAllPermissions,
  requireAnyPermission,
  requirePermission,
} from './guard.js';
