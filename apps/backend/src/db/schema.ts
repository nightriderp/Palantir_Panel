/**
 * Datenbank-Schema (Drizzle ORM) – Sammelstelle aller Tabellen.
 *
 * Die Kernentitäten aus Pflichtenheft §6 gehören jeweils in das Arbeitspaket,
 * das sie fachlich verantwortet (B1 `User`/`AuthMethod`/`Session`, B2
 * `Role`/`UserRole`, B3 `GameServer`/`ServerMember`, ...). Jedes Paket bringt
 * seine Tabellen zusammen mit einer eigenen Migration mit (CLAUDE.md §4:
 * Schema-Änderungen ausschließlich über Migrationen).
 *
 * Konvention für neue Tabellen:
 * - eine Datei je Themenbereich unter `src/db/schema/`, hier re-exportiert
 * - `id` als UUID (siehe `idSchema` in `@palantir/validation`)
 * - nach jeder Schema-Änderung `pnpm --filter @palantir/backend db:generate`
 *   ausführen und die erzeugte Migration mit committen
 */

export * from './schema/users.js';
export * from './schema/rbac.js';
export * from './schema/resources.js';
export * from './schema/backups.js';

export * from './schema/admin.js';
