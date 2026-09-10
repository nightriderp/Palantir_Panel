import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { env } from './config/env.js';
import { cookieDomainUmfasstSpielhosts } from './config/cookie-domain.js';
import { buildLoggerOptions } from './config/logging.js';
import { createTrustProxy } from './config/trusted-proxy.js';
import { getDb, getPool } from './db/index.js';
import { registerErrorHandler } from './error-handler.js';
import { createAdminModule, ipHintOf, registerAdminRoutes } from './modules/admin/index.js';
import {
  CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED,
  createChatModule,
  registerChatRoutes,
} from './modules/chat/index.js';
import {
  type BackupEventName,
  type BackupEventPayloads,
  type BackupEventPublisher,
  createBackupScheduleService,
  createBackupService,
  createFireAndForgetJobRunner,
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
  type FontDirectory,
  type InstanceSettingsService,
} from './modules/admin/instance-settings.js';
import { createFontModule, registerFontRoutes } from './modules/fonts/index.js';
import { createQuotaRequestService } from './modules/quota-requests/index.js';
import { createDrizzleQuotaRequestRepository } from './modules/quota-requests/repository.js';
import { registerQuotaRequestRoutes } from './modules/quota-requests/routes.js';
import { createPanelBackupService } from './modules/panel-backups/index.js';
import { createNodeBackupFileRemover } from './modules/panel-backups/files.js';
import { createDrizzlePanelBackupRepository } from './modules/panel-backups/repository.js';
import { createPgDumpDumper } from './modules/panel-backups/pg-dump.js';
import { registerPanelBackupRoutes } from './modules/panel-backups/routes.js';
import { createPublicStatsService } from './modules/public-stats/index.js';
import { registerPublicStatsRoutes } from './modules/public-stats/routes.js';
import {
  type AuthAuditSink,
  type AuthEventSink,
  type AuthModuleOptions,
  type AuthService,
  type SessionRevocationSink,
  isAuthError,
  noopAuthAuditSink,
  createDrizzleAuthRepository,
  noopAuthEventSink,
  registerAuthModule,
} from './modules/auth/index.js';
import {
  CLOSE_CODE_UNAUTHORIZED as NOTIFICATION_CLOSE_CODE_UNAUTHORIZED,
  createDrizzleNotificationRepository,
  registerNotifications,
} from './modules/notifications/index.js';
import {
  type PermissionActor,
  createDrizzleRoleRepository,
  createRoleService,
  registerRbac,
} from './modules/rbac/index.js';
import {
  AgentRegistry,
  createAgentBackupGateway,
  createAgentNodeConnectionSource,
  createAgentStorageEntryRemover,
  GAME_TYPE_DEFINITIONS,
  createAgentStorageScanGateway,
  createDrizzleBackupServerDirectory,
  createDrizzleServerExportManifestSource,
  createDrizzleServerRepository,
  createDrizzleServerUsageRepository,
  createServerKnownServerSource,
  createServerNameSource,
  createServerNodePlacementSource,
  LIVE_CLOSE_CODE_UNAUTHORIZED,
  type GameRegistry,
  registerServerOrchestration,
} from './modules/server-orchestration/index.js';
import { effectiveUploadLimitBytes } from './modules/server-orchestration/files.js';
import { registerArcade } from './modules/arcade/index.js';
import { registerHealthRoutes } from './routes/health.js';
import {
  autoShutdownTask,
  backupHousekeepingTask,
  backupScheduleTask,
  panelBackupTask,
  resourceWarningTask,
  serverScheduleTask,
  dataHousekeepingTask,
  startScheduler,
  stateReconcileTask,
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
    // Query-Parameter und `Authorization` bleiben aus den Log-Zeilen heraus
    // (Audit W3-9, security-matrix-09) – der OAuth-Rücklauf trägt Code und
    // `state` in der URL.
    logger: buildLoggerOptions(env.LOG_LEVEL),
    // Nur den eigenen Reverse-Proxys vertrauen, und zwar an ihrer **Adresse**
    // (`TRUSTED_PROXY_ADDRESSES`), nicht an einer Hop-Zahl: Ein client-gesetzter
    // `X-Forwarded-For` darf `request.ip` nicht bestimmen, sonst ist der
    // Login-Rate-Limit spoofbar (Pflichtenheft §7). Die frühere Hop-Zählung
    // vertraute dem unmittelbaren Peer – auch einem WireGuard-Teilnehmer am
    // Host-Port des Backends (Audit W2-6, backend-core-10).
    trustProxy: createTrustProxy(env.TRUSTED_PROXY_ADDRESSES),
  });

  /*
   * Geltungsbereich der Sitzungs-Cookies gegen die Spielserver-Hosts prüfen
   * (Audit W2-6, security-matrix-03). Deckt die Cookie-Domain auch
   * `<sub>.<PALANTIR_DOMAIN>` ab, bekommt jeder Spielserver-Container die
   * Sitzungs-Cookies seiner Besucher zu sehen. Abhilfe ist eine
   * Betriebsentscheidung (Panel eine Ebene tiefer), deshalb nur eine Warnung –
   * ein Startabbruch würde jede bestehende Installation lahmlegen.
   */
  if (cookieDomainUmfasstSpielhosts(env.COOKIE_DOMAIN, env.PALANTIR_DOMAIN)) {
    app.log.warn(
      { cookieDomain: env.COOKIE_DOMAIN, palantirDomain: env.PALANTIR_DOMAIN },
      'Cookie-Domain umfasst die Spielserver-Subdomains: Sitzungs-Cookies gehen auch an ' +
        'nutzergesteuerte Container. Panel und API eine Ebene tiefer betreiben ' +
        '(z. B. panel.<Domain> und api.panel.<Domain>) und COOKIE_DOMAIN darauf setzen.',
    );
  }

  /*
   * Globales Sicherheitsnetz (N6, Gefundener Punkt 97): Ein Fehler, den keine
   * Route bewusst abfängt, verlässt die App trotzdem im Envelope-Format
   * (Pflichtenheft §5.1) und ohne Interna nach außen. Die fachlichen Fehler der
   * Routen bleiben davon unberührt – die werden weiter dort übersetzt.
   */
  registerErrorHandler(app);

  /**
   * CORS (angepasst in B1): Sitzungs-Cookies gehen nur mit `credentials` über
   * die Grenze, und `credentials` verträgt keine Herkunft `*`. Erlaubt ist
   * deshalb genau eine Herkunft – das Frontend, das üblicherweise auf einer
   * anderen Subdomain als die API liegt (Pflichtenheft §12.1).
   *
   * `PUBLIC_WEB_URL` ist immer gesetzt: `adressenAbleiten()` in `config/env.ts`
   * füllt sie andernfalls aus `PALANTIR_DOMAIN` (Audit W3-2, backend-core-09).
   * Der frühere Rückfall auf `origin: false` war damit toter Code und ist
   * entfernt – wer CORS abschalten will, ändert nicht diese Zeile, sondern die
   * Ableitung.
   */
  await app.register(cors, { origin: [env.PUBLIC_WEB_URL], credentials: true });

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
  /*
   * Dieselbe spaete Verdrahtung wie bei der Notification-Senke: B1 wird vor den
   * Datenbank-Modulen registriert, die Instanz-Einstellungen entstehen aber
   * erst mit dem Admin-Modul. Ohne sie bleibt die Registrierung offen - so
   * verhielt sich die Instanz, bevor es den Schalter gab (Abgleich 12.1.1).
   */
  let instanceSettings: InstanceSettingsService | null = null;
  /*
   * Und dieselbe Verdrahtung fuer die Schriften (S-2), diesmal im Kreis: Die
   * Instanz-Einstellungen pruefen eine gewaehlte Kennung gegen den Bestand, und
   * der Loeschschutz des Schriften-Moduls fragt umgekehrt die Einstellungen.
   * Eines von beiden muss zuerst entstehen; die Weiterleitung hier loest das,
   * ohne eines der Module das andere kennen zu lassen. Bis sie gesetzt ist,
   * gilt jede Kennung als unbekannt - der sichere Zustand.
   */
  let fontDirectory: FontDirectory | null = null;
  const authEventSink: AuthEventSink = {
    emit: (event, payload) => notificationEventSink.emit(event, payload),
  };

  /*
   * Dieselbe späte Weiterleitung wie bei der Notification-Senke, diesmal in die
   * Gegenrichtung (Audit W2-2, `backend-community-visibility-03`): B1 (Widerruf
   * aller Sitzungen) und B8 (Kontosperre) melden, dass die Sitzungen eines
   * Kontos nicht mehr gelten; B7 schließt daraufhin dessen offene
   * Live-Verbindungen. Der Chat-Verteiler entsteht erst mit den
   * Datenbank-Modulen weiter unten – bis dahin verwirft die Weiterleitung still,
   * und ohne offene Verbindung gibt es ohnehin nichts zu schließen.
   */
  let closeLiveConnections: ((userId: string) => void) | null = null;
  const sessionRevocationSink: SessionRevocationSink = {
    revoked: (userId) => closeLiveConnections?.(userId),
  };

  /*
   * Und dieselbe späte Verdrahtung für das Audit-Log (Fundpunkt 140): B1
   * protokolliert den Sammel-Logout „alle anderen Geräte abmelden", der
   * `AuditService` entsteht aber erst mit dem Admin-Modul weiter unten. Bis
   * dahin verwirft die Weiterleitung still – ohne Datenbank gibt es auch kein
   * Log, in das sie schreiben könnte.
   *
   * Anders als bei den beiden Senken darüber wird hier **nicht** geschluckt,
   * was `record()` wirft: Ein Sitzungswiderruf, der sich nicht protokollieren
   * lässt, soll scheitern statt unbemerkt durchzugehen (Pflichtenheft §6).
   */
  let auditSink: AuthAuditSink = noopAuthAuditSink;
  const authAuditSink: AuthAuditSink = {
    record: (entry) => auditSink.record(entry),
  };

  if (auth !== false) {
    authService = await registerAuthModule(app, {
      ...(auth === true ? {} : auth),
      events: authEventSink,
      sessions: sessionRevocationSink,
      audit: authAuditSink,
      selfRegistration: async () => (await instanceSettings?.selfRegistrationEnabled()) ?? true,
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
     * Kontingent-Dienst schon hier: Die Nutzerliste in B8 zeigt seit dem
     * Mockup-Abgleich (12.1.3) eine Spalte "Kontingent" und liest sie ueber
     * denselben Dienst, der auch die Kontingent-Routen bedient. Zwei Instanzen
     * waeren zwei Zaehlungen.
     */
    const resources = buildResourceService(serverUsage);

    /*
     * Die Anschlusspunkte, die B8 offen gelassen hat (R2, Gefundene Punkte 40
     * und 42). Alle vier lesen entweder `game_servers` oder sprechen über den
     * Agent-Kanal – beides gehört zu B3 bzw. B4, nicht zu B8.
     *
     * `nodeUsage` kommt aus derselben Zählung wie die harte Kapazitätsprüfung
     * vor jedem Start (Pflichtenheft §10) – bewusst eine Quelle, nicht zwei
     * (siehe `modules/resources/node-usage.ts`).
     */
    /*
     * Der Katalog entsteht erst weiter unten (`registerServerOrchestration`),
     * der Schalter dazu gehört aber der Verwaltung, die hier gebaut wird.
     * Deshalb ein Halter statt einer Reihenfolge, die es nicht geben kann.
     */
    let spieleKatalog: GameRegistry | null = null;

    const admin = createAdminModule({
      db,
      onDisabledGameTypesChanged: (ids) => spieleKatalog?.setDisabledGameTypes(ids),
      // Für den Archivlauf: Der Advisory-Lock gehört der Verbindung, die ihn
      // nimmt, und braucht deshalb den Pool selbst (Audit W2-16).
      pool: getPool(),
      roles,
      // Kontosperre schließt die offenen Live-Verbindungen des Kontos
      // (Audit W2-2) – über dieselbe Weiterleitung wie der Sitzungswiderruf.
      sessions: { blocked: (userId) => closeLiveConnections?.(userId) },
      nodePlacements: createServerNodePlacementSource(db),
      nodeUsage: createNodeUsageSource({
        nodes: createResourceHostNodeRepository(db),
        usage: serverUsage,
      }),
      // Ende einer Wartung trägt den wirklichen Zustand ein statt pauschal
      // `offline` – dafür muss B8 fragen können, ob der Agent gerade hängt.
      nodeConnections: createAgentNodeConnectionSource(agents),
      storageGateway: createAgentStorageScanGateway(agents),
      // Löschen im Speicher-Explorer geht jetzt wirklich an den Agent
      // (Gefundener Punkt 75); vorher meldete es „noch nicht gebaut".
      storageRemover: createAgentStorageEntryRemover(agents),
      knownServers: createServerKnownServerSource(db),
      serverNames: createServerNameSource(db),
      quotas: resources,
      // Serveranzahl je Konto fuer die Nutzerliste (Gefundener Punkt 90) -
      // gezaehlt dort, wo die Server liegen, nicht im Browser.
      serverCounts: {
        countServersByOwner: (userIds) => serverRepository.countByOwners(userIds),
      },
      ...(env.AUDIT_ARCHIVE_DIR ? { auditArchiveDir: env.AUDIT_ARCHIVE_DIR } : {}),
      // Auswahl einer Schrift in den Instanz-Einstellungen (S-2) – geprüft
      // gegen den Bestand des Schriften-Moduls, das gleich darunter entsteht.
      fonts: { exists: async (id) => (await fontDirectory?.exists(id)) ?? false },
    });

    await app.register(async (instance) => {
      await registerAdminRoutes(instance, admin.services);
    });

    // Ab jetzt kennt die Registrierung den Schalter (Abgleich 12.1.1).
    instanceSettings = admin.instanceSettings;

    /*
     * Und ab jetzt landet der Sammel-Logout aus B1 im append-only Audit-Log
     * (Fundpunkt 140, Aktion `auth.sessionRevoked`) – über dieselbe späte
     * Weiterleitung wie die beiden Senken oben.
     */
    auditSink = admin.services.audit;

    /*
     * Schriften der Oberfläche (S-2). Mitgelieferte Dateien kommen aus dem
     * Auslieferungsverzeichnis des Backend-Images, hochgeladene aus
     * `FONT_UPLOAD_DIR` (.env.example Abschnitt 18). Der Löschschutz fragt die
     * Instanz-Einstellungen, welche Schriften gerade gewählt sind.
     */
    const fonts = createFontModule({
      db,
      uploadDir: env.FONT_UPLOAD_DIR,
      selection: admin.instanceSettings,
      audit: admin.services.audit,
    });

    // Ab hier prüfen die Instanz-Einstellungen eine gewählte Kennung wirklich
    // (siehe Weiterleitung oben).
    fontDirectory = fonts.service;

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
     * Datei-Uploads des Datei-Managers (P2, Lastenheft §3.3) und des Wizards
     * (Weltdaten-Archive, P4).
     *
     * **Neue Abhängigkeit `@fastify/multipart` (CLAUDE.md §1).** Das Frontend
     * lädt Dateien als `multipart/form-data` hoch (`uploadFile()` in
     * `lib/api/servers.ts`); Fastify bringt dafür keinen Parser mit, und ein
     * selbst gebauter wäre genau die Sorte Code, die man nicht selbst schreiben
     * will.
     *
     * `fileSize` ist hier nur das Sicherheitsnetz für jede Multipart-Route,
     * nicht die fachliche Grenze: Der Datei-Manager setzt seine wirksame Grenze
     * (`MAX_UPLOAD_SIZE_BYTES`, höchstens die 64 MiB des Agent-Kanals) je
     * Aufruf selbst, damit nie mehr gepuffert wird, als der Dienst annimmt
     * (Fundpunkt 123); der Weltdaten-Upload zählt beim Schreiben auf die Platte
     * gegen `MAX_WORLD_ARCHIVE_BYTES`. Hier steht deshalb die größere der
     * beiden wirksamen Grenzen – mehr kann keine Route brauchen. `files: 1`,
     * weil beide genau eine Datei je Aufruf entgegennehmen.
     */
    await app.register(multipart, {
      limits: {
        fileSize: Math.max(
          effectiveUploadLimitBytes(env.MAX_UPLOAD_SIZE_BYTES),
          env.MAX_WORLD_ARCHIVE_BYTES,
        ),
        files: 1,
      },
    });

    /*
     * Schriften-Routen erst hier: `POST /api/admin/fonts` nimmt die Datei als
     * `multipart/form-data` entgegen und braucht dafür den oben registrierten
     * Parser. Die wirksame Grenze setzt die Route selbst
     * (`FONT_UPLOAD_MAX_SIZE_BYTES`), damit nie mehr gepuffert wird, als eine
     * Schrift überhaupt groß sein darf.
     */
    await app.register(registerFontRoutes({ service: fonts.service }));

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
      // Herkunftsprüfung des WebSocket-Handshakes (Audit W2-5,
      // `security-matrix-04`) – dieselbe Adresse wie bei CORS oben.
      allowedOrigin: env.PUBLIC_WEB_URL,
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

    /*
     * B7 entsteht weiter unten, B3 braucht die Funktion aber schon hier
     * (Gefundener Punkt 70). Dieselbe Weiterleitung wie bei der
     * Ereignis-Senke: B3 ruft sie, sobald ein Server angelegt ist; bis B7
     * steht, ist sie wirkungslos.
     */
    let ensureServerChat: ((serverId: string) => Promise<unknown>) | null = null;

    const {
      service: orchestration,
      schedules: serverSchedules,
      liveHub,
      registry: spieltypen,
    } = registerServerOrchestration(app, {
      db,
      agents,
      resolveViewerId: (request) => request.authUser?.id ?? null,
      /*
       * Der öffentliche Port-Pool gehört B8; B3 vergibt keine Ports selbst.
       * Gereicht wird die Fabrik, nicht der fertige Dienst: Die Vergabe eines
       * neuen Servers läuft innerhalb der Reservierungs-Transaktion und braucht
       * den Pool über deren Handle (Fundpunkt 135).
       */
      portPoolFor: admin.portPoolFor,
      /*
       * Zuordnung Agent-Token → Node (Gefundener Punkt 57). Die Tokens führt
       * B8 an der Node; B3 bekommt nur die Nachschlagefunktion, wie beim
       * Port-Pool.
       */
      resolveHostIdByAgentToken: async (token) =>
        (await admin.services.nodes.findByAgentToken(token))?.id ?? null,
      /*
       * Gruppen-Chat eines frisch angelegten Servers (B7, Gefundener Punkt 70).
       * B7 entsteht weiter unten, deshalb über die Weiterleitung oben – bis
       * dahin wirkungslos, danach legt B3 den Chat mit an.
       */
      ensureServerChat: async (serverId) => ensureServerChat?.(serverId),
      events: notifications.eventSink,
    });

    /*
     * Der Stand beim Hochfahren. Danach hält ihn der Anschluss oben aktuell,
     * den die Verwaltung beim Speichern ruft – die Registry liest die
     * Einstellung nie selbst.
     *
     * **Bewusst nicht abgewartet.** Ein `await` hier machte den Start von einer
     * Datenbankabfrage abhängig: Ist die Datenbank in dem Moment nicht
     * erreichbar, käme das Backend gar nicht erst hoch – wegen einer Zeile, die
     * bestimmt, welche Spiele im Wizard stehen. Scheitert die Abfrage, bleibt
     * es beim Vorgabezustand „nichts abgeschaltet", und die Warnung sagt, warum;
     * das nächste Speichern in der Verwaltung zieht es gerade.
     */
    spieleKatalog = spieltypen;
    void admin.instanceSettings
      .disabledGameTypes()
      .then((ids) => {
        spieltypen.setDisabledGameTypes(ids);
      })
      .catch((error: unknown) => {
        app.log.warn(
          { err: error },
          'Abgeschaltete Spieltypen nicht gelesen – vorerst steht jeder Typ zur Auswahl',
        );
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

    // Ab hier legt B3 den Gruppen-Chat beim Anlegen eines Servers an
    // (Gefundener Punkt 70, siehe Weiterleitung oben).
    ensureServerChat = (serverId) => chat.chat.ensureServerConversation(serverId);

    /*
     * Ab hier wirken Sperre (B8) und Sitzungswiderruf (B1) auch auf offene
     * Live-Verbindungen (Audit W2-2). Der Close-Code ist derselbe wie bei der
     * Abweisung im Handshake: Das Frontend erkennt daran „nicht mehr angemeldet"
     * und versucht keine neue Verbindung.
     */
    closeLiveConnections = (userId) => {
      chat.live.closeAll(userId, CHAT_LIVE_CLOSE_CODE_UNAUTHORIZED, 'Sitzung beendet.');
      // Der Inbox-Kanal hängt genauso am Konto und bekommt dieselbe Behandlung.
      notifications.hub.closeAll(userId, NOTIFICATION_CLOSE_CODE_UNAUTHORIZED, 'Sitzung beendet.');
      /*
       * Und der Server-Live-Kanal (Audit W2-5, `orchestration-core-09`): Er
       * blieb bisher als einziger offen und lieferte einem gesperrten oder
       * abgemeldeten Konto weiter Statuswechsel, Messwerte samt Spielernamen
       * und Konsolenzeilen. Derselbe Close-Code wie bei der Abweisung im
       * Handshake – das Frontend erkennt daran „nicht mehr angemeldet".
       */
      liveHub.closeAll(userId, LIVE_CLOSE_CODE_UNAUTHORIZED, 'Sitzung beendet.');
    };

    await app.register(async (instance) => {
      registerChatRoutes(instance, {
        chat: chat.chat,
        moderation: chat.moderation,
        live: chat.live,
        ipHintOf,
        // Herkunftsprüfung des WebSocket-Handshakes (Audit W2-5,
        // `security-matrix-04`) – dieselbe Adresse wie bei CORS oben.
        allowedOrigin: env.PUBLIC_WEB_URL,
        resolveViewer: (request) =>
          request.authUser
            ? { id: request.authUser.id, displayName: request.authUser.displayName }
            : null,
        /*
         * Wiederkehrende Prüfung am offenen Kanal: Sperre und Widerruf schlagen
         * über die Senke oben sofort durch, diese Prüfung fängt alles Übrige ab
         * (abgelaufene Sitzung, Widerruf ohne Senke, verpasste Meldung).
         */
        isSessionValid: async (request) => {
          const sessionId = request.authSessionId;

          if (!authService || sessionId === null) {
            return true;
          }

          try {
            await authService.resolveSession(sessionId);

            return true;
          } catch (error: unknown) {
            /*
             * Nur ein Urteil von B1 („abgelaufen", „gesperrt") beendet die
             * Verbindung. Ein Infrastrukturfehler (Datenbank kurz weg) fliegt
             * weiter und lässt den Kanal offen – die Route behandelt ihn als
             * „diesmal nichts feststellbar".
             */
            if (isAuthError(error)) {
              return false;
            }

            throw error;
          }
        },
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
      async publish(
        event: BackupEventName,
        payload: BackupEventPayloads[BackupEventName],
      ): Promise<void> {
        /*
         * Name und Nutzlast sind zwei Werte – die Verengung des einen sagt dem
         * Compiler nichts über den anderen; der Feldtest ordnet sie einander zu.
         * Getrennt weitergereicht wird ohnehin: Ein Fehlschlag ist ein
         * Benachrichtigungsanlass, der Fortschritt nur Anzeige.
         */
        if (event === 'backup.failed' && 'failureCode' in payload) {
          await notifications.eventSink.publish(event, payload);

          return;
        }

        if (event === 'backup.progressed' && 'backup' in payload) {
          liveHub.publish(event, payload);

          return;
        }

        // Fundpunkt 225: derselbe Weg wie der Backup-Fortschritt - reine
        // Anzeige, kein Benachrichtigungsanlass.
        if (event === 'backupRestore.progressed' && 'job' in payload) {
          liveHub.publish(event, payload);
        }
      },
    };

    const backups = createBackupService({
      repository: createDrizzleBackupRepository(db),
      servers: createDrizzleBackupServerDirectory(db),
      users: createDrizzleUserDirectory(db),
      // Eigene, lange Frist für CREATE_BACKUP/RESTORE_BACKUP: Der Agent
      // antwortet erst nach Fertigstellung, tar+zstd über Gigabyte an
      // Weltdaten sprengt die übliche Befehlsfrist (Audit W1-5, bb-02).
      agent: createAgentBackupGateway({
        agents,
        repository: serverRepository,
        // Meldet den Rückfall auf die Node der Installation, wenn eine
        // Sicherung keine Node am Datensatz trägt (Fundpunkt 174).
        log: app.log,
        backupTimeoutMs: env.BACKUP_COMMAND_TIMEOUT_MS,
      }),
      // Der vollständige Export legt die Konfiguration des Servers als
      // `palantir-server.json` mit ins Archiv (P8, Lastenheft §3.3). B5 kennt
      // die Entität `GameServer` nicht; die Quelle stellt B3.
      manifests: createDrizzleServerExportManifestSource(db),
      events: backupEvents,
      // Hintergrundläufe (Backup, Restore) melden Fehlschläge über `app.log`
      // statt als unbehandelte Ablehnung (Audit W0-5, bb-05).
      runJob: createFireAndForgetJobRunner(app.log),
      // Frist, ab der ein hängender Lauf als vom Neustart abgerissen gilt
      // (Audit W1-6, bb-03) – aufgeräumt wird er vom Zeitgeber.
      orphanAfterMs: env.BACKUP_ORPHAN_AFTER_MS,
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
     * Punkt 80). Auf Server-Ebene kommen die Messwerte aus B3 (`orchestration`),
     * das sie beim Abtasten des Verlaufs ohnehin schon erhebt.
     */
    /*
     * Kontingent-Routen (`/admin/users/:userId/limits`, Gefundener Punkt 88).
     * Derselbe `ResourceService` wie oben – die Verwaltung der Nutzer-Limits
     * hängt hier nur an HTTP, eine zweite Kontingent-Logik gibt es nicht.
     */
    await app.register(
      registerResourceRoutes({ resourceLimits: resources, audit: admin.services.audit }),
    );

    /*
     * Kontingent-Anfragen (Mockup-Abgleich 12.3.1). Genehmigt ein Admin, setzt
     * derselbe Ressourcen-Dienst das Kontingent, der es auch von Hand setzt -
     * eine zweite Stelle dafuer waere eine zweite Wahrheit.
     */
    await app.register(
      registerQuotaRequestRoutes({
        service: createQuotaRequestService({
          repository: createDrizzleQuotaRequestRepository(db),
          quotas: resources,
          // Damit eine Genehmigung dieselbe Spur hinterlaesst wie das Setzen
          // von Hand (Pflichtenheft §6).
          audit: admin.services.audit,
        }),
        actorUserId: (request) => request.authUser?.id ?? null,
      }),
    );

    /*
     * Kennzahlen der Instanz fuer die Anmeldeseite (Mockup-Abgleich 2.1).
     * Ohne Sitzung erreichbar - sie stehen dort, bevor sich jemand angemeldet
     * hat. Die Zahl der Spiele kommt aus derselben Registry wie der Wizard,
     * damit auf der Anmeldeseite nichts anderes steht als dahinter.
     */
    await app.register(
      registerPublicStatsRoutes(
        createPublicStatsService({
          db,
          gameTypeCount: () => GAME_TYPE_DEFINITIONS.length,
        }),
      ),
    );

    /*
     * Sicherung des Panels selbst (Mockup-Abgleich 12.5). Der Abzug laeuft ueber
     * `pg_dump` gegen dieselbe `DATABASE_URL`, die auch das Backend benutzt -
     * eine zweite Verbindungsangabe waere eine zweite Wahrheit darueber, welche
     * Datenbank die Instanz eigentlich fuehrt.
     */
    const panelBackups = createPanelBackupService({
      repository: createDrizzlePanelBackupRepository(db),
      directory: env.PANEL_BACKUP_DIR ?? null,
      dumper: createPgDumpDumper({
        databaseUrl: env.DATABASE_URL ?? '',
        binary: env.PG_DUMP_BINARY,
      }),
      files: createNodeBackupFileRemover(),
      intervalHours: env.PANEL_BACKUP_INTERVAL_HOURS === 0 ? null : env.PANEL_BACKUP_INTERVAL_HOURS,
      retentionDays: env.PANEL_BACKUP_RETENTION_DAYS === 0 ? null : env.PANEL_BACKUP_RETENTION_DAYS,
    });

    await app.register(registerPanelBackupRoutes({ service: panelBackups }));

    const scheduler = startScheduler({
      intervalMs: env.SCHEDULER_INTERVAL_MS,
      log: app.log,
      tasks: [
        autoShutdownTask(orchestration, agents, app.log),
        backupScheduleTask(backupSchedules, app.log),
        serverScheduleTask(serverSchedules, app.log),
        statsSamplingTask(orchestration, agents, app.log),
        // Muss **nach** der Abtastung stehen: Die Warnung auf Server-Ebene
        // rechnet mit den Messwerten, die der Schritt darüber gerade in
        // diesem Durchlauf geschrieben hat.
        resourceWarningTask(resources, orchestration, notifications.eventSink, app.log),
        panelBackupTask(panelBackups, app.log),
        /*
         * Fundpunkt 230: Sitzungen, gelesene Meldungen und abgeschlossene
         * Zustellversuche wachsen sonst ohne Ende. Die beiden Repositories
         * gehoeren verschiedenen Modulen - der Zeitgeber kennt nur die drei
         * Methoden, die er braucht.
         */
        dataHousekeepingTask(
          {
            deleteDeadSessions: (now, graceMs) =>
              createDrizzleAuthRepository(db).deleteDeadSessions(now, graceMs),
            deleteReadNotificationsBefore: (cutoff) =>
              createDrizzleNotificationRepository(db).deleteReadNotificationsBefore(cutoff),
            deleteFinishedDeliveriesBefore: (cutoff) =>
              createDrizzleNotificationRepository(db).deleteFinishedDeliveriesBefore(cutoff),
          },
          app.log,
          { retentionDays: env.NOTIFICATION_RETENTION_DAYS },
        ),
        // Fundpunkt 232: Fragt die verbundenen Nodes periodisch nach ihrem
        // Ist-Zustand. Die Antwort laeuft durch denselben Weg wie beim
        // Verbindungsaufbau (`onStateReport` -> `service.reconcile`).
        stateReconcileTask(
          agents,
          { requestState: (hostId) => agents.get(hostId)?.requestState() },
          app.log,
        ),
        // Abgerissene Läufe und die Aufbewahrungsfrist (Audit W1-6,
        // Fundpunkte 130 und 131). Eigener Abstand innerhalb des Takts: Hier
        // ist nichts minutengenau fällig.
        backupHousekeepingTask(backups, panelBackups, app.log),
      ],
    });

    app.addHook('onClose', async (): Promise<void> => {
      scheduler.stop();
    });
  }

  return app;
}
