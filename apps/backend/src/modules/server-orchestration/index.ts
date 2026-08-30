/**
 * B3 – Server-Orchestrierung (Pflichtenheft §2.2, §9, §11, §13; STRUKTUR.md).
 *
 * Öffentliche Schnittstelle des Moduls:
 *
 * - `registerServerOrchestration()` – hängt REST-Routen und den
 *   WebSocket-Endpunkt `/agent` in eine Fastify-Instanz ein
 * - `ServerOrchestrationService` – die fachlichen Abläufe (anlegen, starten,
 *   stoppen, klonen, löschen, Soll/Ist-Abgleich, Auto-Shutdown)
 * - State Machine, Crash-Loop-Schutz, Auto-Shutdown, Abgleich, Spiele-Registry,
 *   Subdomain- und Portvergabe – jeweils als reine, einzeln geprüfte Bausteine
 *
 * Anschlusspunkte für andere Arbeitspakete:
 *
 * | Paket | Anschluss |
 * |---|---|
 * | B1 (Auth) | `resolveViewerId` – Konto des Aufrufers am Request |
 * | B2 (RBAC) | `PermissionActor` über `registerRbac()`; hier nur benutzt |
 * | B4 (Ressourcen) | `assertStartCapacity()`; B3 liefert die Belegung aus `game_servers` |
 * | B6 (Notifications) | `OrchestrationEventSink` – die Ereignisse aus §14 |
 * | A2/A3 (Agent) | ausschließlich über `packages/contracts` |
 */

import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { type Database } from '../../db/client.js';
import { registerAgentRoute } from './agent-route.js';
import { AgentRegistry } from './agent-gateway.js';
import { ServerLiveHub, createLiveFanoutSink } from './live-hub.js';
import { registerServerLiveRoute } from './live-route.js';
import { DEFAULT_AUTO_SHUTDOWN } from './auto-shutdown.js';
import { createCloudflareDnsProvider } from './dns/cloudflare.js';
import { type DnsProvider, createNoopDnsProvider } from './dns/types.js';
import { createGameRegistry } from './game-registry.js';
import { createHealthProbe } from './health-check.js';
import { type PortPoolPort, createPortAllocator } from './ports.js';
import { buildResourceService, resourceWarningThresholdsFromEnv } from '../resources/index.js';
import { createDrizzleCapacityReservation } from './capacity-reservation.js';
import {
  type CapacityReservation,
  type ResourceGuard,
  createResourceGuardFromService,
} from './resource-guard.js';
import { createDrizzleServerUsageRepository } from './usage-repository.js';
import { createDrizzleServerRepository } from './repository.js';
import { registerServerRoutes } from './routes.js';
import { type OrchestrationEventSink, ServerOrchestrationService } from './service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Konto des Aufrufers; `null`, solange niemand angemeldet ist.
     *
     * Wird von {@link registerServerOrchestration} aus der vom Aufrufer
     * gelieferten `resolveViewerId`-Funktion gefüllt – dieselbe Aufteilung wie
     * bei `permissionActor` in B2: Das Modul, das die Sitzung kennt (B1),
     * liefert den Wert; die fachlichen Module benutzen ihn nur.
     */
    viewerUserId: string | null;
  }
}

export interface ServerOrchestrationOptions {
  readonly db: Database;
  /** Konto des Aufrufers – kommt aus der Sitzung (B1). */
  resolveViewerId(request: FastifyRequest): Promise<string | null> | string | null;
  /**
   * Ressourcenprüfung.
   *
   * Ohne Angabe wird der Service aus B4 verdrahtet (`assertStartCapacity()`,
   * Pflichtenheft §10) – B3 baut die Prüfung ausdrücklich **nicht** selbst
   * (siehe `resource-guard.ts`). Überschreibbar für Tests.
   */
  readonly resources?: ResourceGuard;
  /**
   * Port-Pool aus B8 (`PortPoolService`).
   *
   * Pflicht: B3 vergibt oeffentliche Ports ausdruecklich nicht selbst
   * (Pflichtenheft §2.4, CLAUDE.md §6).
   */
  readonly portPool: PortPoolPort;
  /** Ereignissenke aus B6; ohne Angabe wird nur protokolliert. */
  readonly events?: OrchestrationEventSink;
  /**
   * Registry der offenen Agent-Verbindungen.
   *
   * Ohne Angabe legt das Modul eine eigene an – das ist der Normalfall. Der
   * Aufrufer reicht sie herein, wenn **andere** Module denselben Kanal
   * brauchen: die Backup-Befehle aus B5 und der Speicher-Scan aus B8 laufen
   * über dieselbe Verbindung (Pflichtenheft §5.3), und zwei Registries im
   * selben Prozess wären zwei getrennte Sichten auf denselben Agent.
   */
  readonly agents?: AgentRegistry;
  /** Nur für Tests: eigener DNS-Anbieter. */
  readonly dns?: DnsProvider;
}

export function registerServerOrchestration(
  app: FastifyInstance,
  options: ServerOrchestrationOptions,
): ServerOrchestrationService {
  app.decorateRequest('viewerUserId', null);

  app.addHook('onRequest', async (request: FastifyRequest): Promise<void> => {
    request.viewerUserId = await options.resolveViewerId(request);
  });

  const log = {
    info: (details: Record<string, unknown>, message: string): void => {
      app.log.info(details, message);
    },
    warn: (details: Record<string, unknown>, message: string): void => {
      app.log.warn(details, message);
    },
    error: (details: Record<string, unknown>, message: string): void => {
      app.log.error(details, message);
    },
  };

  const repository = createDrizzleServerRepository(options.db);
  const registry = createGameRegistry(env.INSTALLATION_PHASE);
  const agents = options.agents ?? new AgentRegistry();

  const dns =
    options.dns ??
    (env.CLOUDFLARE_API_TOKEN !== undefined && env.CLOUDFLARE_ZONE_ID !== undefined
      ? createCloudflareDnsProvider({
          apiToken: env.CLOUDFLARE_API_TOKEN,
          zoneId: env.CLOUDFLARE_ZONE_ID,
        })
      : createNoopDnsProvider((message, details) => {
          app.log.warn(details, message);
        }));

  // Grundsenke: die Notification-Engine (B6) bzw. – ohne sie – nur ein Log.
  const baseEvents: OrchestrationEventSink = options.events ?? {
    emit: (event, payload): void => {
      app.log.debug({ event, payload }, 'Orchestrierungs-Ereignis');
    },
  };

  // Browserseitiger Live-Kanal (`/live`). Er hängt sich an dieselbe Senke wie
  // B6 (Kommentar an `OrchestrationEventSink`): Jedes Ereignis geht an beide.
  const liveHub = new ServerLiveHub();
  const events = createLiveFanoutSink(baseEvents, liveHub);

  // Ressourcenprüfung aus B4 (Pflichtenheft §10). B3 prüft nicht selbst; die
  // Belegung zählt B3 nur, weil sie in seiner Tabelle steht (usage-repository.ts).
  const resources =
    options.resources ??
    createResourceGuardFromService(
      buildResourceService(createDrizzleServerUsageRepository(options.db)),
    );

  // Serialisiert Prüfung und belegende Schreiboperation über einen Advisory-Lock
  // je Node/Nutzer (WORK_STATUS.md Punkt 98). Nur im Betrieb: Reicht ein Test
  // einen eigenen `resources`-Guard herein, bleibt es beim inline-Verhalten des
  // Dienstes (keine Transaktion gegen die echte Datenbank).
  const reservation: CapacityReservation | undefined = options.resources
    ? undefined
    : createDrizzleCapacityReservation(options.db, resourceWarningThresholdsFromEnv());

  const service = new ServerOrchestrationService({
    repository,
    agents,
    registry,
    dns,
    // Port-Pool aus B8 (Pflichtenheft §2.4) - B3 vergibt keine Ports selbst.
    ports: createPortAllocator(options.portPool),
    resources,
    reservation,
    healthProbe: createHealthProbe(),
    events,
    log,
    config: {
      baseDomain: env.PALANTIR_DOMAIN,
      publicIpv4: env.VPS_PUBLIC_IP,
      routerHostname: env.GAME_ROUTER_HOSTNAME ?? null,
      virtualHostPort: env.MINECRAFT_ROUTER_PORT,
      crashLoopPolicy: {
        maxRestarts: env.CRASH_LOOP_MAX_RESTARTS,
        windowMinutes: env.CRASH_LOOP_WINDOW_MINUTES,
      },
      healthCheckIntervalMs: env.HEALTH_CHECK_INTERVAL_MS,
      healthCheckAttemptTimeoutMs: env.HEALTH_CHECK_ATTEMPT_TIMEOUT_MS,
      defaultAutoShutdown: {
        ...DEFAULT_AUTO_SHUTDOWN,
        idleTimeoutMinutes: env.AUTO_SHUTDOWN_DEFAULT_IDLE_MINUTES,
        graceMinutes: env.AUTO_SHUTDOWN_DEFAULT_GRACE_MINUTES,
      },
    },
  });

  registerAgentRoute(app, {
    agents,
    handlers: {
      onStateReport: (hostId, frame) => service.reconcile(hostId, frame),
      onEvent: (hostId, frame) => service.handleAgentEvent(hostId, frame),
      // Verbindungszustand der Node fortschreiben (Pflichtenheft §6). Bewusst
      // in einem eigenen try/catch: Scheitert das Schreiben, bleibt die Node in
      // der Anzeige veraltet – das ist hinnehmbar, ein Abbruch der gerade
      // aufgebauten Agent-Verbindung wäre es nicht.
      onConnected: async (hostId): Promise<void> => {
        try {
          await repository.markHostConnected(hostId);
        } catch (error) {
          log.error(
            { hostId, error: error instanceof Error ? error.message : String(error) },
            'Node-Status konnte nicht auf online gesetzt werden',
          );
        }
      },
      onDisconnected: async (hostId): Promise<void> => {
        try {
          await repository.markHostDisconnected(hostId);
        } catch (error) {
          log.error(
            { hostId, error: error instanceof Error ? error.message : String(error) },
            'Node-Status konnte nicht auf offline gesetzt werden',
          );
        }
      },
    },
    log,
    token: env.AGENT_TOKEN,
    resolveHostId: async (): Promise<string | null> => (await repository.defaultHost())?.id ?? null,
    commandTimeoutMs: env.AGENT_COMMAND_TIMEOUT_MS,
  });

  registerServerRoutes(app, {
    service,
    repository,
    registry,
    baseDomain: env.PALANTIR_DOMAIN,
  });

  // Browserseitiger Live-Kanal `/live` (Pflichtenheft §5.3): Abos je Server,
  // Ereignis-Frames und Konsolenbefehle. Ohne ihn bliebe die Live-Anzeige im
  // Frontend dauerhaft „unterbrochen".
  registerServerLiveRoute(app, {
    hub: liveHub,
    service,
    repository,
    registry,
    baseDomain: env.PALANTIR_DOMAIN,
  });

  app.addHook('onClose', async (): Promise<void> => {
    agents.closeAll();
  });

  return service;
}

export { ServerOrchestrationError, isServerOrchestrationError } from './errors.js';

export {
  type ServerLifecycleEvent,
  type ServerLifecycleState,
  type TransitionResult,
  applyLifecycleEvent,
  assertTransitionAllowed,
  initialLifecycleState,
  parseServerStatus,
} from './state-machine.js';

export {
  type CrashLoopEvaluation,
  type CrashLoopPolicy,
  DEFAULT_CRASH_LOOP_POLICY,
  clearCrashHistory,
  evaluateCrashLoop,
  pruneCrashTimestamps,
  registerCrash,
} from './crash-loop.js';

export {
  type AutoShutdownDecision,
  type AutoShutdownInput,
  DEFAULT_AUTO_SHUTDOWN,
  decideAutoShutdown,
  graceEndsAt,
} from './auto-shutdown.js';

export {
  type ExpectedServer,
  type ReconciliationAction,
  type ReconciliationPlan,
  planReconciliation,
} from './reconciliation.js';

export {
  type GameRegistry,
  type InstallationPhase,
  GAME_TYPE_DEFINITIONS,
  TEST_GAME_TYPE,
  buildContainerEnv,
  buildServerConfig,
  createGameRegistry,
  primaryPortOf,
  requiresRestartAfterChange,
  toGameTypeDto,
} from './game-registry.js';

export {
  type SubdomainAvailabilityCheck,
  type SubdomainCheckResult,
  checkSubdomain,
  normalizeSubdomain,
  resolveAvailableSubdomain,
} from './subdomain.js';

export {
  type PortAllocator,
  type PortPoolPort,
  createPortAllocator,
  visiblePortOf,
} from './ports.js';

export {
  type CapacityReservation,
  type ResourceCheckRequest,
  type ResourceCheckResult,
  type ResourceGuard,
  assertResourcesAvailable,
  createInlineCapacityReservation,
  createPermissiveResourceGuard,
  createResourceGuardFromService,
} from './resource-guard.js';

export { createDrizzleCapacityReservation } from './capacity-reservation.js';

export { createDrizzleServerUsageRepository } from './usage-repository.js';

export {
  type BackupAgentGatewayOptions,
  type BackupHostResolver,
  createAgentBackupGateway,
  createDrizzleBackupServerDirectory,
} from './backup-ports.js';

export {
  createAgentStorageScanGateway,
  createServerKnownServerSource,
  createServerNameSource,
  createServerNodePlacementSource,
} from './admin-ports.js';

export {
  type AgentSessionHandlers,
  type AgentSocket,
  AgentRegistry,
  AgentSession,
  CLOSE_CODE_PROTOCOL_MISMATCH,
  CLOSE_CODE_UNAUTHORIZED,
  isAuthorizedAgentHandshake,
} from './agent-gateway.js';

export {
  type HealthCheckResult,
  type HealthCheckTarget,
  type HealthProbe,
  awaitHealthy,
  createHealthProbe,
  createPortConnectProbe,
} from './health-check.js';

export { computeGameServerPermissions } from './permissions.js';
export { type ServerDtoContext, toGameServerDto } from './dto.js';
export {
  type ServerRecord,
  type ServerRepository,
  createDrizzleServerRepository,
} from './repository.js';
export {
  type OrchestrationConfig,
  type OrchestrationDependencies,
  type OrchestrationEventSink,
  ServerOrchestrationService,
  containerNameFor,
  dataHostPathFor,
} from './service.js';
export { type DnsProvider, type DnsRecord, createNoopDnsProvider } from './dns/types.js';
export { buildServerDnsRecord, createCloudflareDnsProvider } from './dns/cloudflare.js';
