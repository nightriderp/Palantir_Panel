/**
 * Admin-Sicht auf die Rollenverwaltung (Lastenheft §3.2 und §3.7,
 * Pflichtenheft §8).
 *
 * **Was hier nicht steht:** die Rollenlogik selbst. Schutzstatus der Systemrolle
 * „Gast", Eindeutigkeit des Namens, Berechtigungsprüfung und die Berechnung des
 * `permissions`-Objekts liegen vollständig im `RoleService` aus B2
 * (`modules/rbac/roles.ts`) und werden hier **nicht** ein zweites Mal gebaut
 * (CLAUDE.md §3).
 *
 * **Was hier dazukommt:** das Audit-Log. Rollenänderungen sind
 * sicherheitsrelevant und gehören damit ins append-only Protokoll
 * (Pflichtenheft §6) – die Aktionen `role.created`, `role.updated`,
 * `role.deleted`, `user.roleAssigned` und `user.roleRemoved` stehen dafür seit
 * B8 im Katalog.
 *
 * **Warum nicht direkt im `RoleService`:** Das Audit-Log gehört zu B8, der
 * `RoleService` zu B2. B8 kennt B2 bereits (die Freischalt-Warteliste weist
 * über ihn Rollen zu); die umgekehrte Richtung gäbe es bisher nicht und würde
 * einen Zyklus zwischen den Modulen anlegen. Dieselbe Aufteilung nutzt
 * `registration-requests.ts`: dort weist B8 über den `RoleService` zu und
 * schreibt den Audit-Eintrag (`user.approved`) selbst.
 *
 * Zusätzlich prüft dieses Modul beim Zuweisen und Entziehen, ob das Konto
 * überhaupt existiert. Ohne die Prüfung liefe eine unbekannte Konto-Id in die
 * Fremdschlüsselbedingung von `user_roles` und käme als roher Datenbankfehler
 * zurück statt als `USER_NOT_FOUND` aus dem Katalog (CLAUDE.md §5).
 */

import type { RoleDto } from '@palantir/contracts';
import type { CreateRoleInput, UpdateRoleInput } from '@palantir/validation';
import type { RoleService } from '../rbac/index.js';
import { type AuditService, entryFor } from './audit.js';
import type { AdminContext } from './context.js';
import { AdminError } from './errors.js';

/**
 * Nachschlagen eines Kontos – bewusst eng geschnitten.
 *
 * Die Rollenverwaltung braucht vom Konto nichts außer der Antwort „gibt es".
 * Ein vollständiges Nutzer-Repository dafür einzuhängen wäre mehr Abhängigkeit
 * als nötig; die Drizzle-Umsetzung steht in `repositories.ts`.
 */
export interface RoleMemberLookup {
  exists(userId: string): Promise<boolean>;
}

export interface RoleAdminService {
  list(ctx: AdminContext): Promise<RoleDto[]>;
  get(ctx: AdminContext, roleId: string): Promise<RoleDto>;
  create(ctx: AdminContext, input: CreateRoleInput): Promise<RoleDto>;
  update(ctx: AdminContext, roleId: string, input: UpdateRoleInput): Promise<RoleDto>;
  remove(ctx: AdminContext, roleId: string): Promise<void>;
  /** Weist einem Konto die Rolle zu und liefert die Rolle mit neuer Mitgliederzahl. */
  assignToUser(ctx: AdminContext, roleId: string, userId: string): Promise<RoleDto>;
  removeFromUser(ctx: AdminContext, roleId: string, userId: string): Promise<RoleDto>;
}

export interface RoleAdminServiceDependencies {
  /** Rollenverwaltung aus B2 – die Regeln laufen nicht an ihr vorbei. */
  readonly roles: RoleService;
  readonly audit: AuditService;
  readonly users: RoleMemberLookup;
}

export function createRoleAdminService(deps: RoleAdminServiceDependencies): RoleAdminService {
  async function requireUser(userId: string): Promise<void> {
    if (!(await deps.users.exists(userId))) {
      throw new AdminError('USER_NOT_FOUND');
    }
  }

  return {
    list(ctx) {
      return deps.roles.list(ctx.actor);
    },

    get(ctx, roleId) {
      return deps.roles.get(ctx.actor, roleId);
    },

    async create(ctx, input) {
      const role = await deps.roles.create(ctx.actor, input);

      await deps.audit.record(
        entryFor(ctx, {
          action: 'role.created',
          targetType: 'role',
          targetId: role.id,
          metadata: { name: role.name, grantedPermissions: [...role.grantedPermissions] },
        }),
      );

      return role;
    },

    async update(ctx, roleId, input) {
      // Vorher lesen, damit der Eintrag den alten Stand mitführt: „Rolle
      // geändert" ohne das Vorher ist im Nachhinein kaum auswertbar
      // (Pflichtenheft §6, `AuditLog.metadata`).
      const before = await deps.roles.get(ctx.actor, roleId);
      const role = await deps.roles.update(ctx.actor, roleId, input);

      await deps.audit.record(
        entryFor(ctx, {
          action: 'role.updated',
          targetType: 'role',
          targetId: role.id,
          metadata: {
            name: role.name,
            before: {
              name: before.name,
              description: before.description,
              grantedPermissions: [...before.grantedPermissions],
            },
            after: {
              name: role.name,
              description: role.description,
              grantedPermissions: [...role.grantedPermissions],
            },
          },
        }),
      );

      return role;
    },

    async remove(ctx, roleId) {
      const role = await deps.roles.get(ctx.actor, roleId);

      await deps.roles.remove(ctx.actor, roleId);
      await deps.audit.record(
        entryFor(ctx, {
          action: 'role.deleted',
          targetType: 'role',
          targetId: role.id,
          // Der Datensatz ist weg; Name, Rechtebündel und Mitgliederzahl zum
          // Zeitpunkt der Löschung bleiben nur hier erhalten.
          metadata: {
            name: role.name,
            grantedPermissions: [...role.grantedPermissions],
            memberCount: role.memberCount,
          },
        }),
      );
    },

    async assignToUser(ctx, roleId, userId) {
      await requireUser(userId);
      await deps.roles.assignToUser(ctx.actor, userId, roleId);

      const role = await deps.roles.get(ctx.actor, roleId);

      await deps.audit.record(
        entryFor(ctx, {
          action: 'user.roleAssigned',
          // Zielobjekt ist das Konto: Im Audit-Log wird nach dem Nutzer
          // gesucht, dem etwas zugewiesen wurde – die Rolle steht daneben.
          targetType: 'user',
          targetId: userId,
          metadata: { roleId: role.id, roleName: role.name },
        }),
      );

      return role;
    },

    async removeFromUser(ctx, roleId, userId) {
      await requireUser(userId);
      await deps.roles.removeFromUser(ctx.actor, userId, roleId);

      const role = await deps.roles.get(ctx.actor, roleId);

      await deps.audit.record(
        entryFor(ctx, {
          action: 'user.roleRemoved',
          targetType: 'user',
          targetId: userId,
          metadata: { roleId: role.id, roleName: role.name },
        }),
      );

      return role;
    },
  };
}
