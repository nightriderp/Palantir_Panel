/**
 * Zod-Schemas zu Rollen und Permissions (Pflichtenheft §8).
 *
 * Gegenstück zu `Permission` und `RoleDto` aus `@palantir/contracts`. Backend
 * (Request-Validierung der Rollenverwaltung) und Frontend (Rollen-Editor F10)
 * nutzen dieselben Schemas – kein zweiter, abweichender Regelsatz.
 */

import { PERMISSIONS } from '@palantir/contracts';
import { z } from 'zod';

/** Permission aus dem Katalog in `@palantir/contracts` – kein Freitext. */
export const permissionSchema = z.enum(PERMISSIONS);

/**
 * Permission-Bündel einer Rolle.
 *
 * Doppelte Einträge werden abgelehnt statt stillschweigend entfernt, damit ein
 * fehlerhaft zusammengebautes Formular auffällt.
 */
export const rolePermissionsBundleSchema = z
  .array(permissionSchema)
  .refine((permissions) => new Set(permissions).size === permissions.length, {
    message: 'Jede Berechtigung darf nur einmal vorkommen.',
  });

/**
 * Rollenname.
 *
 * Bewusst frei wählbar (Lastenheft §3.2: frei definierbare Rollen), nur Länge
 * und Leerraum werden begrenzt. Die Eindeutigkeit prüft das Backend gegen die
 * Datenbank (`ROLE_NAME_TAKEN`).
 */
export const roleNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'Der Rollenname muss mindestens 2 Zeichen lang sein.' })
  .max(50, { message: 'Der Rollenname darf höchstens 50 Zeichen lang sein.' });

export const roleDescriptionSchema = z
  .string()
  .trim()
  .max(200, { message: 'Die Beschreibung darf höchstens 200 Zeichen lang sein.' });

/** Eingabe zum Anlegen einer Rolle (F10 → Backend). */
export const createRoleInputSchema = z.object({
  name: roleNameSchema,
  description: roleDescriptionSchema.nullish(),
  permissions: rolePermissionsBundleSchema.default([]),
});

/**
 * Eingabe zum Bearbeiten einer Rolle – alle Felder optional (Teil-Update).
 *
 * `isProtected` ist bewusst nicht enthalten: der Schutzstatus wird beim Seeding
 * gesetzt und ist über die API nicht änderbar (Pflichtenheft §8).
 */
export const updateRoleInputSchema = z
  .object({
    name: roleNameSchema,
    description: roleDescriptionSchema.nullable(),
    permissions: rolePermissionsBundleSchema,
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, {
    message: 'Es muss mindestens ein Feld geändert werden.',
  });

export type CreateRoleInput = z.infer<typeof createRoleInputSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>;
