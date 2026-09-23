/**
 * Der Dienst der Server-Orchestrierung (B3).
 *
 * Führt zusammen, was in den Nachbardateien einzeln steht: State Machine,
 * Crash-Loop-Schutz, Health-Check, Agent-Befehle, Subdomain- und DNS-Vergabe,
 * Portzuweisung, Soll/Ist-Abgleich.
 *
 * Zwei Regeln gelten hier durchgehend:
 *
 * - **Jeder Zustandswechsel läuft über `applyLifecycleEvent()`.** Es gibt in
 *   dieser Datei kein `status: 'running'`, das an der State Machine vorbeigeht.
 * - **Kein Befehl geht an den Agent, bevor der Übergang geprüft ist.** Der
 *   Start eines bereits laufenden Servers soll gar nicht erst auf dem
 *   Homeserver ankommen.
 */

import {
  type AgentContainerStats,
  type ServerCloneJobDto,
  type ServerStatsHistoryDto,
  type AgentEventFrame,
  type AgentStateReportFrame,
  type ExecConsoleCommandResult,
  type GetLogsCommandResult,
  type GameConfigValues,
  type GameTypeDefinition,
  type ServerFileContentDto,
  type ServerFileListDto,
  type ServerResourceLimits,
  type StopCommandPayload,
  buildServerHostname,
} from '@palantir/contracts';
import {
  type CloneServerInput,
  type CreateServerInput,
  type UpdateServerSettingsInput,
} from '@palantir/validation';
import { type AgentGatewayLogger, type AgentRegistry, type AgentSession } from './agent-gateway.js';
import { decideAutoShutdown } from './auto-shutdown.js';
import { type CrashLoopPolicy, evaluateCrashLoop } from './crash-loop.js';
import { buildServerDnsRecord } from './dns/cloudflare.js';
import { type DnsProvider } from './dns/types.js';
import { randomUUID } from 'node:crypto';
import { fireAndForget } from '../../lib/fire-and-forget.js';
import { hasNonGuestRole, isAwaitingApproval } from '../rbac/approval.js';

/**
 * Zuschlag auf die Frist eines `STOP`-Befehls.
 *
 * Die Kulanzzeit sagt, wie lange der Container brauchen darf; dieser Zuschlag
 * deckt den Weg dorthin und zurueck – Verbindung, Warteschlange, das Schliessen
 * der Live-Kanaele. Fuenfzehn Sekunden sind grosszuegig und immer noch weit
 * davon entfernt, einen haengenden Homeserver unbemerkt zu lassen.
 */
const STOPP_ZUSCHLAG_MS = 15_000;
import { ServerOrchestrationError, isServerOrchestrationError } from './errors.js';
import {
  ClockSkewMonitor,
  LatestDiskUsageCache,
  LatestEngineStatsCache,
  LatestQueryCache,
  ServerLoadRegistry,
  type ServerStatsRepository,
} from './stats-history.js';
import { type ServerLoadSnapshot } from '../resources/index.js';
import { type WorldArchiveStore } from './world-import.js';

/**
 * Verweis auf ein hochgeladenes Weltdaten-Archiv (P4).
 *
 * Aus `CreateServerInput` abgeleitet statt eigenständig deklariert – die
 * Eingabe ist der Vertrag, eine zweite Formulierung könnte davon abweichen.
 */
import {
  type ContainerCreateSpec,
  buildContainerSpec,
  containerSpecFingerprint,
} from './container-spec.js';
import {
  type GameRegistry,
  buildServerConfig,
  requiresRestartAfterChange,
} from './game-registry.js';
import {
  type GameVersionCatalogue,
  type GameVersionEintrag,
  type GameVersionQuelle,
} from './game-versions.js';
import { type HealthProbe } from './health-check.js';
import { type PortAllocator, visiblePortOf } from './ports.js';
import {
  type CapacityReservation,
  type ResourceGuard,
  createInlineCapacityReservation,
} from './resource-guard.js';
import {
  consoleLineFromAgentPayload,
  containerIdFromPayload,
  engineStatsFromPayload,
  isServerQueryPayload,
  liveStatsFromAgentPayload,
  querySnapshotFromPayload,
} from './live-events.js';
import { planReconciliation } from './reconciliation.js';
import { ServerCloneService } from './clone-service.js';
import { ServerQueryTargets } from './server-query.js';
import { choosePlacementHost } from './placement.js';
import { StartupActivity } from './startup-activity.js';
import { aktuelleWerte, liveBefehle, liveDatei, pruefeLiveWerte } from './live-controls.js';
import { type StartIntent, StartupHealthCheck } from './startup-health.js';
import { type WorldImportInput, WorldImportTransfer } from './world-import-transfer.js';
import {
  type ServerFileAccessOptions,
  type ServerFileUploadOptions,
  ServerFileService,
} from './file-service.js';
import { ServerStatsSampler } from './stats-sampling.js';

export type {
  ServerDirectoryDownload,
  ServerFileAccessOptions,
  ServerFileUploadOptions,
} from './file-service.js';
import { type HostNodeRecord, type ServerRecord, type ServerRepository } from './repository.js';
import { type ServerAutoShutdown } from './types.js';
import {
  type ServerLifecycleEvent,
  type ServerLifecycleState,
  applyLifecycleEvent,
  assertTransitionAllowed,
} from './state-machine.js';
import { resolveAvailableSubdomain } from './subdomain.js';

/** Ereignisse, die der Dienst nach außen meldet (Pflichtenheft §14). */
export interface OrchestrationEventSink {
  /**
   * @param event Name aus `WEBSOCKET_EVENTS`
   *
   * Bewusst als schmale Schnittstelle: Die Notification-Engine (B6) und der
   * Live-Kanal des Frontends hängen sich hier ein, ohne dass B3 sie kennt.
   */
  emit(event: string, payload: Record<string, unknown>): void;
}

export interface OrchestrationConfig {
  readonly baseDomain: string;
  readonly publicIpv4: string;
  /**
   * Adresse, über die der Health-Check die Spielserver abfragt (Fundpunkt 288).
   *
   * Normalerweise dieselbe wie {@link publicIpv4} – der Weg der Spieler. Läuft
   * das Backend aber auf derselben Maschine wie frps, taugt die eigene
   * öffentliche Adresse für UDP nicht: Die Antwort kommt mit umgeschriebenem
   * Absender zurück (Docker-Gateway statt Ziel), und `gamedig` verwirft sie.
   * Dann steht hier die Adresse des Hosts aus Sicht des Containers.
   *
   * Getrennt von {@link publicIpv4}, weil diese in den DNS-Einträgen der
   * Spielserver landet: Ein Gateway-Name gehört dort nicht hin.
   */
  readonly healthCheckHost: string;
  /** Ziel der `CNAME`-Einträge bei Hostname-Routing; `null`, wenn keiner läuft. */
  readonly routerHostname: string | null;
  readonly virtualHostPort: number;
  readonly crashLoopPolicy: CrashLoopPolicy;
  readonly healthCheckIntervalMs: number;
  readonly healthCheckAttemptTimeoutMs: number;
  /**
   * Frist für das `CREATE` am Agent (Gefundener Punkt 111).
   *
   * Deutlich länger als die übliche Befehlsfrist: Fehlt das Image auf der Node,
   * holt der Agent es beim Anlegen selbst, und ein Spiel-Image bringt Hunderte
   * MB mit.
   */
  readonly createTimeoutMs: number;
  /**
   * Frist für `FILE_LIST` (Fundpunkt 275).
   *
   * Ebenfalls länger als die übliche Befehlsfrist: Die Engine packt für jede
   * Auflistung den ganzen Ordner ein. Die Begründung steht an
   * `AGENT_FILE_LIST_TIMEOUT_MS`.
   */
  readonly fileListTimeoutMs: number;
  /**
   * Frist für das Packen eines Ordners zum Herunterladen
   * (`AGENT_DIRECTORY_ARCHIVE_TIMEOUT_MS`). Eigene Zahl, weil hier
   * tatsächlich gearbeitet wird und nicht nur aufgelistet.
   */
  readonly directoryArchiveTimeoutMs: number;
  readonly defaultAutoShutdown: ServerAutoShutdown;
  /**
   * Maximale Upload-Größe pro Datei aus `MAX_UPLOAD_SIZE_BYTES` (Pflichtenheft
   * §12.1). Wirksam ist der kleinere Wert aus dieser Angabe und
   * `AGENT_FILE_CHANNEL_MAX_BYTES`.
   */
  readonly maxUploadBytes: number;
  /**
   * Maximale Größe eines Weltdaten-Archivs aus `MAX_WORLD_ARCHIVE_BYTES` (P4).
   *
   * Seit Gefundenem Punkt 106 gilt allein diese Angabe: Das Archiv geht nicht
   * mehr in einem Frame an den Agent, sondern blockweise – die Frame-Grenze
   * `AGENT_FILE_CHANNEL_MAX_BYTES` begrenzt nur noch den einzelnen Block.
   */
  readonly maxWorldArchiveBytes: number;
  /** Aufbewahrungsfrist des Messwert-Verlaufs in Stunden (`STATS_HISTORY_RETENTION_HOURS`). */
  readonly statsHistoryRetentionHours: number;
  /**
   * Abstand zweier Stichproben in Millisekunden – der Takt des Zeitgebers
   * (`SCHEDULER_INTERVAL_MS`). Steht im DTO, damit das Diagramm Lücken erkennt.
   */
  readonly statsSampleIntervalMs: number;
}

/** Was die Datei-Routen aus dem `permissions`-Objekt des Servers mitgeben. */

/**
 * Warum ein Server gestoppt wird (Audit event-flow-09).
 *
 * Entscheidet allein darüber, **ob** der Stopp eine eigene Meldung wert ist –
 * am Zustandswechsel und am Agent-Befehl ändert er nichts. `'restart'` und
 * `'autoShutdown'` sind Zwischenschritte eines größeren Vorgangs, der seine
 * eigene, genauere Meldung hat.
 */
export type StopReason = 'manual' | 'restart' | 'autoShutdown';

export type { StartIntent } from './startup-health.js';

export interface OrchestrationDependencies {
  readonly repository: ServerRepository;
  readonly agents: AgentRegistry;
  readonly registry: GameRegistry;
  /**
   * Wählbare Spielversionen (Betreiber-Wunsch 19.09.2026).
   *
   * Optional: Ohne Katalog bleibt alles wie bisher – jeder Server fährt die
   * Version seines Images.
   */
  readonly gameVersions?: GameVersionCatalogue;
  readonly dns: DnsProvider;
  readonly ports: PortAllocator;
  /**
   * Legt den Gruppen-Chat eines Servers an (B7, Gefundener Punkt 70).
   *
   * Ohne Angabe entsteht er wie bisher beim ersten Öffnen. B3 kennt B7 nicht –
   * hier steht nur die schmale Funktion, die `server.ts` hereinreicht.
   */
  readonly ensureServerChat?: (serverId: string) => Promise<unknown>;
  readonly resources: ResourceGuard;
  /**
   * Serialisiert Kapazitätsprüfung und belegende Schreiboperation (Punkt 98).
   *
   * Ohne Angabe wird aus {@link resources} und {@link repository} eine
   * Reservierung ohne eigene Serialisierung gebildet – das bisherige Verhalten,
   * das für Tests und für den Betrieb ohne Transaktionen genügt. Der
   * Betriebszusammenbau reicht die Drizzle-Umsetzung herein (Advisory-Lock je
   * Node/Nutzer, `capacity-reservation.ts`).
   */
  readonly reservation?: CapacityReservation;
  readonly healthProbe: HealthProbe;
  /**
   * Zwischenspeicher der hochgeladenen Weltdaten-Archive (P4).
   *
   * Ohne Angabe bleibt `worldImport` beim Anlegen wirkungslos – so bleiben die
   * bestehenden Tests unverändert, die das Anlegen ohne Import prüfen.
   */
  readonly worldArchives?: WorldArchiveStore;
  /**
   * Ablage des Messwert-Verlaufs (P5).
   *
   * Ohne Angabe wird nichts festgehalten – so bleiben die bestehenden Tests
   * unverändert, die den Lifecycle ohne Verlauf prüfen.
   */
  readonly statsHistory?: ServerStatsRepository;
  readonly events: OrchestrationEventSink;
  readonly log: AgentGatewayLogger;
  readonly config: OrchestrationConfig;
  /** Nur für Tests: feste Zeit bzw. Wartezeit ohne echtes Warten. */
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Container-Name auf dem Homeserver – die Konvention aus A1/A2. */
export function containerNameFor(serverId: string): string {
  return `palantir-${serverId}`;
}

/**
 * Datenordner eines Servers auf dem Homeserver.
 *
 * Steht hier und nicht nur im `CREATE`-Befehl, weil die Backup-Verwaltung (B5)
 * denselben Pfad braucht (`BackupServerRecord.dataHostPath`). Zwei getrennt
 * gepflegte Ableitungen desselben Pfades wären die Sorte Fehler, die erst beim
 * Zurückspielen einer Sicherung auffällt.
 */
export function dataHostPathFor(serverId: string): string {
  return `/srv/palantir/servers/${serverId}`;
}

export { WORLD_IMPORT_CHUNK_BYTES } from './world-import-transfer.js';

export class ServerOrchestrationService {
  private readonly deps: OrchestrationDependencies;
  private readonly now: () => Date;
  private readonly reservation: CapacityReservation;
  /**
   * Zuletzt gemeldete Server-Abfrage je Server (Spielerzahl, Antwortzeit).
   *
   * Als aktuell gilt eine Meldung, solange sie jünger ist als die doppelte
   * Aufbewahrungs-Abtastung – hier schlicht fünf Minuten: Danach ist eine
   * Spielerzahl im Minutenverlauf eine Zeile, die nie stimmt (siehe
   * `stats-history.ts`).
   */
  private readonly latestQuery = new LatestQueryCache(5 * 60 * 1000);
  /**
   * Zuletzt gemessener Plattenplatz je Server (Fundpunkt 175).
   *
   * Gefüllt beim Abtasten ({@link sampleServerStats}) – nur dort kommt der Wert
   * überhaupt an, weil er an `GET_STATS` hängt und nicht am Statistik-Strom der
   * Engine. Gelesen beim Live-Ereignis, damit die Anzeige ihn auch zwischen
   * zwei Abtastungen behält.
   *
   * Fünf Minuten Frist, aus derselben Überlegung wie beim `latestQuery`: Der
   * Agent misst den Datenordner ohnehin höchstens alle fünf Minuten neu
   * (`DEFAULT_DISK_USAGE_TTL_MS`). Ist der letzte Wert älter, hat nicht die
   * Messung gestockt, sondern die Zustellung – dann ist „—" ehrlicher als eine
   * Zahl von vorhin.
   */
  private readonly latestDiskUsage = new LatestDiskUsageCache(5 * 60 * 1000);
  /**
   * Zuletzt gemeldete Messwerte der Container-Engine je Server (Fundpunkt 179).
   *
   * Das Gegenstück zum {@link latestQuery}: Dort merkt sich der Dienst, was nur
   * die Server-Abfrage weiß, hier, was nur der Statistik-Strom weiß. Ohne das
   * löschte jeder Abfrage-Rahmen die Kacheln „CPU", „Arbeitsspeicher" und
   * „Netzverkehr", weil das Frontend die Messwerte je Rahmen vollständig
   * ersetzt.
   *
   * **Deutlich kürzere Frist als bei den beiden anderen** – die Vorgabe des
   * Speichers selbst (`LIVE_ENGINE_STATS_MAX_AGE_MS`, zehn Sekunden).
   * CPU ist eine Sekundengröße; ein Wert von vor fünf Minuten wäre keine
   * Überbrückung mehr, sondern eine Behauptung.
   */
  private readonly latestEngineStats = new LatestEngineStatsCache();
  /**
   * Abgleich der Agent-Uhr gegen die eigene (W2-14,
   * orchestration-features-03).
   *
   * Entscheidet nichts über den Messwert – der trägt immer die Backend-Zeit –,
   * sondern nur darüber, wann eine auffällige Abweichung ins Protokoll gehört.
   * Die Drosselung sitzt im Monitor, weil `STATS_UPDATE` je Server im
   * Sekundentakt eintrifft.
   */
  private readonly clockSkew = new ClockSkewMonitor();
  /**
   * Klon-Aufträge (P7) – Auftragsspeicher und Ablauf in `clone-service.ts`.
   *
   * Im Dienst und nicht in den Abhängigkeiten: Ein Auftrag beschreibt einen
   * Vorgang **dieses** Prozesses; ein zweiter Speicher daneben wäre eine zweite
   * Wahrheit über denselben Lauf.
   */
  private readonly clones: ServerCloneService;
  /** Server-Abfrage des Agents (Befund 2.1) – eigene Klasse. */
  private readonly queries: ServerQueryTargets;
  /** Health-Check nach dem Start (Befund 2.1) – eigene Klasse. */
  private readonly startupHealth: StartupHealthCheck;
  /** Konsolenaktivität laufender Starts (`startup-activity.ts`). */
  private readonly startupActivity: StartupActivity;
  /** Weltdaten-Übernahme beim Anlegen (Befund 2.1) – eigene Klasse. */
  private readonly worldImport: WorldImportTransfer;
  /**
   * Zuletzt gemessene Last je laufendem Server – Quelle der Ressourcen-Warnung
   * auf Server-Ebene (Lastenheft §3.3).
   *
   * **Warum zwei Takte als Frist.** Geschrieben wird der Stand einer Node genau
   * einmal je Durchlauf des Zeitgebers, unmittelbar bevor die Warnungen
   * ausgewertet werden – im Normalfall ist ein Wert also Sekunden alt. Ist er
   * älter als zwei Takte, hat mindestens ein vollständiger Durchlauf nichts
   * gemessen: Der Agent ist abgemeldet, die Node hängt, oder die Abtastung
   * scheitert. Ein Takt als Frist wäre zu knapp, weil die Abtastung selbst Zeit
   * braucht und sich der Schreibzeitpunkt dadurch verschiebt; deutlich mehr
   * hieße, auf einen Zustand hin zu warnen, den seit Minuten niemand mehr
   * misst.
   */
  private readonly serverLoads: ServerLoadRegistry;
  /** Datei-Manager (Befund 2.1) – eigene Klasse, hier nur durchgereicht. */
  private readonly files: ServerFileService;
  /** Abtastung und Verlauf der Messwerte (Befund 2.1) – ebenso. */
  private readonly stats: ServerStatsSampler;

  constructor(deps: OrchestrationDependencies) {
    this.deps = deps;
    this.now = deps.now ?? ((): Date => new Date());
    this.reservation =
      deps.reservation ??
      createInlineCapacityReservation(deps.resources, deps.repository, deps.ports);
    this.worldImport = new WorldImportTransfer({
      agents: deps.agents,
      ...(deps.worldArchives === undefined ? {} : { worldArchives: deps.worldArchives }),
      config: deps.config,
      log: deps.log,
    });
    this.queries = new ServerQueryTargets({
      agents: deps.agents,
      registry: deps.registry,
      repository: deps.repository,
      log: deps.log,
      antwortetAufAbfragen: (server) => this.antwortetAufAbfragen(server),
    });
    this.startupActivity = new StartupActivity(() => this.now().getTime());
    this.startupHealth = new StartupHealthCheck({
      registry: deps.registry,
      repository: deps.repository,
      config: deps.config,
      healthProbe: deps.healthProbe,
      ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
      now: this.now,
      log: deps.log,
      requireServer: (serverId) => this.requireServer(serverId),
      activity: this.startupActivity,
      hostnameFor: (server) => this.hostnameFor(server),
      antwortetAufAbfragen: (server) => this.antwortetAufAbfragen(server),
      transition: (server, event) => this.transition(server, event),
      emitServerEvent: (event, server, extra) => this.emitServerEvent(event, server, extra),
    });
    this.clones = new ServerCloneService({
      repository: deps.repository,
      agents: deps.agents,
      events: deps.events,
      log: deps.log,
      now: this.now,
      requireServer: (serverId) => this.requireServer(serverId),
      createServer: (input, ownerId, clonedFromServerId) =>
        this.createServerInternal(input, ownerId, clonedFromServerId),
      dataHostPathFor,
      markFailed: async (server, reason) => {
        await this.transition(server, { type: 'failed', reason });
      },
      emitServerEvent: (event, server, extra) => this.emitServerEvent(event, server, extra),
    });
    this.serverLoads = new ServerLoadRegistry(2 * deps.config.statsSampleIntervalMs);
    this.files = new ServerFileService({
      registry: deps.registry,
      config: deps.config,
      requireLiveTarget: (serverId) => this.requireLiveTarget(serverId),
      now: this.now,
    });
    this.stats = new ServerStatsSampler({
      repository: deps.repository,
      ...(deps.statsHistory === undefined ? {} : { statsHistory: deps.statsHistory }),
      config: deps.config,
      log: deps.log,
      now: this.now,
      getStats: (serverId) => this.getStats(serverId),
      latestQuery: this.latestQuery,
      latestDiskUsage: this.latestDiskUsage,
      serverLoads: this.serverLoads,
    });
  }

  // -------------------------------------------------------------------------
  // Lesen
  // -------------------------------------------------------------------------

  async requireServer(serverId: string): Promise<ServerRecord> {
    const server = await this.deps.repository.findById(serverId);

    if (server === null) {
      throw new ServerOrchestrationError('SERVER_NOT_FOUND', undefined, { serverId });
    }

    return server;
  }

  /** Abstürze im laufenden Fenster – für `GameServerDto.recentCrashCount`. */
  recentCrashCount(server: ServerRecord): number {
    return evaluateCrashLoop(server.crashTimestamps, this.now(), this.deps.config.crashLoopPolicy)
      .recentCrashCount;
  }

  hostnameFor(server: ServerRecord): string {
    return buildServerHostname(server.subdomain, this.deps.config.baseDomain);
  }

  /**
   * Zuletzt gemeldete Spielerzahl – für die Status-Kachel des Discord-Bots
   * (Pflichtenheft §14a.5). `null`, wenn das Spiel keine meldet oder der
   * letzte Stand älter ist als die Frist des Zwischenspeichers.
   */
  latestPlayerCount(serverId: string): { online: number; max: number | null } | null {
    const stand = this.latestQuery.read(serverId, this.now());

    return stand.playersOnline === null
      ? null
      : { online: stand.playersOnline, max: stand.playersMax };
  }

  // -------------------------------------------------------------------------
  // Anlegen
  // -------------------------------------------------------------------------

  /**
   * Legt einen Server an und wartet, bis er steht (Lastenheft §3.3).
   *
   * Reihenfolge ist bewusst gewählt: erst die Prüfungen, die ohne Nebenwirkung
   * scheitern können (Spiel-Typ, Subdomain, Ressourcen), dann der
   * Datenbankeintrag samt Ports in einer Reservierung, dann die Nebenwirkungen
   * nach außen (DNS, Container). Scheitert eine Nebenwirkung, räumt
   * `rollbackFailedCreate()` auf, solange nie ein Container entstand.
   *
   * Der wartende Weg – der Aufrufer bekommt erst nach Image-Zug und
   * Container-Bau eine Antwort. Für die Route ist das seit Fundpunkt 185 der
   * falsche Vertrag (siehe {@link beginCreateServer}); hier bleibt er für den
   * Klon, der ohnehin einen eigenen Fortschritts-Job hat, und für alles, was
   * ein fertiges Ergebnis braucht.
   */
  async createServer(input: CreateServerInput, ownerId: string): Promise<ServerRecord> {
    return this.createServerInternal(input, ownerId, null);
  }

  /**
   * Legt einen Server an und antwortet sofort – im Zustand `creating`
   * (Fundpunkt 185).
   *
   * Bis hierher kam `POST /servers` erst zurück, wenn der Agent das Image
   * gezogen und den Container gebaut hatte: bei einem Spiel-Image Minuten, im
   * Wizard ein drehender Knopf ohne jede Rückmeldung. Der Zustand `creating`
   * existiert seit Pflichtenheft §9, war aber nie sichtbar, weil die Anfrage
   * ihn übersprang.
   *
   * Jetzt endet die Anfrage mit der Reservierung: Datensatz und Ports stehen,
   * der Rest (DNS, Container, Weltdaten) läuft im Hintergrund weiter. Das
   * Ergebnis kommt als `server.statusChanged` über den Live-Kanal – `stopped`,
   * wenn der Container steht, `error` mit dem Grund im `statusMessage`, wenn
   * nicht.
   *
   * **Bewusst kein Rückbau bei Fehlschlag:** Der Nutzer sieht die Detailseite
   * und soll dort lesen, woran es lag, und es mit „Starten" noch einmal
   * versuchen – `startServer()` legt einen fehlenden Container an
   * (`ensureContainerCurrent`) – oder löschen. Ein Server, der still
   * verschwindet, während man ihn ansieht, wäre die schlechtere Antwort. Der
   * Preis: Subdomain und Ports bleiben belegt, bis jemand löscht. Bei der
   * wartenden Variante ist das anders, dort gibt es keine Seite, die den Grund
   * zeigen könnte.
   */
  async beginCreateServer(input: CreateServerInput, ownerId: string): Promise<ServerRecord> {
    const reserviert = await this.reserveServer(input, ownerId, null);
    const server = await this.requireServer(reserviert.id);

    // `provision()` setzt bei einem Fehlschlag selbst `error` mit Grund und
    // meldet `server.failed`; hier bleibt nur das Protokoll.
    void this.provision(server, input.worldImport).catch((error: unknown) => {
      this.deps.log.warn(
        { serverId: server.id, error: error instanceof Error ? error.message : String(error) },
        'Anlegen im Hintergrund gescheitert – der Server bleibt auf error, bis er gestartet oder gelöscht wird',
      );
    });

    return server;
  }

  /**
   * Eine gewählte Spielversion beim Hersteller nachschlagen.
   *
   * `null` heißt „die des Images" – das ist der Regelfall und kein Fehler.
   * Eine Version, die der Hersteller nicht (mehr) führt, ist dagegen einer:
   * Sonst entstünde ein Server, dessen Oberfläche „26.3" zeigt, während im
   * Container die Version des Images läuft.
   */
  private async resolveGameVersion(
    definition: GameTypeDefinition,
    versionId: string | null,
  ): Promise<GameVersionQuelle | null> {
    if (versionId === null || versionId === '') {
      return null;
    }

    if (definition.supportsVersionChoice !== true) {
      throw new ServerOrchestrationError(
        'VALIDATION_FAILED',
        `Für ${definition.name} lässt sich die Spielversion nicht wählen.`,
      );
    }

    const quelle = (await this.deps.gameVersions?.resolve(definition.id, versionId)) ?? null;

    if (quelle === null) {
      throw new ServerOrchestrationError(
        'VALIDATION_FAILED',
        `Die Spielversion ${versionId} ist beim Hersteller nicht (mehr) zu finden.`,
      );
    }

    return quelle;
  }

  /** Wählbare Versionen eines Spiels; leer, wo es nichts zu wählen gibt. */
  async listGameVersions(gameTypeId: string): Promise<readonly GameVersionEintrag[]> {
    const definition = this.deps.registry.find(gameTypeId);

    if (definition === null || definition.supportsVersionChoice !== true) {
      return [];
    }

    return (await this.deps.gameVersions?.list(gameTypeId)) ?? [];
  }

  private async createServerInternal(
    input: CreateServerInput,
    ownerId: string,
    clonedFromServerId: string | null,
  ): Promise<ServerRecord> {
    const created = await this.reserveServer(input, ownerId, clonedFromServerId);

    try {
      await this.provision(await this.requireServer(created.id), input.worldImport);

      return await this.requireServer(created.id);
    } catch (error: unknown) {
      /*
       * Aufräumen, statt eine Leiche stehen zu lassen (WORK_STATUS.md,
       * Gefundener Punkt 112). Ohne das blieb nach einem gescheiterten Anlegen
       * ein Datensatz auf `error` zurück – samt belegter Subdomain und
       * belegten Ports. Der zweite Versuch mit derselben Adresse lief dann in
       * „Diese Subdomain ist bereits vergeben", und der Nutzer musste erst von
       * Hand löschen. Geräumt wird nur, solange nie ein Container entstand –
       * die Begründung steht an `rollbackFailedCreate()`.
       *
       * Der Fehler selbst geht weiter nach oben: Er ist die Antwort auf den
       * Anlegen-Versuch, und `server.failed` ist bereits gemeldet.
       */
      await this.rollbackFailedCreate(created.id);

      throw error;
    }
  }

  /**
   * Prüfungen, Datensatz und Ports – der Teil des Anlegens, der keine andere
   * Maschine berührt. Scheitert er, bleibt nichts zurück.
   */
  private async reserveServer(
    input: CreateServerInput,
    ownerId: string,
    clonedFromServerId: string | null,
  ): Promise<ServerRecord> {
    const definition = this.deps.registry.requireSelectable(input.gameType);
    const subdomain = await resolveAvailableSubdomain(input.subdomain, this.deps.repository);
    const host = await this.resolveHost(input.hostId);
    const version = await this.resolveGameVersion(definition, input.gameVersion ?? null);

    const resourceLimits: ServerResourceLimits = input.resourceLimits;

    /*
     * Prüfung, Insert **und Portvergabe** laufen in einer serialisierten
     * Reservierung: Sonst bestünden zwei gleichzeitige Creates beide die
     * Prüfung und überbuchten die Node (TOCTOU, WORK_STATUS.md Punkt 98,
     * Pflichtenheft §10). Der Datensatz entsteht zuerst – der Port-Pool aus B8
     * ordnet Ports einer Server-Id zu, die es dafür schon geben muss.
     *
     * Die Portvergabe lag bis Fundpunkt 135 bewusst **außerhalb** (Audit
     * backend-db-04): `PortPoolService.allocateForServer()` fängt die Kollision
     * zweier paralleler Vergaben über die Unique-Verletzung des Index ab und
     * versucht den nächsten freien Port – und ein Constraint-Fehler bricht
     * innerhalb einer Transaktion die ganze Transaktion ab, die Wiederholung
     * liefe ins Leere. Seit die Drizzle-Umsetzung des Port-Pools jeden
     * Einfügeversuch in einen eigenen Savepoint stellt, rollt ein verlorenes
     * Rennen nur diesen Savepoint zurück. Damit ist der Zustand „Server
     * angelegt, Ports fehlen" nicht mehr möglich: Scheitert die Vergabe,
     * verschwindet der Datensatz mit derselben Transaktion – samt Subdomain,
     * ohne dass jemand aufräumen muss.
     *
     * Was danach kommt (DNS, Container), liegt bewusst draußen: Das sind
     * Wirkungen auf anderen Maschinen, die keine Transaktion zurücknimmt –
     * dafür ist `rollbackFailedCreate()` da.
     */

    /*
     * Die Id des angelegten Datensatzes, sobald es einen gibt.
     *
     * Sie wird **innerhalb** der Reservierung gesetzt, gebraucht wird sie
     * außerhalb: Scheitert die Vergabe, wirft `reserve()` – und ohne diese
     * Merkstelle wüsste das Aufräumen unten nicht, was es aufräumen soll. Bei
     * der Drizzle-Umsetzung ist danach ohnehin nichts mehr da (der Rollback hat
     * den Datensatz mitgenommen, `rollbackFailedCreate()` findet nichts und
     * kehrt sofort um). Bei einer Reservierung ohne Transaktion – der Rückfall
     * aus `createInlineCapacityReservation()` – ist sie das, was die Leiche
     * verhindert.
     */
    const angelegt: { id: string | null } = { id: null };

    try {
      const created = await this.reservation.reserve(
        {
          userId: ownerId,
          hostId: host.id,
          serverId: null,
          // Der Platzbedarf ist die Schätzung des Spiels, keine Zuweisung.
          requested: { ...resourceLimits, diskMb: definition.resourceDefaults.diskMb },
          intent: 'create',
        },
        async (scope) => {
          const server = await scope.servers.create({
            ownerId,
            hostId: host.id,
            name: input.name,
            gameType: definition.id,
            gameVersion: version?.id ?? null,
            gameVersionUrl: version?.url ?? null,
            gameVersionHash: version?.hash ?? null,
            gameVersionHashAlgorithm: version?.hashAlgorithm ?? null,
            subdomain,
            assignedPorts: [],
            resourceLimits,
            configJson: buildServerConfig(definition, input.config),
            startupParameters: input.startupParameters,
            autoShutdown: {
              ...this.deps.config.defaultAutoShutdown,
              enabled: input.autoShutdownEnabled,
            },
            clonedFromServerId,
          });

          angelegt.id = server.id;

          const assignedPorts = await scope.ports.allocate(server.id, definition, {
            nodeId: host.id,
            virtualHostPort: definition.supportsVirtualHostRouting
              ? this.deps.config.virtualHostPort
              : null,
          });

          await scope.servers.update(server.id, { assignedPorts });

          // `update()` liefert nichts zurück; der frisch angelegte Datensatz
          // plus die eben vergebenen Ports ist derselbe Stand, ohne ihn erneut
          // zu laden – und ein Laden wäre hier ohnehin nur innerhalb der
          // Transaktion sichtbar.
          return { ...server, assignedPorts };
        },
      );

      return created;
    } catch (error: unknown) {
      // Scheitert die Vergabe nach dem Insert (Rückfall ohne Transaktion),
      // darf der Datensatz nicht als Leiche stehen bleiben – siehe `angelegt`.
      if (angelegt.id !== null) {
        await this.rollbackFailedCreate(angelegt.id);
      }

      throw error;
    }
  }

  /**
   * Reste eines gescheiterten Anlegens entfernen.
   *
   * Jeder Schritt für sich abgesichert: Was hier scheitert, darf den
   * eigentlichen Fehler nicht verdecken. Ein Rest, der liegen bleibt, wird
   * protokolliert – der Speicher-Explorer (B8) findet ihn als verwaisten
   * Posten, und die Subdomain ist in jedem Fall wieder frei, sobald der
   * Datensatz weg ist.
   */
  private async rollbackFailedCreate(serverId: string): Promise<void> {
    const server = await this.deps.repository.findById(serverId);

    if (server === null) {
      return;
    }

    /*
     * Nur aufräumen, solange nie ein Container entstanden ist.
     *
     * Scheitert erst ein späterer Schritt – etwa die Weltdaten-Übernahme (P4) –,
     * liegt auf der Node bereits ein Container samt Datenordner. Den still
     * wegzuräumen hieße, einen halb übernommenen Spielstand ohne Rückfrage zu
     * löschen. Dann bleibt es beim bisherigen Verhalten: Der Server steht auf
     * `error` und wird im Panel bewusst entfernt.
     */
    if (server.dockerContainerId !== null) {
      return;
    }

    const aufraeumen = async (was: string, schritt: () => Promise<unknown>): Promise<void> => {
      try {
        await schritt();
      } catch (error: unknown) {
        this.deps.log.warn(
          { serverId, schritt: was, error: error instanceof Error ? error.message : String(error) },
          'Rest eines gescheiterten Anlegens konnte nicht entfernt werden',
        );
      }
    };

    await aufraeumen('dns', () => this.deps.dns.deleteRecord(this.hostnameFor(server)));
    await aufraeumen('ports', () => this.deps.ports.release(serverId));
    // Zuletzt der Datensatz: Solange er steht, sind Subdomain und Ports belegt.
    await aufraeumen('datensatz', () => this.deps.repository.delete(serverId));
  }

  /**
   * DNS-Eintrag und Container anlegen.
   *
   * Ausgelagert, weil das Klonen dieselbe Kette braucht.
   */
  private async provision(
    server: ServerRecord,
    worldImport: WorldImportInput | null = null,
  ): Promise<void> {
    const definition = this.deps.registry.require(server.gameType);

    try {
      const record = buildServerDnsRecord({
        hostname: this.hostnameFor(server),
        supportsVirtualHostRouting: definition.supportsVirtualHostRouting,
        publicIpv4: this.deps.config.publicIpv4,
        virtualHostProxyHostname: this.deps.config.routerHostname,
      });

      const dnsRecordId = await this.deps.dns.upsertRecord(record);

      const session = this.deps.agents.require(server.hostId);
      const spec = this.containerSpecFor(server, definition);

      const created = await session.sendCommand(
        'CREATE',
        server.id,
        spec,
        /*
         * Eigene Frist: Fehlt das Image auf der Node, holt der Agent es beim
         * Anlegen selbst (Gefundener Punkt 111) – das dauert bei einem
         * Spiel-Image Minuten, nicht Sekunden.
         */
        { timeoutMs: this.deps.config.createTimeoutMs },
      );

      await this.deps.repository.update(server.id, {
        dnsRecordId,
        dockerContainerId: created.containerId,
        // Womit der Container tatsächlich angelegt wurde – Grundlage für
        // „Update verfügbar" (Mockup-Abgleich 3.4) und für den Abgleich, ob er
        // noch zum heutigen Bauplan passt (Punkt 114).
        imageRef: spec.image,
        containerSpecHash: containerSpecFingerprint(spec),
      });

      // Weltdaten übernehmen, solange der Server noch als „wird angelegt" gilt
      // (P4). Bewusst hier und nicht danach: Scheitert der Import, ist der
      // Server nicht „fertig, nur ohne Welt", sondern fehlgeschlagen – ein
      // leerer Server unter dem Namen eines übernommenen wäre die schlechtere
      // Antwort. Der Container läuft dafür nicht; geschrieben wird über den
      // Archiv-Endpunkt der Engine, der auch bei gestopptem Container arbeitet.
      if (worldImport !== null) {
        await this.worldImport.importWorldData(server, created.containerId, worldImport);
      }

      await this.transition(server, { type: 'createSucceeded' });
      await this.ensureServerChat(server.id);

      /*
       * Ein Klon meldet sich nicht zweimal (Audit event-flow-09): Der
       * Klon-Lauf schickt zum Schluss `server.cloned` – die genauere Meldung,
       * sie nennt die Quelle und ob die Welt mitkam. `server.created` davor
       * wäre für denselben Vorgang die zweite Zeile in der Inbox und, je Regel,
       * der zweite Discord-Post. Der Klon steht in der Liste trotzdem sofort:
       * dafür sorgt `serverClone.progressed`.
       */
      if (server.clonedFromServerId === null) {
        await this.emitServerEvent('server.created', server);
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Unbekannter Fehler.';

      /*
       * Nachsehen, ob doch ein Container entstanden ist (Fundpunkt 289).
       *
       * Der Fall ist das `CREATE`, das in die Frist des Backends lief, während
       * der Agent weiterarbeitete: Der Container entsteht danach trotzdem, und
       * in der Datenbank steht keine Id, mit der ihn später noch jemand
       * entfernen könnte.
       *
       * **Nur dann.** Steht die Id bereits (das `CREATE` kam durch, erst die
       * Weltdaten-Übernahme scheiterte), gehört der Container dem Datensatz -
       * und wird über den regulären Weg entfernt, der die Id danach auch
       * austrägt. Hier auf den Namen zu schiessen hiesse, einen Datensatz mit
       * einer Id auf einen Container zurückzulassen, den es nicht mehr gibt.
       *
       * Auf gut Glück und ohne Folgen: Gibt es keinen, meldet der Agent das,
       * und der Fehlschlag des Anlegens bleibt der Fehlschlag des Anlegens.
       */
      const stand = await this.deps.repository.findById(server.id);
      const session = this.deps.agents.get(server.hostId);

      if (session !== null && (stand === null || stand.dockerContainerId === null)) {
        await this.removeContainerByName(session, server.id);
      }

      await this.transition(server, { type: 'createFailed', reason });
      await this.emitServerEvent('server.failed', server, { detail: reason });

      throw error;
    }
  }

  /** Bauplan des Containers – eine Quelle für Anlegen und Neuaufbau. */
  private containerSpecFor(
    server: ServerRecord,
    definition: GameTypeDefinition,
  ): ContainerCreateSpec {
    return buildContainerSpec({
      server,
      definition,
      /*
       * Die Version des Servers, nicht die der Definition (Pflichtenheft §9,
       * Review 2026-09-16): Ein Server behält sein Image, bis jemand
       * „Aktualisieren" drückt (`updateServerImage`). Ohne gespeicherte Version
       * – neu angelegt oder vor dieser Spalte entstanden – gilt die Definition.
       */
      image: server.imageRef ?? definition.dockerImage,
      containerName: containerNameFor(server.id),
      dataHostPath: dataHostPathFor(server.id),
      // Derselbe Name, den auch der DNS-Eintrag trägt (`provision`) – bei
      // Hostname-Routing ist er das einzige Unterscheidungsmerkmal am Router.
      hostname: this.hostnameFor(server),
      updatesHeld: this.deps.registry.isUpdateHeld(definition.id),
    });
  }

  /**
   * Schickt `DELETE` an den Agent – ein bereits fehlender Container gilt als
   * Erledigung (orchestration-core-03).
   *
   * Das Ziel des Befehls ist „Container weg". Meldet der Agent
   * `AGENT_CONTAINER_NOT_FOUND`, ist genau das der Fall: Der Container wurde
   * zuvor schon entfernt (abgebrochener Neuaufbau, abgebrochenes Löschen, von
   * Hand auf der Node aufgeräumt). Als Fehler behandelt hätte das den Server
   * dauerhaft unstart- **und** unlöschbar gemacht, weil jeder Versuch an
   * derselben toten Id abbrach.
   *
   * Jeder Aufrufer schreibt anschließend `dockerContainerId = null`, damit ein
   * zweiter Anlauf nicht wieder hier landet.
   */
  /**
   * Aufräumversuch über den festen Container-Namen (Fundpunkt 289).
   *
   * Für die Fälle, in denen das Backend keine Container-Id hat, auf der Node
   * aber trotzdem einer stehen kann: ein `CREATE`, das nach der Frist des
   * Backends aufgegeben, vom Agent aber zu Ende gebracht wurde.
   *
   * **Ein Fehlschlag ist hier kein Fehler.** „Gibt es nicht" ist der
   * Regelfall - die allermeisten Server ohne Id haben auch keinen Container.
   * Und ein Löschvorgang darf nicht daran scheitern, dass ein Aufräumversuch
   * auf gut Glück nicht durchkam; der Container taucht dann weiter als
   * verwaister Posten im Abgleich auf, genau wie bisher.
   */
  private async removeContainerByName(session: AgentSession, serverId: string): Promise<void> {
    const name = containerNameFor(serverId);

    try {
      await session.sendCommand('DELETE', serverId, { containerId: name, force: true });

      this.deps.log.info(
        { serverId, containerName: name },
        'Verwaister Container ohne bekannte Id auf der Node entfernt',
      );
    } catch (error: unknown) {
      if (isServerOrchestrationError(error) && error.code === 'AGENT_CONTAINER_NOT_FOUND') {
        return;
      }

      this.deps.log.warn(
        {
          serverId,
          containerName: name,
          error: error instanceof Error ? error.message : String(error),
        },
        'Aufraeumversuch ueber den Container-Namen fehlgeschlagen - das Loeschen laeuft weiter',
      );
    }
  }

  private async removeContainer(
    session: AgentSession,
    serverId: string,
    containerId: string,
  ): Promise<void> {
    try {
      await session.sendCommand('DELETE', serverId, { containerId, force: true });
    } catch (error: unknown) {
      if (!isServerOrchestrationError(error) || error.code !== 'AGENT_CONTAINER_NOT_FOUND') {
        throw error;
      }

      this.deps.log.warn(
        { serverId, containerId },
        'Container war auf der Node bereits entfernt – Löschbefehl gilt als erledigt',
      );
    }
  }

  /**
   * Container neu bauen, wenn er nicht mehr zum heutigen Bauplan passt
   * (WORK_STATUS.md, Punkt 114).
   *
   * Umgebungsvariablen, Image, Ports und Grenzen bekommt ein Container beim
   * Anlegen; `RESTART` startet denselben Container mit denselben Werten. Ohne
   * diesen Schritt wirkte eine geänderte Konfiguration nie, und ein neueres
   * Image blieb ungenutzt – die Oberfläche meldete „Neustart nötig" und
   * „Update verfügbar", und ein Neustart änderte nichts daran.
   *
   * Die Daten des Servers liegen in einem Bind-Mount auf der Node und
   * überleben den Neuaufbau; Ports und DNS-Eintrag bleiben ebenfalls, sie
   * hängen am Server und nicht am Container.
   *
   * `containerSpecHash === null` heißt „vor dieser Spalte angelegt": Diese
   * Container werden einmalig neu gebaut, danach steht der Fingerabdruck.
   *
   * **Zweischrittig und wiederholbar** (orchestration-core-03): Sobald das
   * `DELETE` durch ist, steht in der Datenbank keine Container-Id mehr – noch
   * bevor das `CREATE` losläuft. Scheitert das Anlegen (Registry weg, Image
   * nicht ziehbar, Zeitüberschreitung), gilt der Server als „ohne Container";
   * der nächste Start schickt direkt `CREATE` statt erneut ein `DELETE` auf
   * eine tote Id, an dem er früher dauerhaft hängenblieb.
   */
  private async ensureContainerCurrent(
    server: ServerRecord,
    definition: GameTypeDefinition,
  ): Promise<ServerRecord> {
    const spec = this.containerSpecFor(server, definition);
    const fingerabdruck = containerSpecFingerprint(spec);

    if (server.dockerContainerId !== null && server.containerSpecHash === fingerabdruck) {
      return server;
    }

    const session = this.deps.agents.require(server.hostId);

    if (server.dockerContainerId !== null) {
      await this.removeContainer(session, server.id, server.dockerContainerId);

      // Erst die Id löschen, dann neu anlegen: Bricht das `CREATE` ab, zeigt
      // der Datensatz den Ist-Zustand auf der Node („kein Container") und der
      // nächste Versuch beginnt an der richtigen Stelle.
      await this.deps.repository.update(server.id, {
        dockerContainerId: null,
        containerSpecHash: null,
      });
    }

    const created = await session.sendCommand('CREATE', server.id, spec, {
      timeoutMs: this.deps.config.createTimeoutMs,
    });

    await this.deps.repository.update(server.id, {
      dockerContainerId: created.containerId,
      imageRef: spec.image,
      containerSpecHash: fingerabdruck,
      // Der Grund für den Hinweis ist damit erledigt.
      restartRequired: false,
    });

    return this.requireServer(server.id);
  }

  // -------------------------------------------------------------------------
  // Lifecycle-Befehle
  // -------------------------------------------------------------------------

  /**
   * Startet einen Server.
   *
   * Der Rückgabewert kommt, sobald der Startbefehl abgesetzt ist – der Server
   * steht dann auf `starting`. Der Übergang nach `running` passiert erst nach
   * bestandenem Health-Check und wird über `server.statusChanged` gemeldet
   * (Pflichtenheft §9).
   *
   * `anlass` reicht bis zum Ende des Health-Checks durch und entscheidet dort,
   * ob `server.started` oder `server.restarted` gemeldet wird (Audit
   * event-flow-09).
   *
   * `erzwingen` beantwortet die Rückfrage der Kapazitätsprüfung mit „ja, ich
   * weiß" (`RESOURCE_CONFIRMATION_REQUIRED`). Es übergeht ausschließlich die
   * Enge der Node – ein erschöpftes Nutzer-Kontingent lehnt weiterhin ab.
   */
  async startServer(
    serverId: string,
    actorUserId: string,
    anlass: StartIntent = 'start',
    optionen: { readonly erzwingen?: boolean } = {},
  ): Promise<ServerRecord> {
    const geladen = await this.requireServer(serverId);

    assertTransitionAllowed(geladen.status, 'starting');

    const definition = this.deps.registry.require(geladen.gameType);

    // Kein Start in eine Adresse, hinter der nichts steht (Pflichtenheft §19).
    this.requireHostnameRouterConfigured(definition, geladen.id);

    // Verfügbarkeit der Ziel-Node vor der Kapazitätsprüfung: Eine Node in
    // `maintenance` hat volle freie Kapazität und käme durch die Rechnung aus
    // B4 anstandslos durch (WORK_STATUS.md, Gefundener Punkt 24).
    await this.requireNodeAcceptsStarts(geladen.hostId);

    /*
     * Vor dem Start: Passt der Container noch zum heutigen Bauplan? Geänderte
     * Konfiguration und ein neueres Image wirken erst nach einem Neuaufbau
     * (Punkt 114). Bewusst hier und nicht im Neustart: Auch ein Start aus dem
     * gestoppten Zustand soll die Änderung mitnehmen.
     */
    const server = await this.ensureContainerCurrent(geladen, definition);

    // Vor der Reservierung, damit ein fehlender Container ohne offene
    // Transaktion scheitert.
    const containerId = this.requireContainerId(server);
    const session = this.deps.agents.require(server.hostId);

    // Kapazitätsprüfung und Wechsel auf `starting` als eine serialisierte
    // Einheit: Sonst bestünden zwei gleichzeitige Starts beide die Prüfung, ehe
    // einer die Belegung schreibt, und überbuchten die Node (TOCTOU,
    // WORK_STATUS.md Punkt 98, Pflichtenheft §10). Der Agent-Befehl und der
    // Health-Check laufen bewusst **außerhalb** der Sperre.
    /*
     * Geprüft wird das Kontingent des **Besitzers**, nicht des Handelnden
     * (Audit 2026-09-10, Fundpunkt 199).
     *
     * Vorher stand hier `actorUserId`. Wer klickt, ist aber nicht, wem die
     * Ressourcen zugerechnet werden: Ein Konto am Limit liess seinen Server
     * von einem Mitverwalter der Stufe „Bedienen" starten und lief dauerhaft
     * darüber – in der eigenen Kontingent-Anzeige tauchte der laufende Server
     * anschliessend sehr wohl auf. Umgekehrt konnte ein Verwalter mit engem
     * eigenem Kontingent fremde Server nicht mehr starten.
     *
     * Das Anlegen rechnete von Anfang an gegen den Besitzer
     * (`beginCreateServer`), und der Zeitplan-Ausführer reicht ebenfalls
     * `server.ownerId` durch (`schedules.ts:199`) – der Startpfad war die
     * einzige Abweichung.
     *
     * `actorUserId` bleibt in der Signatur: Er benennt den Auslöser, den der
     * Aufrufer aus der Sitzung mitgibt, und trägt bis in den Neustart durch.
     * Für die Kapazität ist er ohne Bedeutung.
     */
    void actorUserId;

    const reserviert = await this.reservation.reserve(
      {
        userId: server.ownerId,
        hostId: server.hostId,
        serverId: server.id,
        requested: {
          ...server.resourceLimits,
          diskMb: this.deps.registry.require(server.gameType).resourceDefaults.diskMb,
        },
        intent: 'start',
        ...(optionen.erzwingen === true ? { force: true } : {}),
      },
      (scope) => this.applyTransition(server, { type: 'startRequested' }, scope.servers),
    );

    /*
     * Erst jetzt melden: Innerhalb des Callbacks ist die Transaktion noch offen
     * (Audit event-flow-11). Ein dort abgesetztes `server.statusChanged` hätte
     * `starting` verkündet, während ein Abbruch beim Commit den Server auf
     * `stopped` zurückfallen lässt – und kein weiteres Frame korrigiert das.
     */
    reserviert.publish();

    const started = reserviert.result.state;

    await this.finishStart(server, started, session, containerId, anlass);

    return this.requireServer(serverId);
  }

  /**
   * Gruppen-Chat des Servers anlegen (Gefundener Punkt 70).
   *
   * Bisher entstand er beim ersten Öffnen. Fachlich dasselbe, aber in der
   * Übersicht fehlte er, bis ihn jemand aufgerufen hatte – ein Server ohne
   * Chat, den es eigentlich gibt.
   *
   * **Scheitert leise.** Der Chat ist Beiwerk zum Server, nicht Teil seines
   * Anlegens: Ein Server, der wegen eines fehlenden Chats als gescheitert
   * gälte, wäre die schlechtere Antwort. Gemeldet wird der Fehlschlag
   * trotzdem – sonst sucht später niemand den fehlenden Chat.
   */
  private async ensureServerChat(serverId: string): Promise<void> {
    if (this.deps.ensureServerChat === undefined) {
      return;
    }

    try {
      await this.deps.ensureServerChat(serverId);
    } catch (error: unknown) {
      this.deps.log.warn(
        { serverId, error: error instanceof Error ? error.message : String(error) },
        'Gruppen-Chat des Servers konnte nicht angelegt werden',
      );
    }
  }

  /**
   * Nimmt die Ziel-Node gerade neue Arbeit an? (`HostNode.status`,
   * Pflichtenheft §6 und §9, WORK_STATUS.md Gefundene Punkte 24 und 109.)
   *
   * Nur `online` nimmt an – beim Anlegen wie beim Starten. `maintenance` ist
   * eine bewusst stillgelegte Node: Sie hat volle freie Kapazität und würde die
   * Prüfung aus B4 (§10) deshalb immer bestehen; das ist eine
   * Verfügbarkeitsfrage des Lifecycles und keine Ressourcenrechnung. `offline`
   * fängt in der Praxis schon `agents.require()` ab, wird hier aber mit
   * abgedeckt, damit die Antwort nicht von der Reihenfolge der Prüfungen
   * abhängt.
   *
   * Bewusst **nicht** im automatischen Neustart nach einem Absturz
   * (`dispatchStart`): Dort geht es nicht darum, eine stillgelegte Node neu zu
   * belegen, sondern einen bereits dort laufenden Server wieder hochzubringen.
   */
  private assertNodeAcceptsWork(
    host: Pick<HostNodeRecord, 'id' | 'name' | 'status'>,
    intent: 'create' | 'start',
  ): void {
    if (host.status === 'online') {
      return;
    }

    throw new ServerOrchestrationError(
      'NODE_UNAVAILABLE',
      host.status === 'maintenance'
        ? `„${host.name}" ist gerade in Wartung und nimmt ${
            intent === 'start' ? 'keine Serverstarts' : 'keine neuen Server'
          } an.`
        : `„${host.name}" ist gerade nicht erreichbar.`,
      { hostId: host.id, nodeStatus: host.status },
    );
  }

  private async requireNodeAcceptsStarts(hostId: string): Promise<void> {
    const host = await this.deps.repository.findHost(hostId);

    if (!host) {
      throw new ServerOrchestrationError('NODE_NOT_FOUND', undefined, { hostId });
    }

    this.assertNodeAcceptsWork(host, 'start');
  }

  /**
   * Kein Start, solange der Hostname-Router fehlt (Pflichtenheft §19).
   *
   * Ein Spiel mit `supportsVirtualHostRouting` bekommt **keinen** eigenen
   * öffentlichen Port: Alle Instanzen teilen sich einen einzigen, und
   * auseinandergehalten werden sie allein über den Hostnamen, den ein
   * Reverse-Proxy (Infrared) auf die richtige Instanz verteilt
   * (Pflichtenheft §2.4, §13). Fehlt dieser Dienst, zeigt die Adresse ins
   * Leere – der Container läuft, das Panel meldet Erfolg, und der Spieler
   * kommt trotzdem nicht rein. Genau das soll hier auffallen, und zwar dem
   * Betreiber und mit dem Weg heraus.
   *
   * **Beim Starten, nicht beim Anlegen.** Ein angelegter Server ohne Router
   * richtet keinen Schaden an; der Betreiber kann den Router nachliefern, und
   * der Server läuft dann ohne Zutun. Ein Anlege-Verbot nähme ihm diese
   * Vorbereitung.
   *
   * **Woran die Sperre hängt:** an `GAME_ROUTER_HOSTNAME`
   * (`config.routerHostname`) – demselben Wert, aus dem
   * {@link buildServerDnsRecord} den `CNAME` baut. Ist er gesetzt, gibt es ein
   * Ziel und die Sperre entfällt von selbst. Ein fest verdrahtetes `false`
   * müsste beim Ausrollen des Routers erst wieder gesucht werden.
   */
  private requireHostnameRouterConfigured(definition: GameTypeDefinition, serverId: string): void {
    if (!definition.supportsVirtualHostRouting || this.deps.config.routerHostname !== null) {
      return;
    }

    throw new ServerOrchestrationError(
      'GAME_TYPE_NOT_AVAILABLE',
      `„${definition.name}" wird über den Hostname-Router erreicht: Alle Server dieses Spiel-Typs teilen sich einen öffentlichen Port und werden nur über ihren Hostnamen unterschieden. In dieser Installation ist kein Router eingetragen – GAME_ROUTER_HOSTNAME ist leer –, deshalb würde dieser Server zwar laufen, aber für niemanden erreichbar sein. Abhilfe: den Router in Betrieb nehmen und seinen Hostnamen auf der VPS in /opt/palantir/.env als GAME_ROUTER_HOSTNAME eintragen, dann das Backend neu starten.`,
      { serverId, gameType: definition.id },
    );
  }

  /**
   * Setzt den Server auf `starting`, schickt `START` und wartet danach im
   * Hintergrund auf den Health-Check.
   *
   * Der Weg für den automatischen Neustart nach einem Absturz: Er läuft
   * **ohne** Kapazitätsreservierung, weil der Server bereits angelegt und in der
   * Belegung berücksichtigt ist. Der reguläre Start (`startServer`) reserviert
   * dagegen zuerst.
   */
  private async dispatchStart(
    server: ServerRecord,
    event: ServerLifecycleEvent & { type: 'startRequested' | 'automaticRestartRequested' },
  ): Promise<void> {
    const containerId = this.requireContainerId(server);
    const session = this.deps.agents.require(server.hostId);

    const started = await this.transition(server, event);

    await this.finishStart(server, started, session, containerId);
  }

  /**
   * Schickt `START` an den Agent und stößt den Health-Check an – der Teil des
   * Starts, der **nach** dem Zustandswechsel kommt und ohne Kapazitätssperre
   * läuft (der Agent-Befehl ist ein Netz-Roundtrip, der keine Sperre halten soll).
   */
  /**
   * Die Grenzen des Containers auf den Stand des Datensatzes bringen.
   *
   * **Was vorher passierte.** Eine geänderte Zuweisung landete nur in der
   * Datenbank. Der laufende Container behielt seine Grenze – und `restartRequired`
   * wurde dafür nicht gesetzt, die Oberfläche sagte also nicht einmal, dass
   * etwas offen ist. Wirksam wurde die Änderung erst beim nächsten Start, und
   * zwar auf dem teuersten Weg: `resources` steckt im Fingerabdruck des
   * Bauplans, `ensureContainerCurrent` sah einen veralteten Container und baute
   * ihn samt `DELETE`/`CREATE` neu.
   *
   * **Was jetzt passiert.** Die Container-Engine kann beide Grenzen im
   * laufenden Betrieb setzen. Gelingt das, ist der Container auf dem neuen
   * Stand – und damit **nicht mehr veraltet**: Der Fingerabdruck wird
   * mitgeschrieben, sonst bliebe der überflüssige Neuaufbau beim nächsten Start
   * stehen, obwohl die Grenzen längst stimmen.
   *
   * Der Fingerabdruck wird nur dann übernommen, wenn die Grenzen die **einzige**
   * Abweichung sind. Geprüft wird das, indem derselbe Bauplan ein zweites Mal
   * mit den **alten** Grenzen gebaut wird: Trifft er den gespeicherten
   * Fingerabdruck, hat sich sonst nichts geändert. Steckt noch eine geänderte
   * Konfiguration darin, bleibt der Container veraltet und wird beim nächsten
   * Start neu gebaut – Umgebungsvariablen bekommt er nur beim Anlegen.
   *
   * **Scheitert bewusst leise**, dieselbe Abwägung wie bei
   * {@link applyServerQuery}: Weder das Speichern noch ein Start soll daran
   * scheitern, dass der Zusatzbefehl nicht ankommt. Der Fingerabdruck bleibt
   * dann stehen, und der Neuaufbau beim nächsten Start ist das Netz darunter.
   */
  private async applyResourceLimits(
    server: ServerRecord,
    /** Grenzen vor der Änderung; ohne Angabe wird der Fingerabdruck nie übernommen. */
    vorher?: ServerResourceLimits,
  ): Promise<void> {
    const containerId = server.dockerContainerId;

    if (containerId === null) {
      // Noch kein Container – die Grenzen kommen mit `CREATE`.
      return;
    }

    const session = this.deps.agents.get(server.hostId);

    if (session === null) {
      return;
    }

    try {
      await session.sendCommand('UPDATE_RESOURCES', server.id, {
        containerId,
        resources: { memoryMb: server.resourceLimits.ramMb },
      });
    } catch (error: unknown) {
      this.deps.log.warn(
        {
          serverId: server.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Ressourcengrenzen konnten nicht am Container gesetzt werden',
      );

      return;
    }

    if (vorher === undefined) {
      return;
    }

    const definition = this.deps.registry.require(server.gameType);
    const altHash = containerSpecFingerprint(
      this.containerSpecFor({ ...server, resourceLimits: vorher }, definition),
    );

    if (altHash !== server.containerSpecHash) {
      // Es hat sich mehr geändert als die Grenzen – der Neuaufbau beim nächsten
      // Start bleibt nötig.
      return;
    }

    await this.deps.repository.update(server.id, {
      containerSpecHash: containerSpecFingerprint(this.containerSpecFor(server, definition)),
    });
  }

  /**
   * Abfragen einer Node abgleichen – siehe `server-query.ts` (Befund 2.1).
   * Öffentlich für den Verbindungsaufbau des Agents (`index.ts`).
   */
  refreshServerQueries(hostId: string): Promise<readonly string[]> {
    return this.queries.refreshServerQueries(hostId);
  }

  private async finishStart(
    server: ServerRecord,
    started: ServerLifecycleState,
    session: AgentSession,
    containerId: string,
    anlass: StartIntent = 'start',
  ): Promise<void> {
    /*
     * Die Grenzen vor dem Start noch einmal setzen – als Netz, nicht als
     * Hauptweg.
     *
     * Der Hauptweg ist `ensureContainerCurrent`: Blieb der Fingerabdruck
     * stehen, weil der Befehl beim Speichern nicht ankam, ist der Container
     * veraltet und wird ohnehin neu gebaut – mit den richtigen Grenzen. Was
     * dieser Aufruf zusätzlich abdeckt, ist der Fall, in dem der Fingerabdruck
     * stimmt, die Grenzen am Container aber nicht: ein von Hand veränderter
     * Container, eine halb durchgelaufene Änderung. Idempotent und ein Befehl,
     * also billiger als die Möglichkeit, mit einer falschen Grenze zu starten.
     */
    await this.applyResourceLimits({ ...server, ...started, dockerContainerId: containerId });

    try {
      await session.sendCommand('START', server.id, { containerId });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Der Start ist fehlgeschlagen.';

      await this.transition({ ...server, ...started }, { type: 'failed', reason });
      await this.emitServerEvent('server.failed', server, { detail: reason });

      throw error;
    }

    // Periodische Abfrage einsetzen (Gefundener Punkt 74). Ohne sie meldet der
    // Agent nie ein `STATS_UPDATE` aus der Server-Abfrage, und Spielerzahl,
    // Antwortzeit und der Spieler-Verlauf bleiben dauerhaft leer.
    await this.queries.applyServerQuery({ ...server, ...started }, true);

    // Der Health-Check läuft bewusst neben dem Request: Ein Spiel darf beim
    // Hochlauf Minuten brauchen, so lange soll niemand auf eine HTTP-Antwort
    // warten. Der Zustandswechsel wird über `server.statusChanged` gemeldet.
    fireAndForget(this.awaitStartupHealth(server.id, anlass), this.deps.log, {
      vorgang: 'Health-Check nach dem Start',
      serverId: server.id,
    });
  }

  /**
   * Health-Check nach dem Start – siehe `startup-health.ts` (Befund 2.1).
   * Öffentlich, damit der Soll/Ist-Abgleich denselben Weg nimmt und nicht eine
   * zweite Auslegung von „läuft" mitbringt.
   */
  awaitStartupHealth(serverId: string, anlass: StartIntent = 'start'): Promise<void> {
    return this.startupHealth.awaitStartupHealth(serverId, anlass);
  }

  /**
   * Stoppt einen Server.
   *
   * `anlass` sagt, **warum** gestoppt wird, und entscheidet damit über die
   * Meldung (Audit event-flow-09): Nur ein Stopp, den jemand ausdrücklich
   * angefordert hat, ist für sich genommen eine Nachricht wert. Der Stopp
   * innerhalb eines Neustarts und der Stopp durch den Auto-Shutdown haben ihre
   * eigene, aussagekräftigere Meldung – `server.restarted` bzw.
   * `autoShutdown.triggered`. Ohne diese Unterscheidung bekam der Besitzer für
   * einen einzigen Vorgang zwei bis drei Meldungen in die Inbox und, je Regel,
   * ebenso viele Discord-Nachrichten.
   *
   * Der Zustandswechsel selbst ist in allen Fällen derselbe: `server.statusChanged`
   * geht unverändert an den Live-Kanal, die Oberfläche verpasst also nichts.
   */
  async stopServer(serverId: string, anlass: StopReason = 'manual'): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);

    assertTransitionAllowed(server.status, 'stopping');

    // Container und Agent vorab prüfen: Ein Server ohne Container oder auf einer
    // getrennten Node soll gar nicht erst auf `stopping` wechseln – sonst bliebe
    // er in einem Zwischenzustand stehen, aus dem nur der Abgleich ihn holt.
    this.requireContainerId(server);
    this.deps.agents.require(server.hostId);

    const stopping = await this.transition(server, { type: 'stopRequested' });

    await this.dispatchStop({ ...server, ...stopping }, anlass);

    return this.requireServer(serverId);
  }

  /**
   * Schickt `STOP` an den Agent und schließt den Stopp ab.
   *
   * Erwartet einen Server, der **bereits** auf `stopping` steht – der Übergang
   * dorthin gehört dem Aufrufer. Ausgelagert, weil der Soll/Ist-Abgleich
   * denselben Weg nimmt: Ist der `STOP`-Befehl mit der Verbindung verloren
   * gegangen, wird er erneut geschickt, statt einen Zustandswechsel zu planen,
   * den die Tabelle verbietet (Audit orchestration-core-04). Der Abgleich holt
   * einen liegen gebliebenen Stopp nach und meldet ihn deshalb als eigenen
   * Vorgang – Vorgabe `'manual'`.
   *
   * Die periodische Abfrage schaltet hier niemand mehr eigens ab: Das erledigt
   * der Wechsel auf `stopping` in {@link transitionFull} – also **vor** dem
   * `STOP`-Befehl und damit früher als zuvor (Audit event-flow-10). Nimmt der
   * Abgleich diesen Weg ohne Zustandswechsel (`retryStop` nach einem
   * Backend-Neustart), räumt {@link refreshServerQueries} beim
   * Verbindungsaufbau des Agents auf.
   */
  private async dispatchStop(server: ServerRecord, anlass: StopReason = 'manual'): Promise<void> {
    const containerId = this.requireContainerId(server);
    const session = this.deps.agents.require(server.hostId);
    const nutzlast = this.stoppNutzlast(server, containerId);

    try {
      await session.sendCommand('STOP', server.id, nutzlast.payload, {
        timeoutMs: nutzlast.fristMs,
      });
      await this.transition(server, { type: 'stopSucceeded' });

      if (anlass === 'manual') {
        await this.emitServerEvent('server.stopped', server.id);
      }
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Das Stoppen ist fehlgeschlagen.';

      await this.transition(server, { type: 'stopFailed', reason });
      await this.emitServerEvent('server.failed', server.id, { detail: reason });

      throw error;
    }
  }

  /**
   * Baut die Nutzlast für `STOP` – und die Frist, in der sie beantwortet sein
   * muss.
   *
   * **Der Stopp-Befehl** (`GameTypeDefinition.stopCommand`) geht mit, wenn das
   * Spiel einen nennt und eine Konsole hat: Der Agent schickt ihn, wartet auf
   * das Ende des Containers und greift erst danach zum Signal. Spiele, deren
   * Startskript das Signal selbst abfängt (Terraria, Project Zomboid, Vintage
   * Story), nennen keinen – sonst käme der Befehl zweimal.
   *
   * **Die Frist war das eigentliche Versäumnis.** Ein Befehl muss binnen
   * dreißig Sekunden beantwortet sein (Vorgabe des Gateways), ein Container
   * darf sich aber bis zu seiner Kulanzzeit Zeit lassen – bei ARK drei Minuten.
   * Ein Stopp, der länger brauchte, lief in die Frist und wurde als
   * fehlgeschlagen gemeldet, obwohl er gerade lief. Die Frist richtet sich
   * deshalb nach dem, was der Stopp tatsächlich dauern darf: Kulanzzeit, bei
   * einem Stopp-Befehl zweimal (einmal fürs Warten, einmal fürs Signal), plus
   * Luft für den Weg hin und zurück.
   */
  private stoppNutzlast(
    server: ServerRecord,
    containerId: string,
  ): { payload: StopCommandPayload; fristMs: number } {
    const definition = this.deps.registry.require(server.gameType);
    const konsole = definition.console;
    const argv =
      definition.stopCommand
        ?.trim()
        .split(/\s+/)
        .filter((teil) => teil.length > 0) ?? [];
    // Ohne Konsole gibt es keinen Weg für den Befehl – dann bleibt es beim
    // Signal, auch wenn die Definition einen nennt.
    const mitBefehl = argv.length > 0 && konsole !== undefined && konsole.kind !== 'none';
    const rcon =
      konsole?.kind === 'rcon'
        ? { port: konsole.port, passwordFile: konsole.passwordFile }
        : undefined;

    // Ohne eigene Angabe gilt, was die Container-Engine vorgibt: zehn Sekunden.
    const kulanzSekunden = definition.stopTimeoutSeconds ?? 10;

    return {
      payload: {
        containerId,
        ...(definition.stopTimeoutSeconds === undefined
          ? {}
          : { timeoutSeconds: definition.stopTimeoutSeconds }),
        ...(mitBefehl ? { stopCommand: argv } : {}),
        ...(mitBefehl && rcon !== undefined ? { rcon } : {}),
      },
      fristMs: kulanzSekunden * (mitBefehl ? 2 : 1) * 1_000 + STOPP_ZUSCHLAG_MS,
    };
  }

  /**
   * Startet einen Server neu.
   *
   * Bewusst als Stopp + Start und nicht als `RESTART`-Befehl an den Agent: Nur
   * so läuft der Neustart durch dieselbe Kette wie ein regulärer Start – mit
   * Ressourcenprüfung und, vor allem, mit Health-Check. Ein `RESTART` am
   * Lifecycle vorbei würde einen Server als „läuft" zurücklassen, ohne dass je
   * geprüft wurde, ob er antwortet (Pflichtenheft §9).
   *
   * **Genau eine Meldung, und zwar die richtige** (Audit event-flow-09): Der
   * Rückgabewert kommt, sobald der Startbefehl abgesetzt ist – der Health-Check
   * läuft dann noch. `server.restarted` sagt laut Vertrag „der Server ist wieder
   * erreichbar"; bisher ging es genau hier hinaus, also bevor irgendjemand das
   * geprüft hatte, und es blieb auch dann stehen, wenn der Start eine Minute
   * später mit `server.failed` endete. Gemeldet wird deshalb erst am Ende des
   * Health-Checks – dort ersetzt es das `server.started` des gewöhnlichen
   * Starts. Der Stopp davor meldet nichts (siehe {@link stopServer}), sodass
   * aus drei Meldungen eine wird.
   */
  async restartServer(
    serverId: string,
    actorUserId: string,
    optionen: { readonly erzwingen?: boolean } = {},
  ): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);
    const lief = server.status === 'running' || server.status === 'starting';

    if (lief) {
      await this.stopServer(serverId, 'restart');
    }

    /*
     * Ein laufender Server bringt beim Neustart keine neue Last auf die Node:
     * Er gibt zurück, was er sich gleich wieder nimmt. Die Rückfrage „die Node
     * ist eng, trotzdem starten?" wäre hier eine Frage zu einer Belegung, die
     * sich gar nicht ändert – und sie träfe die geplanten Neustarts
     * (`schedules.ts`) als Abbruch, den niemand beantworten kann. Ein Neustart
     * eines **gestoppten** Servers fügt sehr wohl Last hinzu und wird gefragt.
     */
    return this.startServer(serverId, actorUserId, 'restart', {
      erzwingen: optionen.erzwingen === true || lief,
    });
  }

  /**
   * Übernimmt die neue Version des Spiel-Images (Pflichtenheft §9, Review
   * 2026-09-16, Befund 2.9).
   *
   * Ein Server behält seine Version (`imageRef`) über Starts und Neustarts
   * hinweg – `containerSpecFor` baut den Container immer mit der gespeicherten
   * Version. Erst dieser Aufruf schreibt die Version der Definition an den
   * Server; danach weicht der Fingerabdruck ab, und `ensureContainerCurrent`
   * baut den Container neu. Am laufenden Server geschieht das als Stopp +
   * Start, am gestoppten nur als Neuaufbau ohne Start – ein „Aktualisieren",
   * das nebenbei hochfährt, wäre eine Überraschung.
   *
   * Der Weltstand liegt im Datenvolume (`dataHostPath`), das jeder Neuaufbau
   * unverändert wieder einhängt; das Image trägt nur Laufzeit und Serverdateien.
   *
   * Idempotent: Trägt der Server die Version schon, passiert nichts.
   */
  async updateServerImage(
    serverId: string,
    actorUserId: string,
  ): Promise<{
    readonly server: ServerRecord;
    readonly previousImage: string | null;
    readonly image: string;
    readonly restarted: boolean;
  }> {
    const server = await this.requireServer(serverId);
    const definition = this.deps.registry.require(server.gameType);
    const ziel = definition.dockerImage;

    if (server.imageRef === ziel) {
      return { server, previousImage: server.imageRef, image: ziel, restarted: false };
    }

    const lief = server.status === 'running' || server.status === 'starting';

    if (!lief) {
      // Nur `stopped`, `error` und `crashed` lassen einen Neuaufbau zu; ein
      // Server mitten im Anlegen oder Stoppen wechselt seine Version nicht.
      if (server.status !== 'stopped' && server.status !== 'error' && server.status !== 'crashed') {
        throw new ServerOrchestrationError('SERVER_STATE_CONFLICT', undefined, {
          serverId,
          status: server.status,
        });
      }
    }

    // Erst die Version schreiben: Danach passt der Fingerabdruck nicht mehr,
    // und der nächste Neuaufbau nimmt genau dieses Image.
    await this.deps.repository.update(serverId, { imageRef: ziel });

    if (lief) {
      const neu = await this.restartServer(serverId, actorUserId, { erzwingen: true });

      return { server: neu, previousImage: server.imageRef, image: ziel, restarted: true };
    }

    const neu = await this.ensureContainerCurrent(await this.requireServer(serverId), definition);

    return { server: neu, previousImage: server.imageRef, image: ziel, restarted: false };
  }

  /**
   * Löscht einen Server samt Container, DNS-Eintrag und Portzuweisung.
   *
   * Der Container wird zuerst entfernt, der Datensatz zuletzt: Bricht es
   * dazwischen ab, bleibt ein Server ohne Container übrig – den kann man erneut
   * löschen. Andersherum bliebe ein Container ohne Server übrig, den niemand
   * mehr zuordnen kann (der Soll/Ist-Abgleich meldet ihn dann als verwaist).
   *
   * **`erzwingen`** (Fundpunkt 226): Ohne verbundenen Agent ließ sich ein
   * Server bisher **nie** löschen – `AGENT_NOT_CONNECTED`, und zwar dauerhaft.
   * Eine ausgemusterte Node hinterließ damit Server, die niemand mehr
   * loswurde, samt belegter Subdomain und belegtem Port. Mit `erzwingen` fällt
   * nur der Container-Befehl aus; DNS-Eintrag, Portfreigabe und Datensatz
   * verschwinden wie sonst auch.
   *
   * Der Container bleibt dann auf der Node liegen. Das ist die kleinere
   * Hypothek: Kommt die Node je zurück, meldet der Soll/Ist-Abgleich ihn als
   * verwaist, und die Speicherverwaltung räumt ihn weg. Ein unlöschbarer
   * Server dagegen blockiert dauerhaft Adresse und Port.
   *
   * `erzwingen` ist **kein** „Aufräumen überspringen": Ist der Agent erreichbar,
   * läuft der gewöhnliche Weg – geprüft wird die Verbindung, nicht der Wunsch.
   */
  /**
   * Besitzer eines Servers wechseln (Lastenheft §3.7, Pflichtenheft §7).
   *
   * Ein Verwaltungsvorgang (`server.manage.any`, geprüft in der Route), kein
   * Recht des Besitzers. Das Zielkonto muss freigeschaltet und nicht gesperrt
   * sein – dieselbe Regel wie beim Anlegen eines Servers; ein Konto, das das
   * Panel gar nicht benutzen darf, soll keinen Server tragen. Der Owner der
   * Instanz kann übernehmen wie jedes andere freigeschaltete Konto.
   *
   * Meldet danach `server.ownerTransferred` auf dem Listen-Thema: Der Server
   * bleibt, verschwindet aber aus der Übersicht des alten und erscheint in der
   * des neuen Besitzers. Der alte Besitzer steht dafür in der Nutzlast neben
   * den Mitgliedern – er ist keines mehr, soll die Änderung aber sehen.
   */
  async transferOwnership(
    serverId: string,
    newOwnerId: string,
  ): Promise<{
    readonly server: ServerRecord;
    readonly previousOwnerId: string;
    readonly previousOwnerDisplayName: string | null;
    readonly newOwnerDisplayName: string;
  }> {
    const server = await this.requireServer(serverId);

    if (server.ownerId === newOwnerId) {
      throw new ServerOrchestrationError(
        'TRANSFER_TARGET_INVALID',
        'Dieses Konto besitzt den Server bereits.',
        { serverId, newOwnerId },
      );
    }

    const candidate = await this.deps.repository.findTransferCandidate(newOwnerId);

    if (candidate === null) {
      throw new ServerOrchestrationError('USER_NOT_FOUND', undefined, { userId: newOwnerId });
    }

    if (
      candidate.banned ||
      isAwaitingApproval({
        isOwner: candidate.isOwner,
        hasNonGuestRole: hasNonGuestRole(candidate.roleNames.map((name) => ({ name }))),
      })
    ) {
      throw new ServerOrchestrationError('TRANSFER_TARGET_INVALID', undefined, {
        serverId,
        newOwnerId,
        banned: candidate.banned,
      });
    }

    await this.deps.repository.transferOwner(serverId, newOwnerId);

    const updated = await this.requireServer(serverId);
    const members = await this.deps.repository.listMembers(serverId);

    this.deps.events.emit('server.ownerTransferred', {
      serverId,
      serverName: updated.name,
      ownerId: newOwnerId,
      // Der alte Besitzer ist kein Mitglied mehr, soll den Wechsel aber sehen;
      // der Hub adressiert Besitzer, Mitglieder und `server.view.any`.
      memberUserIds: [...members.map((member) => member.userId), server.ownerId],
      detail: null,
    });

    return {
      server: updated,
      previousOwnerId: server.ownerId,
      previousOwnerDisplayName: server.ownerDisplayName,
      newOwnerDisplayName: candidate.displayName,
    };
  }

  async deleteServer(serverId: string, optionen: { erzwingen?: boolean } = {}): Promise<void> {
    const server = await this.requireServer(serverId);

    /*
     * Kein Löschen mitten im Startvorgang (Fundpunkt 127): Der Health-Check
     * läuft noch im Hintergrund und will gleich einen Datensatz fortschreiben,
     * den es dann nicht mehr gäbe. Der Zustand ist kurzlebig – der Aufrufer
     * wiederholt, sobald er durch ist (409, `SERVER_STATE_CONFLICT`), oder
     * stoppt den Server zuerst.
     *
     * `stopping` wird bewusst NICHT gesperrt: Ein Server kann nach einem
     * Backend-Neustart dauerhaft in `stopping` hängen (orchestration-core-04,
     * Abgleich plant einen unerlaubten Übergang) – Löschen ist dann der einzige
     * Ausweg über die API. Der `STOP`-Befehl selbst läuft synchron innerhalb
     * der Anfrage; ein paralleles Löschen hinterlässt keinen Hintergrundlauf.
     */
    if (server.status === 'starting' || server.status === 'creating') {
      // `creating` aus demselben Grund (Fundpunkt 185): Seit das Anlegen im
      // Hintergrund läuft, will `provision()` gleich Container-Id und Zustand
      // in einen Datensatz schreiben, den es dann nicht mehr gäbe.
      throw new ServerOrchestrationError(
        'SERVER_STATE_CONFLICT',
        server.status === 'creating'
          ? 'Der Server wird gerade angelegt und kann erst danach gelöscht werden.'
          : 'Der Server ist gerade im Startvorgang und kann erst danach gelöscht werden.',
        { serverId, status: server.status },
      );
    }

    const session = this.deps.agents.get(server.hostId);

    if (server.dockerContainerId !== null && session !== null) {
      // Erst die Abfrage einstellen, dann den Container entfernen: Sonst fragt
      // der Agent weiter einen Port ab, hinter dem nichts mehr steht
      // (Gefundener Punkt 74).
      await this.queries.applyServerQuery(server, false);
      await this.removeContainer(session, server.id, server.dockerContainerId);

      // Id sofort löschen (orchestration-core-03): Bricht ein späterer Schritt
      // der Kette ab – DNS-Eintrag, Portfreigabe –, beginnt der
      // Wiederholungsversuch hinter dem bereits entfernten Container und nicht
      // erneut davor.
      await this.deps.repository.update(server.id, { dockerContainerId: null });
    } else if (server.dockerContainerId === null && session !== null) {
      /*
       * **Auch ohne bekannte Container-Id nachsehen** (Fundpunkt 289).
       *
       * Eine leere `dockerContainerId` hiess bisher „es gibt keinen Container".
       * Das stimmt nicht immer: Gibt das Backend ein `CREATE` nach seiner Frist
       * auf (`AGENT_CREATE_TIMEOUT_MS`, bei den Proton-Images eine
       * Viertelstunde), arbeitet der Agent weiter - er zieht ja gerade
       * mehrere Gigabyte - und legt den Container danach trotzdem an. Die Id
       * erreicht die Datenbank nie. Wird der Server dann geloescht, bleibt der
       * Container auf der Node stehen, und der Abgleich meldet ihn bei jeder
       * Verbindung als verwaist, ohne dass ihn noch irgendetwas entfernen
       * koennte: Der Datensatz mit seiner Id ist weg.
       *
       * Am 13.09.2026 auf der VPS gefunden - zwei ACC-Testserver vom 11.09.,
       * beide im Panel geloescht, beide auf der Node noch da.
       *
       * Adressiert wird ueber den Namen statt ueber die Id: Der steht fest
       * (`containerNameFor`), Docker nimmt ihn an derselben Stelle an, und er
       * kann keinen fremden Server treffen - er leitet sich aus der Id genau
       * dieses Servers ab.
       */
      await this.removeContainerByName(session, server.id);
    } else if (server.dockerContainerId !== null && optionen.erzwingen !== true) {
      throw new ServerOrchestrationError(
        'AGENT_NOT_CONNECTED',
        'Die Node ist nicht verbunden, der Container lässt sich deshalb nicht entfernen. ' +
          'Der Server kann trotzdem gelöscht werden – der Container bleibt dann auf der Node ' +
          'liegen und taucht dort als verwaister Posten auf.',
        { hostId: server.hostId, serverId },
      );
    }

    await this.deps.dns.deleteRecord(this.hostnameFor(server));
    // Ports zurück in den Pool (B8) – vor dem Löschen des Datensatzes, damit
    // eine Zuordnung nicht ohne Server zurückbleibt (Pflichtenheft §2.4).
    await this.deps.ports.release(serverId);
    // Nutzlast VOR dem Loeschen bilden: Danach gibt es weder den Datensatz
    // noch seine Mitverwalter (Fremdschluessel mit `cascade`).
    const geloescht = {
      serverId: server.id,
      serverName: server.name,
      ownerId: server.ownerId,
      memberUserIds: (await this.deps.repository.listMembers(serverId)).map(
        (member) => member.userId,
      ),
      detail: null,
    };

    await this.deps.repository.delete(serverId);

    /*
     * Flüchtigen Zustand des Servers abräumen (Audit orchestration-features-13,
     * Fundpunkt 137). Die Speicher liegen nur im Prozess und hingen bisher
     * bis zum Neustart am gelöschten Server: die zuletzt gemeldete Abfrage
     * (Spielerzahl, Ping), der zuletzt gemessene Plattenplatz, die zuletzt
     * gemeldeten Engine-Messwerte und der Zeitpunkt der letzten Uhren-Meldung.
     * Kleines, aber unbegrenztes Wachstum – und ein
     * wiederverwendeter Datensatz gäbe es nicht, weil Ids nicht wiederkehren.
     *
     * Nach dem Löschen des Datensatzes, nicht davor: Bricht das Löschen ab,
     * bleibt der Server bestehen und behält seine Werte.
     */
    this.latestQuery.forget(serverId);
    this.latestDiskUsage.forget(serverId);
    this.latestEngineStats.forget(serverId);
    this.clockSkew.forget(serverId);

    this.deps.events.emit('server.deleted', geloescht);
  }

  // -------------------------------------------------------------------------
  // Ändern und Klonen
  // -------------------------------------------------------------------------

  async updateServer(serverId: string, input: UpdateServerSettingsInput): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);
    const definition = this.deps.registry.require(server.gameType);

    const configJson: GameConfigValues = buildServerConfig(definition, input.config);

    // Die Subdomain ändert `UpdateServerSettingsInput` bewusst nicht (F3): Ein
    // Umzug zöge einen neuen DNS-Eintrag nach sich und ist damit ein eigener
    // Vorgang, kein Feld im Einstellungsformular.
    const restartRequired =
      (server.status === 'running' || server.status === 'starting') &&
      (requiresRestartAfterChange(definition, server.configJson, configJson) ||
        input.startupParameters !== server.startupParameters);

    await this.deps.repository.update(serverId, {
      name: input.name,
      resourceLimits: input.resourceLimits,
      configJson,
      startupParameters: input.startupParameters,
      autoShutdown: {
        enabled: input.autoShutdownEnabled,
        idleTimeoutMinutes:
          input.autoShutdownTimeoutMinutes ?? server.autoShutdown.idleTimeoutMinutes,
        graceMinutes: server.autoShutdown.graceMinutes,
      },
      restartRequired: restartRequired ? true : undefined,
    });

    const aktualisiert = await this.requireServer(serverId);

    // Die geänderten Grenzen sofort am Container setzen – die Engine kann das
    // im laufenden Betrieb, ein Neustart ist dafür nicht nötig. Die alten
    // Grenzen gehen mit, damit der Fingerabdruck nachgezogen werden kann, wenn
    // sie die einzige Änderung waren (siehe `applyResourceLimits`).
    await this.applyResourceLimits(aktualisiert, server.resourceLimits);

    return aktualisiert;
  }

  // Weltdaten-Übernahme (P4) und Klonen (P7) leben seit dem Review 2026-09-16
  // (Befund 2.1) in `world-import-transfer.ts` und `clone-service.ts`; hier
  // bleiben die Durchreichungen für die Routen.

  cloneServer(
    sourceServerId: string,
    input: CloneServerInput,
    ownerId: string,
  ): Promise<ServerCloneJobDto> {
    return this.clones.cloneServer(sourceServerId, input, ownerId);
  }

  /** Stand eines Klon-Auftrags (Route `GET /api/servers/:id/clone/:jobId`). */
  findCloneJob(sourceServerId: string, jobId: string): ServerCloneJobDto | null {
    return this.clones.findCloneJob(sourceServerId, jobId);
  }

  // -------------------------------------------------------------------------
  // Durchgereichte Agent-Befehle
  // -------------------------------------------------------------------------

  async getStats(serverId: string): Promise<AgentContainerStats> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    return session.sendCommand('GET_STATS', server.id, { containerId });
  }

  async getLogs(serverId: string, tail?: number): Promise<GetLogsCommandResult> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    return session.sendCommand('GET_LOGS', server.id, { containerId, tail });
  }

  /**
   * Führt eine Konsolenzeile im Container aus (Lastenheft §3.3).
   *
   * Die Zeile wird an Leerzeichen zerlegt und als Argumentliste übergeben – es
   * steht keine Shell dazwischen, damit aus einer Konsoleneingabe keine
   * Shell-Injection werden kann (siehe `ExecConsoleCommandPayload`).
   */
  async execConsole(serverId: string, commandLine: string): Promise<ExecConsoleCommandResult> {
    const { server, session, containerId } = await this.requireLiveTarget(serverId);

    // Spiele ohne Konsole (`{ kind: 'none' }`, z. B. Valheim): Das Frontend
    // blendet das Eingabefeld aus, aber die Route steht offen. Ein Befehl, der
    // stillschweigend in einem ungelesenen Rohr verschwände, wäre schlimmer
    // als eine Absage – der Aufrufer hälte ihn für ausgeführt.
    const konsole = this.deps.registry.require(server.gameType).console;
    if (konsole?.kind === 'none') {
      throw new ServerOrchestrationError(
        'CONSOLE_NOT_SUPPORTED',
        `${this.deps.registry.require(server.gameType).name} nimmt keine Konsolenbefehle entgegen.`,
        { serverId },
      );
    }

    const argv = commandLine
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0);

    if (argv.length === 0) {
      throw new ServerOrchestrationError(
        'AGENT_COMMAND_INVALID',
        'Der Konsolenbefehl darf nicht leer sein.',
        { serverId },
      );
    }

    // Spiele mit RCON-Anschluss (P2-9): Der Agent bekommt Port und Passwortdatei
    // aus der Definition, nicht das Passwort – das bleibt auf der Node. Ohne
    // `console` bleibt es beim Weg über die Standardeingabe.
    const rcon =
      konsole?.kind === 'rcon'
        ? { port: konsole.port, passwordFile: konsole.passwordFile }
        : undefined;

    return session.sendCommand('EXEC_CONSOLE', server.id, {
      containerId,
      command: argv,
      ...(rcon === undefined ? {} : { rcon }),
    });
  }

  /**
   * Live-Steuerung (Betreiber-Wunsch 23.09.2026): Einstellungen eines
   * laufenden Servers ändern, ohne Neustart.
   *
   * Reihenfolge mit Absicht:
   * 1. Prüfen (nur Felder der Live-Steuerung, nur zulässige Werte).
   * 2. Die Datei `liveConfigFile` schreiben – **vor** den Befehlen: Ein
   *    Kartenwechsel führt sie beim Laden aus, sie muss dann schon stimmen.
   * 3. Die Konsolenbefehle der betroffenen Steuerungen schicken.
   * 4. Die Werte in die Einstellungen (`config_json`) schreiben.
   *
   * **Live Geändertes bleibt** – über Stopp und Neustart hinweg (Betreiber
   * 23.09.2026). Deshalb gehen die Werte in die Einstellungen selbst: Der
   * nächste Start baut den Container aus ihnen (der Fingerabdruck des Bauplans
   * ändert sich mit), und das Formular zeigt denselben Stand wie die
   * Live-Steuerung. `restartRequired` bleibt unberührt – die Änderung wirkt ja
   * schon. `live_values` wird dabei geleert: Ein Rest aus v2.4.6, als Live-Werte
   * noch bis zum Start galten, wandert mit in die Einstellungen.
   */
  async applyLiveValues(
    serverId: string,
    eingabe: Readonly<Record<string, string | number>>,
  ): Promise<ServerRecord> {
    const server = await this.requireServer(serverId);
    const definition = this.deps.registry.require(server.gameType);

    if ((definition.liveControls ?? []).length === 0) {
      throw new ServerOrchestrationError(
        'CONSOLE_NOT_SUPPORTED',
        `${definition.name} lässt sich nicht live steuern.`,
        { serverId },
      );
    }

    if (server.status !== 'running') {
      throw new ServerOrchestrationError(
        'SERVER_STATE_CONFLICT',
        'Live ändern geht nur, solange der Server läuft – die Startwerte stehen in den Einstellungen.',
        { serverId, status: server.status },
      );
    }

    const neu = pruefeLiveWerte(definition, eingabe);
    const bisher = aktuelleWerte(definition, server.configJson, server.liveValues);
    const geaendert = Object.keys(neu).filter((key) => neu[key] !== bisher[key]);

    if (geaendert.length === 0) {
      return server;
    }

    const werte = { ...bisher, ...neu };
    const datei = liveDatei(definition, werte);

    if (datei !== null && definition.liveConfigFile !== undefined) {
      await this.files.writeFileContent(serverId, definition.liveConfigFile, datei);
    }

    for (const zeile of liveBefehle(definition, geaendert, werte)) {
      await this.execConsole(serverId, zeile);
    }

    await this.deps.repository.update(serverId, {
      configJson: { ...server.configJson, ...(server.liveValues ?? {}), ...neu },
      liveValues: null,
    });

    return this.requireServer(serverId);
  }

  // -------------------------------------------------------------------------
  // Datei-Manager (Arbeitspaket P2, Lastenheft §3.3) – siehe `file-service.ts`
  // -------------------------------------------------------------------------
  //
  // Die Dateioperationen leben seit dem Review 2026-09-16 (Befund 2.1) in
  // `ServerFileService`; hier bleiben nur die Durchreichungen, damit Routen
  // und Tests dieselbe Oberfläche behalten.

  listFiles(
    serverId: string,
    relativePath: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileListDto> {
    return this.files.listFiles(serverId, relativePath, options);
  }

  readFile(
    serverId: string,
    relativePath: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileContentDto> {
    return this.files.readFile(serverId, relativePath, options);
  }

  writeFile(
    serverId: string,
    relativePath: string,
    content: string,
    options: ServerFileAccessOptions,
  ): Promise<ServerFileContentDto> {
    return this.files.writeFile(serverId, relativePath, content, options);
  }

  uploadFile(
    serverId: string,
    directoryPath: string,
    fileName: string,
    content: Buffer,
    options: ServerFileUploadOptions,
  ): Promise<ServerFileListDto> {
    return this.files.uploadFile(serverId, directoryPath, fileName, content, options);
  }

  deleteFile(serverId: string, relativePath: string, recursive = false): Promise<void> {
    return this.files.deleteFile(serverId, relativePath, recursive);
  }

  /** Ordner als tar.gz öffnen; die Blöcke holt die Route (19.09.2026). */
  openDirectoryDownload(serverId: string, relativePath: string) {
    return this.files.openDirectoryDownload(serverId, relativePath);
  }

  downloadFile(
    serverId: string,
    relativePath: string,
  ): Promise<{ fileName: string; content: Buffer }> {
    return this.files.downloadFile(serverId, relativePath);
  }

  /** Tatsächlich zulässige Upload-Größe; die Upload-Route setzt sie als Multipart-Grenze. */
  maxUploadBytes(): number {
    return this.files.maxUploadBytes();
  }

  // -------------------------------------------------------------------------
  // Ereignisse des Agents
  // -------------------------------------------------------------------------

  /**
   * Verarbeitet ein Ereignis des Agents (Pflichtenheft §5.3).
   *
   * `STATUS_CHANGED` und `STATS_UPDATE` sind Beobachtungen, keine Anweisungen:
   * Sie ändern den Lifecycle-Zustand **nicht** direkt. Ein Container, der
   * plötzlich läuft, macht aus einem Server noch keinen `running` – dafür
   * braucht es den Health-Check (Pflichtenheft §9).
   */
  async handleAgentEvent(hostId: string, frame: AgentEventFrame): Promise<void> {
    /*
     * Die Ereignisse der Container-Runtime tragen keine `serverId`: Die Runtime
     * kennt nur ihre Container, und der Adapter des Agents meldet deshalb
     * `null` (`runtime-adapter.ts`). Ohne die Zuordnung über die Container-Id
     * wären Konsolenzeilen und Messwerte allesamt verworfen worden – die Id
     * steht am Server-Datensatz, also wird sie hier nachgeschlagen
     * (WORK_STATUS.md, Gefundener Punkt 101).
     */
    const server =
      frame.serverId === null
        ? await this.serverForContainerEvent(hostId, frame)
        : await this.deps.repository.findById(frame.serverId);

    if (server === null) {
      return;
    }

    /*
     * Node-Bindung (Audit security-matrix-07).
     *
     * Bisher wurde ausschließlich über Container-Id bzw. `serverId`
     * nachgeschlagen – ein Agent konnte also Ereignisse für Server melden, die
     * auf einer ganz anderen Node liegen: ein `CRASHED` mit fremder `serverId`
     * hätte dort einen Zustandswechsel samt Crash-Loop-Neustart ausgelöst, ein
     * `LOG_LINE` fremde Konsolenzeilen in die Live-Kanäle fremder Server
     * gelegt. Der Soll/Ist-Abgleich zieht die Grenze über `listByHost` längst
     * richtig; hier fehlte sie. Verworfen wird mit Protokolleintrag – ein
     * regulärer Agent kann diesen Fall nicht erzeugen.
     */
    if (server.hostId !== hostId) {
      this.deps.log.warn(
        { hostId, serverId: server.id, serverHostId: server.hostId, event: frame.event },
        'Agent-Ereignis für einen Server einer anderen Node verworfen',
      );

      return;
    }

    switch (frame.event) {
      case 'CRASHED':
        try {
          await this.handleCrash(server, frame);
        } catch (error: unknown) {
          /*
           * Ein zweites `CRASHED` für einen Server, der schon als abgestürzt
           * (oder nach Crash-Loop als `error`) geführt wird – Wiederholung
           * nach einem Reconnect, zwei Meldungen kurz nacheinander – scheitert
           * an der Übergangstabelle. Das ist eine Dublette, keine Störung
           * (Fundpunkt 126): Der maßgebliche Zustand steht bereits.
           */
          if (isServerOrchestrationError(error) && error.code === 'SERVER_STATE_CONFLICT') {
            this.deps.log.warn(
              { serverId: server.id, status: server.status, error: error.message },
              'Absturzmeldung verworfen – im aktuellen Zustand nicht anwendbar',
            );

            return;
          }

          throw error;
        }

        return;
      case 'STATS_UPDATE':
        await this.handleStatsUpdate(server, frame);

        return;
      case 'LOG_LINE':
        this.handleLogLine(server, frame);

        return;
      case 'STATUS_CHANGED':
        // Nur weiterreichen: Der maßgebliche Zustand steht in der Datenbank,
        // und der Container-Zustand allein entscheidet ihn nicht.
        this.deps.log.info(
          { serverId: server.id, payload: frame.payload },
          'Container-Zustand gemeldet',
        );

        return;
    }
  }

  /**
   * Absturz eines Servers (Pflichtenheft §9).
   *
   * Der Crash-Loop-Schutz entscheidet, ob automatisch neu gestartet wird. Löst
   * er aus, geht der Server nach `error` und es wird benachrichtigt.
   */
  private async handleCrash(server: ServerRecord, frame: AgentEventFrame): Promise<void> {
    const payload = frame.payload as { readonly exitCode?: number } | undefined;

    const result = await this.transitionFull(server, {
      type: 'crashed',
      reason: 'Der Server ist unerwartet beendet worden.',
      exitCode: payload?.exitCode ?? null,
    });

    await this.emitServerEvent('server.crashed', server, {
      exitCode: payload?.exitCode ?? null,
      recentCrashCount: result.state.crashTimestamps.length,
    });

    if (result.crashLoopTripped) {
      await this.transition(
        { ...server, ...result.state },
        {
          type: 'failed',
          reason:
            'Der Server ist zu oft hintereinander abgestürzt. Der automatische Neustart wurde abgeschaltet.',
        },
      );
      await this.emitServerEvent('server.failed', server, {
        detail: 'Der Server ist zu oft hintereinander abgestürzt.',
        recentCrashCount: result.state.crashTimestamps.length,
      });

      return;
    }

    const crashed = await this.requireServer(server.id);

    await this.dispatchStart(crashed, {
      type: 'automaticRestartRequested',
      attempt: result.nextRestartAttempt,
    });
  }

  /**
   * Live-Messwerte (Pflichtenheft §5.3).
   *
   * Neben dem Weiterreichen an den Live-Kanal dient das Ereignis als
   * Aktivitätsnachweis für den Auto-Shutdown: Sind Spieler verbunden, wird der
   * Bezugspunkt des Inaktivitäts-Timeouts nachgezogen.
   */
  /**
   * Server zu einem Ereignis ohne `serverId` über die Container-Id finden.
   *
   * Bleibt die Zuordnung offen, wird das Ereignis verworfen und einmal
   * protokolliert – geraten wird nicht.
   */
  private async serverForContainerEvent(
    hostId: string,
    frame: AgentEventFrame,
  ): Promise<ServerRecord | null> {
    const containerId = containerIdFromPayload(frame.payload);

    if (containerId === null) {
      this.deps.log.warn({ hostId, event: frame.event }, 'Agent-Ereignis ohne Server verworfen');

      return null;
    }

    const server = await this.deps.repository.findByContainerId(containerId);

    if (server === null) {
      this.deps.log.warn(
        { hostId, event: frame.event, containerId },
        'Agent-Ereignis für unbekannten Container verworfen',
      );
    }

    return server;
  }

  /**
   * Eine Konsolenzeile des Agents an den Live-Kanal geben
   * (`server.consoleLineAppended`, Gefundener Punkt 101).
   *
   * Bis hierher wurde die Nutzlast als `server.statusChanged` mit einem Feld
   * `logLine` gemeldet – ein Ereignis, dessen Vertrag das Feld nicht kennt. Der
   * Hub setzt `server.consoleLineAppended` bereits um; gefehlt hat nur die
   * richtige Meldung samt Übersetzung in eine `ServerConsoleLine`.
   */
  private handleLogLine(server: ServerRecord, frame: AgentEventFrame): void {
    const line = consoleLineFromAgentPayload(
      server.id,
      frame.payload,
      randomUUID(),
      frame.emittedAt,
    );

    if (line === null) {
      return;
    }

    /*
     * Während eines Starts zählt die Zeile auch für die Startfrist und die
     * Fehlermeldung (`startup-activity.ts`). Nur dann: Ein laufender Server
     * schreibt ohne Ende, und dafür gibt es keinen Leser.
     */
    if (server.status === 'starting') {
      const fortschritt = this.deps.registry.find(server.gameType)?.startupProgress;

      this.startupActivity.zeile(
        server.id,
        line.text,
        fortschritt === undefined ? null : fortschritt.pattern,
      );
    }

    this.deps.events.emit('server.consoleLineAppended', { serverId: server.id, line });
  }

  private async handleStatsUpdate(server: ServerRecord, frame: AgentEventFrame): Promise<void> {
    /*
     * **Maßgeblich ist die Backend-Uhr** (W2-14, orchestration-features-03).
     * Bis hierher entschied `frame.emittedAt` – also die Uhr des Homeservers –
     * darüber, wie alt ein Messwert ist. Ging sie mehr als fünf Minuten nach,
     * galt jede Abfrage sofort als veraltet und `playersOnline/playersMax/
     * pingMs` standen dauerhaft als `null` im Verlauf, obwohl der Agent
     * laufend meldete; ging sie vor, sah ein alter Wert ewig frisch aus. Ein
     * Zeitstempel, den das Backend selbst setzt, kann beides nicht.
     *
     * `emittedAt` geht deshalb nicht verloren, wechselt aber die Rolle: vom
     * Maß zum Diagnosewert. Weicht es auffällig ab, steht das – gedrosselt –
     * im Protokoll; verworfen wird nichts.
     */
    const empfangen = this.now();
    const abgleich = this.clockSkew.check(server.id, frame.emittedAt, empfangen);

    if (abgleich.shouldLog) {
      this.deps.log.warn(
        {
          serverId: server.id,
          hostId: server.hostId,
          emittedAt: frame.emittedAt,
          receivedAt: empfangen.toISOString(),
          skewMs: abgleich.skewMs,
        },
        'Uhr des Agents weicht von der Backend-Uhr ab – Messwerte werden mit der Empfangszeit geführt',
      );
    }

    /*
     * Unter dem Namen `STATS_UPDATE` fließen zwei verschiedene Nutzlasten: die
     * Messwerte der Container-Runtime und das Ergebnis der Server-Abfrage. Nur
     * Letztere kennt Spielerzahl und Antwortzeit – die Container-Engine liefert
     * beides nicht. Der zuletzt gemeldete Abfragestand wird deshalb gemerkt und
     * sowohl hier als auch beim Abtasten für den Verlauf (P5) neben die
     * Engine-Werte gelegt.
     */
    if (isServerQueryPayload(frame.payload)) {
      this.latestQuery.remember(
        server.id,
        querySnapshotFromPayload(frame.payload),
        abgleich.recordedAt,
      );
    } else {
      /*
       * Dieselbe Überlegung in der Gegenrichtung (Fundpunkt 179): CPU,
       * Arbeitsspeicher und Netzverkehr kennt nur der Statistik-Strom. Ohne
       * diesen Speicher trüge der nächste Abfrage-Rahmen dort `null` – und weil
       * das Frontend die Messwerte je Rahmen vollständig ersetzt, sprängen die
       * drei Kacheln im Takt der Abfrage auf „—".
       */
      this.latestEngineStats.remember(
        server.id,
        engineStatsFromPayload(frame.payload),
        abgleich.recordedAt,
      );
    }

    /*
     * Der belegte Plattenplatz kommt aus der Abtastung, nicht aus dem
     * Ereignis (Fundpunkt 175): Keine der beiden `STATS_UPDATE`-Nutzlasten
     * trägt ihn. Ohne diese Beigabe stünde in jedem Live-Rahmen `null` – und
     * weil das Frontend die Messwerte je Rahmen vollständig ersetzt, bliebe die
     * Kachel „Platte" dauerhaft auf „—", obwohl der Wert im Verlauf und in der
     * Ressourcen-Warnung längst steht.
     */
    const stats = liveStatsFromAgentPayload(
      frame.payload,
      this.latestQuery.read(server.id, abgleich.recordedAt),
      abgleich.recordedAt.toISOString(),
      this.latestDiskUsage.read(server.id, abgleich.recordedAt),
      this.latestEngineStats.read(server.id, abgleich.recordedAt),
    );

    if (stats.playersOnline !== null && stats.playersOnline > 0) {
      /*
       * Auch der Aktivitätsnachweis für den Auto-Shutdown hing an der
       * Agent-Uhr: Eine vorgehende Uhr hätte den Server über die
       * Inaktivitätsfrist hinaus am Leben gehalten, eine nachgehende ihn trotz
       * verbundener Spieler abgeschaltet.
       */
      await this.deps.repository.update(server.id, {
        lastActivityAt: abgleich.recordedAt.toISOString(),
      });
    }

    this.deps.events.emit('server.statsUpdated', { serverId: server.id, stats });
  }

  // -------------------------------------------------------------------------
  // Verlauf der Messwerte (Lastenheft §3.3, P5) – siehe `stats-sampling.ts`
  // -------------------------------------------------------------------------
  //
  // Abtastung, Last je Node und Verlauf leben seit dem Review 2026-09-16
  // (Befund 2.1) in `ServerStatsSampler`; hier bleiben die Durchreichungen für
  // den Zeitgeber und die Routen.

  sampleServerStats(hostId: string): Promise<readonly string[]> {
    return this.stats.sampleServerStats(hostId);
  }

  listServerLoads(): readonly ServerLoadSnapshot[] {
    return this.stats.listServerLoads();
  }

  pruneServerStats(): Promise<number> {
    return this.stats.pruneServerStats();
  }

  getStatsHistory(serverId: string, windowMinutes: number): Promise<ServerStatsHistoryDto> {
    return this.stats.getStatsHistory(serverId, windowMinutes);
  }

  // -------------------------------------------------------------------------
  // Auto-Shutdown
  // -------------------------------------------------------------------------

  /**
   * Prüft alle laufenden Server einer Node auf Inaktivität (Pflichtenheft §9).
   *
   * Wird periodisch aufgerufen. Die Entscheidung selbst steht in
   * `auto-shutdown.ts`; hier wird sie nur ausgeführt.
   */
  async runAutoShutdownSweep(hostId: string): Promise<readonly string[]> {
    const servers = await this.deps.repository.listByHost(hostId);
    const shutdown: string[] = [];

    for (const server of servers) {
      const decision = decideAutoShutdown({
        settings: server.autoShutdown,
        status: server.status,
        lastStartedAt: server.lastStartedAt,
        lastActivityAt: server.lastActivityAt,
        // Ohne frische Messung wird die Spielerzahl nicht geraten: Der
        // Aktivitätszeitpunkt aus `STATS_UPDATE` ist der Bezugspunkt.
        playersOnline: null,
        playerCountAvailable: this.playerCountAvailableFor(server),
        now: this.now(),
      });

      if (decision.action !== 'shutdown') {
        // Warum nicht abgeschaltet wird, steht als `decision.reason` fest –
        // insbesondere `activityUnknown` für Spiele ohne Spielerzahl (Audit
        // event-flow-08). Protokolliert wird es bewusst nicht: Der Sweep läuft
        // jede Minute über jeden Server, das wären Zeilen ohne Erkenntnis.
        continue;
      }

      try {
        // `'autoShutdown'` unterdrückt das allgemeine `server.stopped`: Der
        // Vorgang meldet sich gleich selbst, und zwar mit Grund und Dauer
        // (Audit event-flow-09).
        await this.stopServer(server.id, 'autoShutdown');
        await this.emitServerEvent('autoShutdown.triggered', server, {
          idleMinutes: Math.round(decision.idleMinutes),
        });
        shutdown.push(server.id);
      } catch (error: unknown) {
        this.deps.log.error(
          { serverId: server.id, error: error instanceof Error ? error.message : String(error) },
          'Automatisches Abschalten fehlgeschlagen',
        );
      }
    }

    return shutdown;
  }

  /**
   * Liefert die Abfrage dieses Spiels eine Spielerzahl? (Audit event-flow-08.)
   *
   * Nur `gamedig` fragt das Spieleprotokoll und bekommt Spieler und Ping;
   * `portConnect` prüft ausschließlich, ob sich eine TCP-Verbindung aufbauen
   * lässt (Vertrag `GameQuerySpec`, Pflichtenheft §9).
   *
   * Eine unbekannte Spiele-Kennung zählt hier als „nicht messbar" statt zu
   * werfen: Sie darf den Sweep der übrigen Server nicht abreißen lassen, und
   * die vorsichtige Antwort ist die, die keinen Server abschaltet.
   */
  private playerCountAvailableFor(server: ServerRecord): boolean {
    try {
      return (
        this.deps.registry.require(server.gameType).query.kind === 'gamedig' &&
        this.antwortetAufAbfragen(server)
      );
    } catch {
      return false;
    }
  }

  /**
   * Beantwortet dieser Server in seiner Einstellung überhaupt Abfragen?
   *
   * Für fast jedes Spiel ja – die Frage stellt sich nur, wo die
   * Spiele-Definition ein Konfigurationsfeld nennt, an dem es hängt
   * (`GamedigQuerySpec.requiresConfigFlag`). Valheim ist der Fall: Ohne
   * `-public 1` meldet sich der Server nicht beim Steam-Verzeichnis an und
   * beantwortet keine A2S-Abfrage. Erreichbar bleibt er; nur sehen kann
   * Palantir ihn nicht.
   *
   * Wer das übergeht, lässt jeden solchen Start in `error` laufen, obwohl
   * gespielt wird – dieselbe Klasse wie die Fundpunkte 183, 187, 193 und 246.
   */
  private antwortetAufAbfragen(server: ServerRecord): boolean {
    const query = this.deps.registry.require(server.gameType).query;

    // `none` heisst: Es gibt keine Frage, die eine Antwort braechte (Palworld
    // beantwortet nur seine eigene REST-Schnittstelle, und die verlangt das
    // Administrator-Passwort). Eine Sonde darauf liefe zwangslaeufig in die
    // Frist.
    if (query.kind === 'none') {
      return false;
    }

    if (query.kind !== 'gamedig' || query.requiresConfigFlag === undefined) {
      return true;
    }

    return server.configJson[query.requiresConfigFlag] === true;
  }

  /**
   * Meldet ein Server-Ereignis mit **vollstaendiger** Nutzlast (Pflichtenheft
   * §14, Vertrag `ServerEventPayload`).
   *
   * **Warum es diese Methode gibt.** Die Senke ist bewusst schmal
   * (`emit(event: string, payload: Record<string, unknown>)`), damit B3 die
   * Notification-Engine nicht kennen muss. Der Preis: Der Vertrag der Nutzlast
   * wird nirgends erzwungen - und genau daran fehlten bisher `serverName`,
   * `memberUserIds` und `detail`. Ohne `ownerId` und `memberUserIds` findet die
   * Empfaengeraufloesung niemanden; ohne `serverName` steht ein leerer Name in
   * der Meldung, und ein fehlendes `detail` liess das Rendern abstuerzen.
   *
   * Aufgefallen ist es erst, als die ersten Benachrichtigungs-Regeln existierten
   * (Gefundener Punkt 82) - vorher hoerte auf diese Ereignisse niemand zu.
   *
   * Die Mitverwalter werden hier nachgeschlagen und nicht am Aufrufort: Sie
   * gehoeren zur Nutzlast jedes Server-Ereignisses, und keine der aufrufenden
   * Stellen braucht sie sonst.
   *
   * Ein Fehler beim Zusammenstellen darf den ausloesenden Vorgang nicht
   * scheitern lassen (Pflichtenheft §14) - er wird protokolliert, mehr nicht.
   */
  private async emitServerEvent(
    event: string,
    server: ServerRecord | string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const record =
        typeof server === 'string' ? await this.deps.repository.findById(server) : server;

      if (record === null) {
        this.deps.log.warn({ event, serverId: server }, 'Ereignis ohne Serverdatensatz verworfen');

        return;
      }

      const members = await this.deps.repository.listMembers(record.id);

      this.deps.events.emit(event, {
        serverId: record.id,
        serverName: record.name,
        ownerId: record.ownerId,
        memberUserIds: members.map((member) => member.userId),
        detail: null,
        ...extra,
      });
    } catch (error: unknown) {
      this.deps.log.error(
        { event, error: error instanceof Error ? error.message : String(error) },
        'Server-Ereignis konnte nicht gemeldet werden',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Soll/Ist-Abgleich (Pflichtenheft §2.2)
  // -------------------------------------------------------------------------

  /**
   * Gleicht den gemeldeten Ist-Zustand mit dem Soll-Zustand ab.
   *
   * Die Planung steht in `reconciliation.ts` und ist dort einzeln geprüft; hier
   * wird der Plan ausgeführt – jede Korrektur über die State Machine.
   */
  async reconcile(hostId: string, frame: AgentStateReportFrame): Promise<void> {
    // Gemessene Node-Ressourcen übernehmen (Pflichtenheft §11), falls der Agent
    // sie mitschickt. In eigenem try/catch: Ein Schreibfehler darf den
    // Soll/Ist-Abgleich nicht verhindern – der ist der eigentliche Zweck.
    if (frame.nodeStats) {
      try {
        await this.deps.repository.updateMeasuredResources(hostId, {
          ramMb: frame.nodeStats.ramTotalMb,
          cpuCores: frame.nodeStats.cpuCores,
          diskMb: frame.nodeStats.diskTotalMb,
          // Auch die Momentaufnahme festhalten (Gefundener Punkt 96): Die
          // Uebersicht zeigt sonst nur, was reserviert ist, nicht was laeuft.
          usage: {
            ramAvailableMb: frame.nodeStats.ramAvailableMb,
            diskAvailableMb: frame.nodeStats.diskAvailableMb,
            cpuLoad1m: frame.nodeStats.cpuLoad1m,
            observedAt: new Date(frame.nodeStats.observedAt),
          },
        });
      } catch (error) {
        this.deps.log.error(
          { hostId, error: error instanceof Error ? error.message : String(error) },
          'Gemessene Node-Ressourcen konnten nicht übernommen werden',
        );
      }
    }

    const servers = await this.deps.repository.listByHost(hostId);
    const plan = planReconciliation(
      servers.map((server) => ({
        id: server.id,
        status: server.status,
        dockerContainerId: server.dockerContainerId,
        statusChangedAt: server.statusChangedAt,
      })),
      frame.containers,
      frame.reason,
      // Ein laufendes Anlegen überlebt einen Reconnect, solange die
      // `CREATE`-Frist läuft (Review 2026-09-16, Befund 11.2).
      { createGraceMs: this.deps.config.createTimeoutMs },
    );

    this.deps.log.info(
      {
        hostId,
        reason: frame.reason,
        actions: plan.actions.length,
        unchanged: plan.unchangedServerIds.length,
      },
      'Soll/Ist-Abgleich',
    );

    for (const action of plan.actions) {
      if (action.kind === 'reportOrphan') {
        // Bewusst nur melden, nie automatisch entfernen: Ein verwaister
        // Container kann die letzte Kopie von Weltdaten enthalten.
        this.deps.log.warn(
          { hostId, containerId: action.containerId, serverId: action.serverId },
          action.reason,
        );
        continue;
      }

      const server = servers.find((candidate) => candidate.id === action.serverId);

      if (server === undefined) {
        continue;
      }

      await this.applyReconciliationAction(server, action);
    }
  }

  private async applyReconciliationAction(
    server: ServerRecord,
    action: Exclude<
      ReturnType<typeof planReconciliation>['actions'][number],
      { kind: 'reportOrphan' }
    >,
  ): Promise<void> {
    try {
      switch (action.kind) {
        case 'markCrashed':
          await this.handleCrash(server, {
            kind: 'event',
            event: 'CRASHED',
            serverId: server.id,
            payload: { exitCode: action.exitCode },
            emittedAt: this.now().toISOString(),
          });

          return;
        case 'markStopped': {
          /*
           * Aus `running` und `starting` erlaubt die Tabelle `stopped` nur über
           * `stopping` (Audit orchestration-core-04). Der Plan sagt, ob der
           * Zwischenschritt nötig ist; beide Schritte sind zulässige Übergänge.
           */
          let aktuell = server;

          if (action.viaStopping) {
            const zwischen = await this.transition(server, { type: 'stopRequested' });

            aktuell = { ...server, ...zwischen };
          }

          await this.transition(aktuell, { type: 'observedStopped', reason: action.reason });
          await this.emitServerEvent('server.stopped', server, { detail: action.reason });

          return;
        }
        case 'retryStop':
          /*
           * Der Server soll gestoppt werden, der Befehl ist aber mit der
           * Verbindung verloren gegangen. Kein Zustandswechsel – der Zielzustand
           * steht bereits in der Datenbank; es fehlt allein der Befehl an den
           * Homeserver (Audit orchestration-core-04).
           */
          this.deps.log.info({ serverId: server.id }, action.reason);
          await this.dispatchStop(server);

          return;
        case 'markMissing':
        case 'markCreateInterrupted':
          await this.transition(server, { type: 'failed', reason: action.reason });
          await this.emitServerEvent('server.failed', server, { detail: action.reason });

          return;
        case 'verifyHealth':
          // Der Container läuft – ob der Server auch antwortet, entscheidet der
          // Health-Check, nicht der Abgleich (Pflichtenheft §9).
          if (server.status !== 'starting') {
            await this.transition(server, { type: 'startRequested' });
          }

          /*
           * **Der Abgleich wartet nicht auf den Health-Check** (Fundpunkt 288).
           *
           * Die Prüfung läuft bis zu `startupTimeoutSeconds` – bei den
           * Steam-Spielen zwanzig Minuten und mehr. Hing der Plan daran, blieb
           * alles dahinter liegen: ein Stopp-Befehl, der erneut abgeschickt
           * gehört, ein abgestürzter Nachbar, die Meldung über einen verwaisten
           * Container. Beobachtet am 2026-09-13 auf der VPS – die beiden
           * Waisen-Warnungen erschienen erst zwanzig Minuten nach dem Abgleich,
           * der sie gefunden hatte.
           *
           * Derselbe Weg wie nach einem regulären Start (`finishStart`): Der
           * Zustandswechsel wird über `server.statusChanged` gemeldet, nicht
           * über die Rückkehr dieses Aufrufs.
           */
          fireAndForget(this.awaitStartupHealth(server.id), this.deps.log, {
            vorgang: 'Health-Check aus dem Soll/Ist-Abgleich',
            serverId: server.id,
          });

          return;
      }
    } catch (error: unknown) {
      const details = {
        serverId: server.id,
        status: server.status,
        action: action.kind,
        error: error instanceof Error ? error.message : String(error),
      };

      // Ein Übergang, den die Tabelle im aktuellen Zustand verbietet, ist eine
      // überholte oder doppelte Beobachtung, keine Störung (Fundpunkt 126).
      if (isServerOrchestrationError(error) && error.code === 'SERVER_STATE_CONFLICT') {
        this.deps.log.warn(
          details,
          'Korrektur aus dem Soll/Ist-Abgleich im aktuellen Zustand nicht anwendbar',
        );

        return;
      }

      this.deps.log.error(details, 'Korrektur aus dem Soll/Ist-Abgleich fehlgeschlagen');
    }
  }

  // -------------------------------------------------------------------------
  // Hilfsmittel
  // -------------------------------------------------------------------------

  /**
   * Wendet ein Ereignis an und schreibt den neuen Zustand fort.
   *
   * `repository` erlaubt es, den Schreibvorgang gegen ein transaktionsgebundenes
   * Repository laufen zu lassen – gebraucht für den Wechsel auf `starting`
   * innerhalb der Kapazitätsreservierung (Punkt 98). Ohne Angabe schreibt der
   * Dienst wie bisher gegen sein Standard-Repository.
   */
  private async transition(
    server: ServerRecord,
    event: ServerLifecycleEvent,
    repository: ServerRepository = this.deps.repository,
  ): Promise<ServerLifecycleState> {
    const result = await this.transitionFull(server, event, repository);

    return result.state;
  }

  /**
   * Wie {@link transition}, liefert aber das vollständige Ergebnis der State
   * Machine – und räumt die periodische Abfrage ab, wenn der Server aufhört zu
   * laufen (Audit event-flow-10).
   *
   * **Warum hier und nicht an jedem Aufrufort.** Abgemeldet wurde die Abfrage
   * bisher nur beim Stoppen und beim Löschen. Jeder andere Weg aus dem Betrieb
   * – Crash-Loop nach `error`, gescheiterter Health-Check, ein vom Abgleich
   * beobachteter Stopp – ließ das Ziel beim Agent stehen: Er fragte den toten
   * Port weiter im 30-Sekunden-Takt ab, und jedes Ergebnis kostete im Backend
   * ein `findById` samt Live-Frame für einen Server, der gar nicht läuft. Eine
   * Regel an einer Stelle ist verlässlicher als sechs Aufrufe, von denen der
   * siebte vergessen wird.
   *
   * Beim Stoppen greift die Regel schon auf dem Weg nach `stopping`, also
   * **vor** dem `STOP`-Befehl: Zwischen Befehl und Zustandswechsel läuft damit
   * keine Abfrage mehr gegen einen bereits angehaltenen Container – der Grund,
   * aus dem `dispatchStop()` das früher von Hand tat. Der Aufruf scheitert
   * leise (siehe {@link applyServerQuery}): Ein Zustandswechsel darf nicht
   * daran hängen, dass der Agent einen Zusatzbefehl annimmt.
   */
  private async transitionFull(
    server: ServerRecord,
    event: ServerLifecycleEvent,
    repository: ServerRepository = this.deps.repository,
  ): Promise<ReturnType<typeof applyLifecycleEvent>> {
    const { result, publish } = await this.applyTransition(server, event, repository);

    publish();

    const liefVorher = server.status === 'running' || server.status === 'starting';
    const laeuftJetzt = result.state.status === 'running' || result.state.status === 'starting';

    if (liefVorher && !laeuftJetzt) {
      await this.queries.applyServerQuery(server, false);
    }

    return result;
  }

  /**
   * Kern jedes Zustandswechsels: Ereignis anwenden, bedingt fortschreiben,
   * Meldung **vorbereiten**.
   *
   * Getrennt von {@link transitionFull}, weil `server.statusChanged` erst nach
   * dem Commit hinausgehen darf (Audit event-flow-11). Läuft der Wechsel
   * innerhalb der Kapazitätsreservierung, ist die Zeile beim Rückkehren aus dem
   * Callback noch ungeschrieben – ein dort abgesetztes Frame hätte jedem
   * Browser `starting` gezeigt, während ein Abbruch der Transaktion die
   * Datenbank auf `stopped` zurückfallen lässt. Der Aufrufer ruft `publish()`
   * deshalb erst, wenn die Transaktion durch ist.
   *
   * Das Fortschreiben selbst ist bedingt (`persistLifecycle` mit erwartetem
   * Zustand, Audit orchestration-core-07): Die State Machine rechnet gegen den
   * geladenen Datensatz; hat ihn zwischenzeitlich jemand anders weitergeschaltet,
   * endet dieser Wechsel mit `SERVER_STATE_CONFLICT` statt den fremden zu
   * überschreiben.
   */
  private async applyTransition(
    server: ServerRecord,
    event: ServerLifecycleEvent,
    repository: ServerRepository = this.deps.repository,
  ): Promise<{
    readonly result: ReturnType<typeof applyLifecycleEvent>;
    readonly publish: () => void;
  }> {
    const result = applyLifecycleEvent(
      {
        status: server.status,
        statusMessage: server.statusMessage,
        statusChangedAt: server.statusChangedAt,
        lastStartedAt: server.lastStartedAt,
        crashTimestamps: server.crashTimestamps,
        totalUptimeSeconds: server.totalUptimeSeconds,
      },
      event,
      { now: this.now(), crashLoopPolicy: this.deps.config.crashLoopPolicy },
    );

    await repository.persistLifecycle(server.id, result.state, server.status);

    return {
      result,
      publish: (): void => {
        this.deps.events.emit('server.statusChanged', {
          serverId: server.id,
          from: server.status,
          to: result.state.status,
          statusMessage: result.state.statusMessage,
        });
      },
    };
  }

  private requireContainerId(server: ServerRecord): string {
    if (server.dockerContainerId === null) {
      throw new ServerOrchestrationError(
        'SERVER_STATE_CONFLICT',
        'Für diesen Server existiert auf dem Homeserver kein Container.',
        { serverId: server.id },
      );
    }

    return server.dockerContainerId;
  }

  private async requireLiveTarget(serverId: string): Promise<{
    server: ServerRecord;
    session: AgentSession;
    containerId: string;
  }> {
    const server = await this.requireServer(serverId);

    return {
      server,
      session: this.deps.agents.require(server.hostId),
      containerId: this.requireContainerId(server),
    };
  }

  private async resolveHost(hostId?: string): Promise<{ id: string }> {
    if (hostId !== undefined) {
      const host = await this.deps.repository.findHost(hostId);

      if (host === null) {
        throw new ServerOrchestrationError(
          'SERVER_NOT_FOUND',
          'Die angegebene Node existiert nicht.',
          { hostId },
        );
      }

      // Eine stillgelegte Node nimmt auch keinen neuen Server auf: Sonst
      // entstünde ein Server, den niemand starten kann (Gefundener Punkt 109).
      this.assertNodeAcceptsWork(host, 'create');

      return host;
    }

    const kandidaten = await this.deps.repository.listPlacementCandidates();

    if (kandidaten.length === 0) {
      throw new ServerOrchestrationError(
        'AGENT_NOT_CONNECTED',
        'Es ist keine Node eingerichtet. Bitte zuerst die Ersteinrichtung ausführen (pnpm --filter @palantir/backend db:seed).',
      );
    }

    /*
     * Platzierungsregel statt „älteste Node" (Review 2026-09-16, Befund 2.3):
     * die Node mit dem meisten freien RAM unter denen, die Arbeit annehmen;
     * bei Gleichstand die älteste – mit einer Node also wie bisher.
     */
    const wahl = choosePlacementHost(kandidaten);

    if (wahl === null) {
      // Keine Node nimmt an (Punkt 109): Bei genau einer Node dieselbe Meldung
      // wie bei ausdrücklicher Wahl, sonst die Sammelmeldung.
      const einzige = kandidaten.length === 1 ? kandidaten[0] : undefined;

      if (einzige !== undefined) {
        this.assertNodeAcceptsWork(einzige, 'create');
      }

      throw new ServerOrchestrationError(
        'NODE_UNAVAILABLE',
        'Keine Node nimmt gerade neue Server an – alle sind in Wartung oder nicht erreichbar.',
        { nodes: kandidaten.map((node) => ({ id: node.id, status: node.status })) },
      );
    }

    return { id: wahl.id };
  }

  /** Verbindungsadresse eines Servers (Pflichtenheft §13). */
  addressFor(server: ServerRecord): { hostname: string; port: number | null } {
    const definition = this.deps.registry.require(server.gameType);

    return {
      hostname: this.hostnameFor(server),
      port: visiblePortOf(server.assignedPorts, definition.supportsVirtualHostRouting),
    };
  }
}
