import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { createAdminModule, registerAdminRoutes } from './modules/admin/index.js';
import {
  type PermissionActor,
  createDrizzleRoleRepository,
  createRoleService,
  registerRbac,
} from './modules/rbac/index.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildServerOptions {
  /**
   * Ermittelt den Handelnden zum Request – das liefert die Sitzungsauflösung
   * aus B1 (Auth & Identity).
   *
   * Ohne Angabe gilt jeder Request als nicht angemeldet: Geschützte Routen
   * antworten dann mit `AUTH_REQUIRED`. Das ist die sichere Vorgabe, solange
   * das Auth-Modul fehlt – geöffnet wird nichts.
   */
  resolveActor?: (
    request: FastifyRequest,
  ) => Promise<PermissionActor | null> | PermissionActor | null;
}

/**
 * Baut die Fastify-Instanz auf. Bewusst als eigene Funktion, damit Tests den
 * Server ohne offenen Port über `app.inject()` prüfen können.
 *
 * Fachliche Module (Auth, RBAC, Server-Orchestrierung, ...) werden hier von den
 * jeweiligen Arbeitspaketen aus `src/modules/<paket>` registriert –
 * siehe STRUKTUR.md (B1–B8).
 */
export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
  });

  await app.register(cors, { origin: false });

  // Muss vor den Routen laufen: der Guard aus B2 liest `request.permissionActor`.
  registerRbac(app, { resolveActor: options.resolveActor ?? (() => null) });

  await app.register(registerHealthRoutes);

  // Die Admin-Routen brauchen eine Datenbank. Ohne `DATABASE_URL` werden sie
  // gar nicht erst registriert, statt bei jedem Aufruf mit einem
  // Verbindungsfehler zu antworten – das Backend bleibt sonst unverändert
  // lauffähig (siehe Kommentar zu DATABASE_URL in `config/env.ts`).
  if (env.DATABASE_URL) {
    const roles = createRoleService(createDrizzleRoleRepository(getDb()));
    const admin = createAdminModule({
      db: getDb(),
      roles,
      ...(env.AUDIT_ARCHIVE_DIR ? { auditArchiveDir: env.AUDIT_ARCHIVE_DIR } : {}),
    });

    await app.register(async (instance) => {
      await registerAdminRoutes(instance, admin.services);
    });
  }

  return app;
}
