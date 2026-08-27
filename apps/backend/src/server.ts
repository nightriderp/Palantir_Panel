import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { createAdminModule, ipHintOf, registerAdminRoutes } from './modules/admin/index.js';
import { createChatModule, registerChatRoutes } from './modules/chat/index.js';
import {
  type AuthModuleOptions,
  type AuthService,
  registerAuthModule,
} from './modules/auth/index.js';
import { registerNotifications } from './modules/notifications/index.js';
import {
  type PermissionActor,
  createDrizzleRoleRepository,
  createRoleService,
  registerRbac,
} from './modules/rbac/index.js';
import { registerServerOrchestration } from './modules/server-orchestration/index.js';
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
   * Mit eingehängtem Auth-Modul kommt der Handelnde aus der Sitzung (B1): Das
   * Access-Token wird geprüft, die Sitzung gegen die Datenbank aufgelöst und
   * daraus `request.authUser` gesetzt – der `resolveActor` unten baut den Actor
   * genau daraus. Diese Funktion greift dann nicht.
   *
   * Fehlt beides, gilt jeder Request als nicht angemeldet: Geschützte Routen
   * antworten dann mit `AUTH_REQUIRED`. Das ist die sichere Vorgabe – geöffnet
   * wird dadurch nichts.
   *
   * Sie liefert bewusst nur den {@link PermissionActor} und keine Identität:
   * Der Handelnde des Audit-Logs hängt an der Sitzung und wird als
   * `request.adminIdentity` gesetzt (Pflichtenheft §6). Aufrufe ohne Sitzung
   * bleiben Systemeinträge.
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

    /*
     * Server-Orchestrierung (B3) inklusive des WebSocket-Endpunkts `/agent`
     * (Pflichtenheft §2.2).
     *
     * Das Konto des Aufrufers kommt aus derselben Sitzung wie der Handelnde
     * oben: Läuft das Auth-Modul (B1), steht es in `request.authUser`; sonst
     * gilt jeder Request als nicht angemeldet und die Server-Routen antworten
     * mit `AUTH_REQUIRED`. Der Agent-Endpunkt ist davon unabhängig, er
     * authentifiziert über das Pre-Shared-Token.
     */
    await app.register(websocket);

    /*
     * Notification-Engine (B6, Pflichtenheft §14) inklusive des
     * WebSocket-Kanals `/live/notifications` für die Inbox.
     *
     * Muss **vor** der Server-Orchestrierung stehen: B3 bekommt die
     * Ereignissenke beim Aufbau gereicht und kennt B6 sonst nicht.
     */
    const notifications = await registerNotifications(app, {
      db: getDb(),
      resolveUserId: (request) => request.authUser?.id ?? null,
      defaultWebhookUrl: env.DISCORD_WEBHOOK_URL ?? null,
      deliveryTimeoutMs: env.NOTIFICATION_DELIVERY_TIMEOUT_MS,
      // Änderungen an Kanälen, Regeln und Ankündigungen sind
      // sicherheitsrelevant und gehören ins Audit-Log (Pflichtenheft §6).
      audit: admin.services.audit,
      log: app.log,
    });

    registerServerOrchestration(app, {
      db: getDb(),
      resolveViewerId: (request) => request.authUser?.id ?? null,
      // Der öffentliche Port-Pool gehört B8; B3 vergibt keine Ports selbst.
      portPool: admin.services.ports,
      // Ereignissenke aus B6: Ohne sie würden die Lifecycle-Ereignisse nur
      // protokolliert (WORK_STATUS.md, Gefundener Punkt 62).
      events: notifications.eventSink,
    });

    /*
     * Chat & Moderation (B7, Pflichtenheft §15) inklusive des Live-Kanals
     * `/api/chat/live`.
     *
     * Sichtbarkeit hängt hier an der Teilnahme, nicht an einer Permission:
     * Ohne Auth-Modul bleibt `authUser` leer, jeder Aufruf gilt als nicht
     * angemeldet und die Routen antworten mit `AUTH_REQUIRED` – die sichere
     * Vorgabe, geöffnet wird dadurch nichts.
     */
    const chat = createChatModule({
      db: getDb(),
      audit: admin.services.audit,
      // Ereignissenke aus B6: Ohne sie liefe `message.reported` ins Leere
      // (WORK_STATUS.md, Gefundener Punkt 71).
      events: notifications.eventSink,
    });

    await app.register(async (instance) => {
      registerChatRoutes(instance, {
        chat: chat.chat,
        moderation: chat.moderation,
        live: chat.live,
        ipHintOf,
        resolveViewer: (request) =>
          request.authUser
            ? { id: request.authUser.id, displayName: request.authUser.displayName }
            : null,
      });
    });
  }

  return app;
}
