import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { createAdminModule, registerAdminRoutes } from './modules/admin/index.js';
import {
  type AuthModuleOptions,
  type AuthService,
  registerAuthModule,
} from './modules/auth/index.js';
import {
  type PermissionActor,
  createDrizzleRoleRepository,
  createRoleService,
  registerRbac,
} from './modules/rbac/index.js';
import { registerHealthRoutes } from './routes/health.js';

export interface BuildServerOptions {
  /**
   * Auth-Modul einhängen (Arbeitspaket B1).
   *
   * Standard `true`. Auf `false` gesetzt bleibt das Backend ohne Datenbank und
   * ohne die Geheimnisse aus der zentralen `.env` startbar – das nutzen die
   * Tests des Grundgerüsts und der Health-Endpunkt.
   */
  readonly auth?: boolean | AuthModuleOptions;
  /**
   * Ermittelt den Handelnden zum Request, wenn das Auth-Modul **nicht** läuft.
   *
   * Mit eingehängtem Auth-Modul kommt der Handelnde aus der Sitzung (B1) und
   * diese Funktion greift nicht. Fehlt beides, gilt jeder Request als nicht
   * angemeldet: Geschützte Routen antworten dann mit `AUTH_REQUIRED`. Das ist
   * die sichere Vorgabe – geöffnet wird dadurch nichts.
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

  /**
   * CORS (angepasst in B1): Sitzungs-Cookies gehen nur mit `credentials` über
   * die Grenze, und `credentials` verträgt keine Herkunft `*`. Ist
   * `PUBLIC_WEB_URL` gesetzt – Frontend und API laufen üblicherweise auf
   * verschiedenen Subdomains (Pflichtenheft §12.1) –, wird genau diese eine
   * Herkunft erlaubt. Ohne die Variable bleibt es beim bisherigen
   * `origin: false`, also gar keine fremde Herkunft.
   */
  await app.register(
    cors,
    env.PUBLIC_WEB_URL ? { origin: [env.PUBLIC_WEB_URL], credentials: true } : { origin: false },
  );

  /*
   * Reihenfolge ist wichtig: Das Auth-Modul hängt seine `onRequest`-Hooks vor
   * dem RBAC-Hook ein, damit `request.authUser` schon gesetzt ist, wenn der
   * Handelnde aufgelöst wird.
   */
  const auth = options.auth ?? true;
  let authService: AuthService | null = null;

  if (auth !== false) {
    authService = await registerAuthModule(app, auth === true ? {} : auth);
  }

  // Muss vor den Routen laufen: der Guard aus B2 liest `request.permissionActor`.
  registerRbac(app, {
    async resolveActor(request): Promise<PermissionActor | null> {
      if (authService && request.authUser) {
        return authService.buildActor(request.authUser);
      }

      return options.resolveActor?.(request) ?? null;
    },
  });

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
