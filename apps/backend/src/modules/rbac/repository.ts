/**
 * Drizzle-Implementierung von {@link RoleRepository} (Pflichtenheft §6).
 *
 * Enthält ausschließlich Datenzugriff – jede fachliche Regel (Schutzstatus,
 * Namensvergabe, Berechtigungsprüfung) liegt im Service in `roles.ts`.
 */

import { type Permission } from '@palantir/contracts';
import { count, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { roles, userRoles } from '../../db/schema/rbac.js';
import { RbacError } from './errors.js';
import type { CreateRoleData, RoleRecord, RoleRepository, UpdateRoleData } from './roles.js';

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: Permission[];
  isProtected: boolean;
  createdAt: Date;
}

function toRecord(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: row.permissions,
    isProtected: row.isProtected,
    createdAt: row.createdAt,
  };
}

export function createDrizzleRoleRepository(db: Database): RoleRepository {
  return {
    async listAll() {
      const rows = await db.select().from(roles).orderBy(roles.name);

      return rows.map(toRecord);
    },

    async findById(id) {
      const [row] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);

      return row ? toRecord(row) : null;
    },

    async findByName(name) {
      // Vergleich ohne Rücksicht auf Groß-/Kleinschreibung, damit nicht
      // „Admin" und „admin" nebeneinander existieren.
      const [row] = await db
        .select()
        .from(roles)
        .where(sql`lower(${roles.name}) = lower(${name})`)
        .limit(1);

      return row ? toRecord(row) : null;
    },

    async create(data: CreateRoleData) {
      const [row] = await db
        .insert(roles)
        .values({
          name: data.name,
          description: data.description,
          permissions: [...data.permissions],
          isProtected: data.isProtected,
        })
        .returning();

      if (!row) {
        throw new Error('Rolle konnte nicht angelegt werden.');
      }

      return toRecord(row);
    },

    async update(id, data: UpdateRoleData) {
      const [row] = await db
        .update(roles)
        .set({
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.permissions !== undefined ? { permissions: [...data.permissions] } : {}),
          updatedAt: new Date(),
        })
        .where(eq(roles.id, id))
        .returning();

      if (!row) {
        throw new RbacError('ROLE_NOT_FOUND');
      }

      return toRecord(row);
    },

    async remove(id) {
      await db.delete(roles).where(eq(roles.id, id));
    },

    async countMembers() {
      const rows = await db
        .select({ roleId: userRoles.roleId, members: count() })
        .from(userRoles)
        .groupBy(userRoles.roleId);

      return new Map(rows.map((row) => [row.roleId, Number(row.members)]));
    },

    async listRolesForUser(userId) {
      const rows = await db
        .select({ role: roles })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(eq(userRoles.userId, userId));

      return rows.map((row) => toRecord(row.role));
    },

    async assignToUser(userId, roleId) {
      // Doppelte Zuweisung ist kein Fehler – der Zielzustand ist derselbe.
      await db.insert(userRoles).values({ userId, roleId }).onConflictDoNothing();
    },

    async removeFromUser(userId, roleId) {
      await db
        .delete(userRoles)
        .where(sql`${userRoles.userId} = ${userId} and ${userRoles.roleId} = ${roleId}`);
    },
  };
}
