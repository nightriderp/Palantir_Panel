import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { env } from './config/env.js';
import { getDb } from './db/index.js';
import { registerErrorHandler } from './error-handler.js';
import { createAdminModule, ipHintOf, registerAdminRoutes } from './modules/admin/index.js';
import { createChatModule, registerChatRoutes } from './modules/chat/index.js';
import {
  type BackupEventPublisher,
  createBackupScheduleService,
  createBackupService,
  createDrizzleBackupRepository,
  createDrizzleUserDirectory,
  registerBackupRoutes,
} from './modules/backups/index.js';
import {
  buildResourceService,
  createDrizzleHostNodeRepository as createResourceHostNodeRepository,
  createNodeUsageSource,
  registerResourceRoutes,
} from './modules/resources/index.js';
import {
  type AuthEventSink,
  type AuthModuleOptions,
  type AuthService,
  noopAuthEventSink,
  registerAuthModule,
} from './modules/auth/index.js';
import { registerNotifications } from './modules/notifications/index.js';
import {
  type PermissionActor,
  createDrizzleRoleRepository,
  createRoleService,
  registerRbac,
} from './modules/rbac/index.js';
import {
  AgentRegistry,
  createAgentBackupGateway,
  createAgentStorageEntryRemover,
  createAgentStorageScanGateway,
  createDrizzleBackupServerDirectory,
  createDrizzleServerExportManifestSource,
  createDrizzleServerRepository,
  createDrizzleServerUsageRepository,
  createServerKnownServerSource,
  createServerNameSource,
  createServerNodePlacementSource,
  registerServerOrchestration,
} from './modules/server-orchestration/index.js';
import { registerArcade } from './modules/arcade/index.js';
import { registerHealthRoutes } from './routes/health.js';
import {
  autoShutdownTask,
  backupScheduleTask,
  resourceWarningTask,
  serverScheduleTask,
  startScheduler,
  statsSamplingTask,
} from './scheduler.js';

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
   * Die datenbankgestützten Module einhängen (Admin, Benachrichtigungen,
   * Server-Orchestrierung, Chat, Zeitgeber).
   *
   * Standard: eingehängt, sobald `DATABASE_URL` gesetzt ist. Ohne die
   * Variable bleiben sie außen vor, statt bei jedem Aufruf mit einem
   * Verbindungsfehler zu antworten.
   *
   * Ausdrücklich `false` setzen Tests, die einzelne dieser Routen mit
   * Attrappen selbst registrieren. Ohne die Option hinge ihr Ergebnis daran,
   * ob auf der Maschine eine `.env` liegt: mit `DATABASE_URL` kämen die
   * echten Routen dazu und die Registrierung liefe doppelt.
   */
  readonly database?: boolean;
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
    // Nur der eigenen Proxy-Kette vertrauen (feste Hop-Zahl), nicht pauschal
    // jedem `X-Forwarded-For`: Ein client-gesetzter Header darf `request.ip`
    // nicht bestimmen, sonst ist der Login-Rate-Limit spoofbar (Pflichtenheft §7).
    // `hop` ist der Abstand zum Server (0 = der unmittelbar vorgelagerte Proxy);
    // vertraut werden genau die ersten `TRUSTED_PROXY_HOPS` Hops. `0` vertraut
    // niemandem – dann gilt die direkte Verbindungsadresse.
    trustProxy: (_address: string, hop: number) => hop < env.TRUSTED_PROXY_HOPS,
  });

  /*
   * Globales Sicherheitsnetz (N6, Gefundener Punkt 97): Ein Fehler, den keine
   * Route bewusst abfängt, verlässt die App trotzdem im Envelope-Format
   * (Pflichtenheft §5.1) und ohne Interna nach außen. Die fachlichen Fehler der
   * Routen bleiben davon unberührt – die werden weiter dort übersetzt.
   */
  registerErrorHandler(app);

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

  /*
   * B1 wird vor B6 eingehängt (die Auth-Hooks müssen früh laufen), meldet aber
   * `user.registered` an die Notification-Engine. Deshalb eine später gesetzte
   * Weiterleitung: Bis die Senke aus B6 steht, verwirft sie still; danach
   * schickt sie das Ereignis dorthin. `emit()` wirft nie (Pflichtenheft §14).
   */
  let notificationEventSink: AuthEventSink = noopAuthEventSink;
  const authEventSink: AuthEventSink = {
    emit: (event, payload) => notificationEventSink.emit(event, payload),
  };

  if (auth !== false) {
    authService = await registerAuthModule(app, {
      ...(auth === true ? {} : auth),
      events: authEventSink,
    });
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

  /*
   * Die fachlichen Module brauchen eine Datenbank. Ohne `DATABASE_URL` werden
   * sie gar nicht erst registriert, statt bei jedem Aufruf mit einem
   * Verbindungsfehler zu antworten – das Backend bleibt sonst unverändert
   * lauffähig (siehe Kommentar zu DATABASE_URL in `config/env.ts`).
   *
   * `options.database` sticht die Umgebung, damit Tests den Zustand selbst
   * festlegen können statt ihn von der Maschine zu erben.
   */
  const withDatabase = options.database ?? env.DATABASE_URL !== undefined;

  if (withDatabase) {
    const db = getDb();
    const roleRepository = createDrizzleRoleRepository(db);
    const roles = createRoleService(roleRepository);

    /*
     * Die offenen Agent-Verbindungen entstehen hier und nicht im Modul (R2):
     * Drei Pakete sprechen über denselben Kanal (Pflichtenheft §5.3) – B3 für
     * die Lifecycle-Befehle, B5 für die Backup-Befehle und B8 für den
     * Speicher-Scan. Zwei Registries wären zwei getrennte Sichten auf denselben
     * Agent.
     */
    const agents = new AgentRegistry();
    const serverRepository = createDrizzleServerRepository(db);
    const serverUsage = createDrizzleServerUsageRepository(db);

    /*
     * Die Anschlusspunkte, die B8 offen gelassen hat (R2, Gefundene Punkte 40
     * und 42). Alle vier lesen entweder `game_servers` oder sprechen über den
     * Agent-Kanal – beides gehört zu B3 bzw. B4, nicht zu B8.
     *
     * `nodeUsage` kommt aus derselben Zählung wie die harte Kapazitätsprüfung
     * vor jedem Start (Pflichtenheft §10) – bewusst eine Quelle, nicht zwei
     * (siehe `modules/resources/node-usage.ts`).
     */
    const admin = createAdminModule({
      db,
      roles,
      nodePlacements: createServerNodePlacementSource(db),
      nodeUsage: createNodeUsageSource({
        nodes: createResourceHostNodeRepository(db),
        usage: serverUsage,
      }),
      storageGateway: createAgentStorageScanGateway(agents),
      // Löschen im Speicher-Explorer geht jetzt wirklich an den Agent
      // (Gefundener Punkt 75); vorher meldete es „noch nicht gebaut".
      storageRemover: createAgentStorageEntryRemover(agents),
      knownServers: createServerKnownServerSource(db),
      serverNames: createServerNameSource(db),
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
     * Datei-Uploads des Datei-Managers (P2, Lastenheft §3.3).
     *
     * **Neue Abhängigkeit `@fastify/multipart` (CLAUDE.md §1).** Das Frontend
     * lädt Dateien als `multipart/form-data` hoch (`uploadFile()` in
     * `lib/api/servers.ts`); Fastify bringt dafür keinen Parser mit, und ein
     * selbst gebauter wäre genau die Sorte Code, die man nicht selbst schreiben
     * will.
     *
     * `fileSize` ist die harte Grenze aus `MAX_UPLOAD_SIZE_BYTES`
     * (Pflichtenheft §12.1): Der Datenstrom wird dort abgebrochen, statt den
     * Backend-Speicher unbegrenzt zu füllen. `files: 1`, weil der Datei-Manager
     * genau eine Datei je Aufruf entgegennimmt.
     */
    await app.register(multipart, {
      limits: { fileSize: env.MAX_UPLOAD_SIZE_BYTES, files: 1 },
    });

    /*
     * Notification-Engine (B6, Pflichtenheft §14) inklusive des
     * WebSocket-Kanals `/live/notifications` für die Inbox.
     *
     * Steht bewusst vor den auslösenden Modulen: B3, B5 und B7 bekommen ihre
     * Ereignis-Senke beim Aufbau gereicht und kennen B6 selbst nicht
     * (WORK_STATUS.md, Gefundene Punkte 34, 62 und 71).
     */
    const notifications = await registerNotifications(app, {
      db,
      resolveUserId: (request) => request.authUser?.id ?? null,
      defaultWebhookUrl: env.DISCORD_WEBHOOK_URL ?? null,
      deliveryTimeoutMs: env.NOTIFICATION_DELIVERY_TIMEOUT_MS,
      /*
       * Klartext-Namen der Zielrollen für die Regelübersicht (F10, Gefundener
       * Punkt 84). B6 kennt B2 nicht direkt, sondern bekommt nur die schmale
       * Funktion „Id → Name" gereicht (Port `RoleNameLookup`); die Daten kommen
       * aus dem Rollen-Repository von B2.
       */
      roles: {
        async findRoleNames(roleIds) {
          if (roleIds.length === 0) {
            return new Map();
          }

          const wanted = new Set(roleIds);
          const all = await roleRepository.listAll();

          return new Map(
            all.filter((role) => wanted.has(role.id)).map((role) => [role.id, role.name]),
          );
        },
      },
      // Änderungen an Kanälen, Regeln und Ankündigungen sind
      // sicherheitsrelevant und gehören ins Audit-Log (Pflichtenheft §6).
      audit: admin.services.audit,
      log: app.log,
    });

    // Ab hier meldet B1 `user.registered` an B6 (siehe Weiterleitung oben).
    notificationEventSink = notifications.eventSink;

    const {
      service: orchestration,
      schedules: serverSchedules,
      liveHub,
    } = registerServerOrchestration(app, {
      db,
      agents,
      resolveViewerId: (request) => request.authUser?.id ?? null,
      // Der öffentliche Port-Pool gehört B8; B3 vergibt keine Ports selbst.
      portPool: admin.services.ports,
      /*
       * Zuordnung Agent-Token → Node (Gefundener Punkt 57). Die Tokens führt
       * B8 an der Node; B3 bekommt nur die Nachschlagefunktion, wie beim
       * Port-Pool.
       */
      resolveHostIdByAgentToken: async (token) =>
        (await admin.services.nodes.findByAgentToken(token))?.id ?? null,
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
      db,
      audit: admin.services.audit,
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

    /*
     * Backup-Verwaltung (B5, R2/Gefundener Punkt 33).
     *
     * B5 kennt weder `game_servers` noch den Agent-Kanal und spricht nur über
     * `ServerDirectory` und `BackupAgentGateway`. Beide werden von B3 gestellt
     * (`modules/server-orchestration/backup-ports.ts`) – ohne sie ließen sich
     * die Routen hier gar nicht registrieren.
     *
     * Die Ereignis-Senke kommt aus B6 (Gefundener Punkt 34). Ein
     * fehlgeschlagenes Backup scheitert dadurch nicht an der Zustellung:
     * `publish()` wirft nie, ein nicht erreichbarer Kanal landet nur im
     * Zustellungsprotokoll (Pflichtenheft §14).
     */
    /*
     * Ereignis-Senke der Sicherungen: geht wie bisher an die
     * Notification-Engine und zusätzlich in den Live-Hub, damit eine offene
     * Export-Ansicht den Stand sieht, ohne ihn abzuholen (Gefundener Punkt 51).
     *
     * Kein `createLiveFanoutSink` wie bei B3: Dessen Senke spricht `emit()`,
     * B5 erwartet `publish()`. Statt eine der beiden Schnittstellen der anderen
     * anzupassen – beide haben ihre Gründe – steht die Verbindung hier, an der
     * Stelle, die ohnehin beide Module kennt.
     */
    const backupEvents: BackupEventPublisher = {
      async publish(event, payload) {
        await notifications.eventSink.publish(event, payload);
        liveHub.ingest(event, payload);
      },
    };

    const backups = createBackupService({
      repository: createDrizzleBackupRepository(db),
      servers: createDrizzleBackupServerDirectory(db),
      users: createDrizzleUserDirectory(db),
      agent: createAgentBackupGateway({ agents, repository: serverRepository }),
      // Der vollständige Export legt die Konfiguration des Servers als
      // `palantir-server.json` mit ins Archiv (P8, Lastenheft §3.3). B5 kennt
      // die Entität `GameServer` nicht; die Quelle stellt B3.
      manifests: createDrizzleServerExportManifestSource(db),
      events: backupEvents,
    });

    const backupSchedules = createBackupScheduleService({
      repository: createDrizzleBackupRepository(db),
      servers: createDrizzleBackupServerDirectory(db),
      backups,
    });

    await app.register(
      registerBackupRoutes({
        backups,
        schedules: backupSchedules,
        resolveUserId: (request) => request.authUser?.id ?? null,
      }),
    );

    /*
     * Arcade (F8, Pflichtenheft §17). Rein clientseitige Minispiele; das
     * Backend speichert nur die Punktestände und stellt die nutzerbezogene
     * Bestenliste je Spiel zusammen. Keine eigene Permission – spielen darf
     * jedes angemeldete Konto, die Zuordnung läuft über die Konto-Id.
     */
    await registerArcade(app, {
      db,
      resolveUserId: (request) => request.authUser?.id ?? null,
    });

    /*
     * Der Zeitgeber (R2/Gefundener Punkt 63) – eine Stelle für beide
     * periodischen Abläufe. Intervall und Verhalten bei Überschneidung sind im
     * Kopf von `scheduler.ts` begründet.
     */
    /*
     * Ressourcen-Warnungen (B4) laufen über dieselbe Zählung wie die harte
     * Kapazitätsprüfung – `serverUsage` gegen die Node-Ressourcen. Ausgelöst
     * wird `resource.low` in den Takt hinein (WORK_STATUS.md, Gefundener
     * Punkt 80).
     */
    const resources = buildResourceService(serverUsage);

    /*
     * Kontingent-Routen (`/admin/users/:userId/limits`, Gefundener Punkt 88).
     * Derselbe `ResourceService` wie oben – die Verwaltung der Nutzer-Limits
     * hängt hier nur an HTTP, eine zweite Kontingent-Logik gibt es nicht.
     */
    await app.register(registerResourceRoutes({ resourceLimits: resources }));

    const scheduler = startScheduler({
      intervalMs: env.SCHEDULER_INTERVAL_MS,
      log: app.log,
      tasks: [
        autoShutdownTask(orchestration, agents, app.log),
        backupScheduleTask(backupSchedules, app.log),
        serverScheduleTask(serverSchedules, app.log),
        statsSamplingTask(orchestration, agents, app.log),
        resourceWarningTask(resources, notifications.eventSink, app.log),
      ],
    });

    app.addHook('onClose', async (): Promise<void> => {
      scheduler.stop();
    });
  }

  return app;
}
