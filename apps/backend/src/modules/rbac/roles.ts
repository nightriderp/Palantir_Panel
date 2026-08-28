/**
 * Rollenverwaltung (Pflichtenheft §8, Lastenheft §2 und §3.2).
 *
 * Rollen sind frei definierbare Bündel von Permissions. Bei der Ersteinrichtung
 * werden Admin, Moderator, Nutzer und die geschützte Systemrolle „Gast"
 * angelegt; die ersten drei sind danach vollständig editierbar.
 *
 * Die Datenbank steckt hinter {@link RoleRepository}, damit die Regeln dieses
 * Moduls ohne laufende Datenbank testbar bleiben (CLAUDE.md §4, analog zum
 * `ContainerRuntime`-Interface des Agents).
 */

import { GUEST_ROLE_NAME, PERMISSIONS, type Permission, type RoleDto } from '@palantir/contracts';
import type { CreateRoleInput, UpdateRoleInput } from '@palantir/validation';
import { RbacError } from './errors.js';
import {
  type PermissionActor,
  buildPermissionActor,
  computeRolePermissions,
  hasAnyPermission,
  hasPermission,
} from './permissions.js';

/** Rolle, wie sie in der Datenbank steht (Entität `Role`, Pflichtenheft §6). */
export interface RoleRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly permissions: readonly Permission[];
  readonly isProtected: boolean;
  readonly createdAt: Date;
}

export interface CreateRoleData {
  readonly name: string;
  readonly description: string | null;
  readonly permissions: readonly Permission[];
  readonly isProtected: boolean;
}

export interface UpdateRoleData {
  readonly name?: string;
  readonly description?: string | null;
  readonly permissions?: readonly Permission[];
}

/**
 * Persistenz der Rollen. Die Drizzle-Implementierung steht in `repository.ts`.
 *
 * `findByName` vergleicht **ohne** Rücksicht auf Groß-/Kleinschreibung, damit
 * nicht „Admin" und „admin" nebeneinander existieren.
 */
export interface RoleRepository {
  listAll(): Promise<RoleRecord[]>;
  findById(id: string): Promise<RoleRecord | null>;
  findByName(name: string): Promise<RoleRecord | null>;
  create(data: CreateRoleData): Promise<RoleRecord>;
  update(id: string, data: UpdateRoleData): Promise<RoleRecord>;
  remove(id: string): Promise<void>;
  /** Anzahl Nutzer je Rollen-Id (Rollen ohne Mitglieder fehlen in der Map). */
  countMembers(): Promise<ReadonlyMap<string, number>>;
  listRolesForUser(userId: string): Promise<RoleRecord[]>;
  assignToUser(userId: string, roleId: string): Promise<void>;
  removeFromUser(userId: string, roleId: string): Promise<void>;
}

/**
 * Permissions der Seed-Rolle „Nutzer" (Lastenheft §2): eigene Server erstellen
 * und verwalten, eigene Backups, Teilnahme am Chat. Nodes darf sie einsehen,
 * weil die Node-Übersicht (F7) eine Nutzeransicht ist.
 */
const USER_ROLE_PERMISSIONS: readonly Permission[] = [
  'server.create',
  'server.view.own',
  'server.manage.own',
  'server.delete.own',
  'backup.manage.own',
  'node.view',
];

/**
 * Rollen der Ersteinrichtung (Lastenheft §2, Pflichtenheft §8).
 *
 * „Admin" bekommt den vollständigen Katalog zum Zeitpunkt des Seedings. Später
 * ergänzte Permissions landen bewusst **nicht** automatisch in einer bereits
 * angelegten Admin-Rolle – die Rolle ist editierbar und gehört ab dem Seeding
 * dem Betreiber. Der Owner behält davon unabhängig immer alle Rechte.
 */
export const SEED_ROLES: readonly CreateRoleData[] = [
  {
    name: 'Admin',
    description: 'Vollzugriff über das Rollensystem. Mehrfach vergebbar, vollständig editierbar.',
    permissions: [...PERMISSIONS],
    isProtected: false,
  },
  {
    name: 'Moderator',
    description: 'Wie Nutzer, zusätzlich Moderationsrechte für gemeldete Nachrichten.',
    permissions: [...USER_ROLE_PERMISSIONS, 'message.moderate'],
    isProtected: false,
  },
  {
    name: 'Nutzer',
    description: 'Darf eigene Server und Backups verwalten und am Chat teilnehmen.',
    permissions: [...USER_ROLE_PERMISSIONS],
    isProtected: false,
  },
  {
    name: GUEST_ROLE_NAME,
    description:
      'Standardrolle nach der Registrierung. Keinerlei Berechtigungen, bis ein Admin die Rolle ändert. Geschützte Systemrolle.',
    permissions: [],
    isProtected: true,
  },
];

/** Ergebnis eines Seeding-Laufs. */
export interface SeedRolesResult {
  readonly created: string[];
  readonly existing: string[];
}

/**
 * Legt die Seed-Rollen an, sofern sie fehlen (Pflichtenheft §8).
 *
 * Idempotent: bereits vorhandene Rollen bleiben unangetastet – auch dann, wenn
 * der Betreiber sie inzwischen umgebaut hat. Der Lauf stellt damit zugleich
 * sicher, dass die Gast-Rolle nie dauerhaft fehlt.
 */
export async function seedRoles(repository: RoleRepository): Promise<SeedRolesResult> {
  const created: string[] = [];
  const existing: string[] = [];

  for (const role of SEED_ROLES) {
    const found = await repository.findByName(role.name);

    if (found) {
      existing.push(found.name);
      continue;
    }

    const inserted = await repository.create(role);
    created.push(inserted.name);
  }

  return { created, existing };
}

function requireRoleManagement(actor: PermissionActor): void {
  if (!hasPermission(actor, 'role.manage')) {
    throw new RbacError('PERMISSION_DENIED');
  }
}

function requireRoleRead(actor: PermissionActor): void {
  // `user.manage` reicht zum Lesen: wer Rollen zuweist, muss sie auflisten können.
  if (!hasAnyPermission(actor, ['role.manage', 'user.manage'])) {
    throw new RbacError('PERMISSION_DENIED');
  }
}

/**
 * Eine Rolle gilt als privilegiert, wenn ihr Bündel selbst die Rollen- oder
 * Nutzerverwaltung verleiht – wer sie zuweisen kann, kann darüber weitere
 * Rechte (bis zum vollen Katalog) vergeben.
 */
function grantsAdministration(role: RoleRecord): boolean {
  return role.permissions.some(
    (permission) => permission === 'role.manage' || permission === 'user.manage',
  );
}

/**
 * Schranke gegen Rechteausweitung: `user.manage` allein darf Rollen zuweisen und
 * abziehen (Pflichtenheft §8), aber keine Rolle, die ihrerseits `role.manage`/
 * `user.manage` verleiht – sonst könnte ein reiner Konten-Admin sich selbst die
 * „Admin"-Rolle mit vollem Katalog geben. Solche Rollen setzen `role.manage`
 * voraus. Gilt für Zuweisen und Entziehen gleichermaßen.
 */
function requireAssignmentAllowed(actor: PermissionActor, role: RoleRecord): void {
  if (grantsAdministration(role) && !hasPermission(actor, 'role.manage')) {
    throw new RbacError('PERMISSION_DENIED');
  }
}

function toDto(actor: PermissionActor, role: RoleRecord, memberCount: number): RoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    grantedPermissions: [...role.permissions],
    isProtected: role.isProtected,
    memberCount,
    createdAt: role.createdAt.toISOString(),
    permissions: computeRolePermissions(actor, role),
  };
}

/**
 * Rollen-Service.
 *
 * Jede Methode prüft die Berechtigung selbst, zusätzlich zum Guard an der Route
 * (`requirePermission`) – die Regel gilt damit auch für Aufrufer außerhalb des
 * HTTP-Pfads, etwa Skripte oder andere Module.
 */
export interface RoleService {
  list(actor: PermissionActor): Promise<RoleDto[]>;
  get(actor: PermissionActor, roleId: string): Promise<RoleDto>;
  create(actor: PermissionActor, input: CreateRoleInput): Promise<RoleDto>;
  update(actor: PermissionActor, roleId: string, input: UpdateRoleInput): Promise<RoleDto>;
  remove(actor: PermissionActor, roleId: string): Promise<void>;
  assignToUser(actor: PermissionActor, userId: string, roleId: string): Promise<void>;
  removeFromUser(actor: PermissionActor, userId: string, roleId: string): Promise<void>;
  /** Effektive Rechte eines Nutzers – Vereinigung seiner Rollen, Owner bekommt alles. */
  loadActor(userId: string, isOwner: boolean): Promise<PermissionActor>;
}

export function createRoleService(repository: RoleRepository): RoleService {
  async function loadRoleOrFail(roleId: string): Promise<RoleRecord> {
    const role = await repository.findById(roleId);

    if (!role) {
      throw new RbacError('ROLE_NOT_FOUND');
    }

    return role;
  }

  async function ensureNameFree(name: string, ignoreRoleId?: string): Promise<void> {
    const existing = await repository.findByName(name);

    if (existing && existing.id !== ignoreRoleId) {
      throw new RbacError('ROLE_NAME_TAKEN');
    }
  }

  return {
    async list(actor) {
      requireRoleRead(actor);

      const [roles, memberCounts] = await Promise.all([
        repository.listAll(),
        repository.countMembers(),
      ]);

      return roles.map((role) => toDto(actor, role, memberCounts.get(role.id) ?? 0));
    },

    async get(actor, roleId) {
      requireRoleRead(actor);

      const role = await loadRoleOrFail(roleId);
      const memberCounts = await repository.countMembers();

      return toDto(actor, role, memberCounts.get(role.id) ?? 0);
    },

    async create(actor, input) {
      requireRoleManagement(actor);
      await ensureNameFree(input.name);

      // Neue Rollen sind immer editierbar; der Schutzstatus ist der
      // Systemrolle „Gast" aus dem Seeding vorbehalten (Pflichtenheft §8).
      const role = await repository.create({
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
        isProtected: false,
      });

      return toDto(actor, role, 0);
    },

    async update(actor, roleId, input) {
      requireRoleManagement(actor);

      const role = await loadRoleOrFail(roleId);

      if (role.isProtected) {
        throw new RbacError('ROLE_PROTECTED');
      }

      if (input.name !== undefined) {
        await ensureNameFree(input.name, role.id);
      }

      const updated = await repository.update(role.id, input);
      const memberCounts = await repository.countMembers();

      return toDto(actor, updated, memberCounts.get(updated.id) ?? 0);
    },

    async remove(actor, roleId) {
      requireRoleManagement(actor);

      const role = await loadRoleOrFail(roleId);

      if (role.isProtected) {
        throw new RbacError('ROLE_PROTECTED');
      }

      await repository.remove(role.id);
    },

    async assignToUser(actor, userId, roleId) {
      requireRoleRead(actor);

      const role = await loadRoleOrFail(roleId);
      requireAssignmentAllowed(actor, role);
      await repository.assignToUser(userId, role.id);
    },

    async removeFromUser(actor, userId, roleId) {
      requireRoleRead(actor);

      const role = await loadRoleOrFail(roleId);
      requireAssignmentAllowed(actor, role);
      await repository.removeFromUser(userId, role.id);
    },

    async loadActor(userId, isOwner) {
      if (isOwner) {
        // Der Owner hat ohnehin alle Permissions – der Datenbankzugriff auf
        // seine Rollen bliebe folgenlos und bleibt deshalb aus.
        return buildPermissionActor({ isOwner: true, roles: [] });
      }

      const roles = await repository.listRolesForUser(userId);

      return buildPermissionActor({
        isOwner: false,
        roles: roles.map((role) => ({ grantedPermissions: role.permissions })),
      });
    },
  };
}
