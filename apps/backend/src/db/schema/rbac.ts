/**
 * Tabellen des Arbeitspakets B2 – RBAC / Permissions (Pflichtenheft §6, §8).
 *
 * Enthält die Entitäten `Role` und `UserRole`. Der Owner-Sonderstatus liegt
 * bewusst **nicht** hier, sondern als Flag `isOwner` an der Entität `User`
 * (Arbeitspaket B1) – er steht außerhalb des Rollensystems (Lastenheft §2).
 */

import { type Permission } from '@palantir/contracts';
import { boolean, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Rolle: frei definierbares Bündel von Permissions (Pflichtenheft §8).
 *
 * Die Spalte heißt wie das Entitätsfeld in Pflichtenheft §6 `permissions`; im
 * `RoleDto` heißt dasselbe Bündel `grantedPermissions`, weil `permissions` dort
 * für das berechnete Flags-Objekt aus §5.2 reserviert ist (in §8 dokumentiert).
 *
 * `is_protected` markiert Systemrollen, die weder editier- noch löschbar sind.
 * In Version 1 trifft das ausschließlich auf die Rolle „Gast" zu.
 */
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description'),
    /**
     * `$type` bindet die Spalte an den Permission-Katalog aus
     * `@palantir/contracts`. Die Datenbank speichert weiterhin `text[]` – die
     * Gültigkeit prüft die Anwendung beim Schreiben (`rolePermissionsBundleSchema`),
     * damit ein wachsender Katalog keine Migration erzwingt.
     */
    permissions: text('permissions').array().$type<Permission[]>().notNull().default([]),
    isProtected: boolean('is_protected').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('roles_is_protected_idx').on(table.isProtected)],
);

/**
 * Zuordnung Nutzer ↔ Rolle (Pflichtenheft §6, Entität `UserRole`).
 *
 * Ein Nutzer kann mehrere Rollen haben; die effektiven Rechte sind die
 * Vereinigung (Pflichtenheft §8).
 *
 * Beide Fremdschlüssel löschen mit: wird ein Konto oder eine Rolle entfernt,
 * verschwindet die Zuordnung mit – ein verwaister Eintrag hätte keine Bedeutung.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_role_id_idx').on(table.roleId),
  ],
);

export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
export type UserRoleRow = typeof userRoles.$inferSelect;
