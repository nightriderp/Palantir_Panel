/**
 * Datenbank-Schema (Drizzle ORM) – Sammelstelle aller Tabellen.
 *
 * Die Kernentitäten aus Pflichtenheft §6 gehören jeweils in das Arbeitspaket,
 * das sie fachlich verantwortet (B1 `User`/`AuthMethod`/`Session`, B2
 * `Role`/`UserRole`, B3 `GameServer`/`ServerMember`, ...). Jedes Paket bringt
 * seine Tabellen zusammen mit einer eigenen Migration mit (Entwicklungsregeln §4:
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
export * from './schema/game-requests.js';
export * from './schema/game-type-images.js';
export * from './schema/overview-tiles.js';
export * from './schema/server-orchestration.js';
export * from './schema/backups.js';
export * from './schema/notifications.js';

export * from './schema/admin.js';
export * from './schema/auth.js';
export * from './schema/fonts.js';
export * from './schema/chat.js';
export * from './schema/arcade.js';
export * from './schema/achievements.js';
export * from './schema/discord-bot.js';
