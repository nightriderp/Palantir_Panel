/**
 * Abtastung und Verlauf der Messwerte (Lastenheft §3.3, Arbeitspaket P5).
 *
 * Aus `service.ts` herausgelöst (Review 2026-09-16, Befund 2.1). Der Abtaster
 * kennt vom Orchestrierungsdienst nur das, was er wirklich braucht: die
 * Serverliste einer Node, `GET_STATS` je Server und die drei Register, die
 * der Dienst auch für den Live-Kanal führt (letzte Abfrage, letzter
 * Plattenstand, Last je Node). `ServerOrchestrationService` reicht die vier
 * Methoden unverändert durch, der Zeitgeber (`scheduler.ts`) ruft sie über
 * dieselbe Oberfläche wie bisher.
 */

import { type AgentContainerStats, type ServerStatsHistoryDto } from '@palantir/contracts';
import { type AgentGatewayLogger } from './agent-gateway.js';
import { type ServerRepository } from './repository.js';
import { type ServerLoadSnapshot } from '../resources/index.js';
import {
  type LatestDiskUsageCache,
  type LatestQueryCache,
  type ServerLoadRegistry,
  type ServerStatsRepository,
  type StatsSample,
  toStatsHistoryDto,
} from './stats-history.js';

export interface ServerStatsSamplerDependencies {
  readonly repository: Pick<ServerRepository, 'listByHost'>;
  readonly statsHistory?: ServerStatsRepository;
  readonly config: {
    readonly statsHistoryRetentionHours: number;
    readonly statsSampleIntervalMs: number;
  };
  readonly log: AgentGatewayLogger;
  readonly now: () => Date;
  /** `GET_STATS` an den Agent – wie `ServerOrchestrationService.getStats`. */
  readonly getStats: (serverId: string) => Promise<AgentContainerStats>;
  readonly latestQuery: LatestQueryCache;
  readonly latestDiskUsage: LatestDiskUsageCache;
  readonly serverLoads: ServerLoadRegistry;
}

export class ServerStatsSampler {
  private readonly deps: ServerStatsSamplerDependencies;

  constructor(deps: ServerStatsSamplerDependencies) {
    this.deps = deps;
  }

  /**
   * Hält die Messwerte aller laufenden Server einer Node fest.
   *
   * Wird periodisch aufgerufen (`scheduler.ts`) – kein eigener Timer. Ein
   * Server, dessen Messung scheitert, hält die übrigen nicht auf: Eine Lücke im
   * Verlauf ist hinnehmbar, ein abgebrochener Durchlauf wäre eine Lücke für
   * alle.
   *
   * Derselbe Durchlauf schreibt den Stand für die Ressourcen-Warnung auf
   * Server-Ebene mit ({@link listServerLoads}). Nur Server, die hier
   * tatsächlich gemessen wurden, stehen anschließend darin: Ein gestoppter,
   * gelöschter oder unmessbarer Server fällt heraus, weil der Stand der Node
   * vollständig ersetzt wird.
   */
  async sampleServerStats(hostId: string): Promise<readonly string[]> {
    const ablage = this.deps.statsHistory;

    if (ablage === undefined) {
      return [];
    }

    const moment = this.deps.now();
    const abgetastet: string[] = [];
    const lasten: ServerLoadSnapshot[] = [];

    for (const server of await this.deps.repository.listByHost(hostId)) {
      if (server.status !== 'running') {
        continue;
      }

      try {
        const stats = await this.deps.getStats(server.id);
        const abfrage = this.deps.latestQuery.read(server.id, moment);
        const ramUsedMb = Math.round(stats.memoryUsedBytes / (1024 * 1024));
        /*
         * Belegter Plattenplatz des Datenordners (Fundpunkt 168). Das Feld ist
         * im Vertrag optional: Ein älterer Agent kennt es nicht, und auch ein
         * neuer lässt es weg, solange er den Ordner noch nicht gemessen hat.
         *
         * Fehlt es, bleibt der Wert `null` – „nicht gemessen", **nicht** „null
         * Bytes belegt". Der Unterschied zählt: `evaluateServerWarnings` lässt
         * `null` fallen, aus einer 0 rechnete es dagegen „0 % belegt" und
         * schwiege auch dann, wenn die Platte längst voll wäre.
         */
        const diskUsedMb =
          stats.diskUsedBytes === undefined
            ? null
            : Math.round(stats.diskUsedBytes / (1024 * 1024));

        /*
         * Für den Live-Kanal merken (Fundpunkt 175). Dies ist die **einzige**
         * Stelle, an der der Plattenplatz überhaupt ankommt: Er hängt an
         * `GET_STATS` und nicht am Statistik-Strom der Engine. Ohne diese Zeile
         * bliebe die Kachel „Platte" in der Live-Anzeige dauerhaft leer,
         * während Verlauf und Ressourcen-Warnung denselben Wert schon führen.
         */
        this.deps.latestDiskUsage.remember(server.id, diskUsedMb, moment);

        const probe: StatsSample = {
          serverId: server.id,
          recordedAt: moment,
          cpuPercent: stats.cpuPercent,
          ramUsedMb,
          diskUsedMb,
          pingMs: abfrage.pingMs,
          playersOnline: abfrage.playersOnline,
          playersMax: abfrage.playersMax,
          networkRxBytes: stats.networkRxBytes,
          networkTxBytes: stats.networkTxBytes,
        };

        await ablage.insert(probe);
        abgetastet.push(server.id);
        lasten.push({
          serverId: server.id,
          nodeId: server.hostId,
          ownerId: server.ownerId,
          limits: server.resourceLimits,
          usedRamMb: ramUsedMb,
        });
      } catch (error: unknown) {
        this.deps.log.warn(
          { serverId: server.id, error: error instanceof Error ? error.message : String(error) },
          'Messwerte konnten nicht festgehalten werden',
        );
      }
    }

    this.deps.serverLoads.replace(hostId, lasten, moment);

    return abgetastet;
  }

  /**
   * Zuletzt gemessene Last aller laufenden Server – die Quelle, aus der der
   * Zeitgeber die Warnungen auf Server-Ebene rechnet (Lastenheft §3.3).
   *
   * Ohne eigene Abfrage: Die Werte stammen aus der Abtastung desselben Takts
   * (siehe {@link sampleServerStats}). Zu alte Stände fallen weg – ein Server,
   * den seit zwei Takten niemand gemessen hat, ist kein Warnungsgrund, sondern
   * ein Messproblem.
   */
  listServerLoads(): readonly ServerLoadSnapshot[] {
    return this.deps.serverLoads.list(this.deps.now());
  }

  /** Entfernt Stichproben jenseits der Aufbewahrungsfrist (`STATS_HISTORY_RETENTION_HOURS`). */
  async pruneServerStats(): Promise<number> {
    const ablage = this.deps.statsHistory;

    if (ablage === undefined) {
      return 0;
    }

    const grenze = new Date(
      this.deps.now().getTime() - this.deps.config.statsHistoryRetentionHours * 60 * 60 * 1000,
    );

    return ablage.prune(grenze);
  }

  /**
   * Verlauf der Messwerte eines Servers (Lastenheft §3.3).
   *
   * `windowMinutes` wird an der Aufbewahrungsfrist gekappt: Ein größeres
   * Fenster brächte nur eine Reihe, die vorne bei der Frist abbricht, und würde
   * Lücken vortäuschen, die in Wirklichkeit weggeräumte Zeilen sind.
   */
  async getStatsHistory(serverId: string, windowMinutes: number): Promise<ServerStatsHistoryDto> {
    const fenster = Math.min(windowMinutes, this.deps.config.statsHistoryRetentionHours * 60);
    const ablage = this.deps.statsHistory;
    const seit = new Date(this.deps.now().getTime() - fenster * 60 * 1000);
    const proben = ablage === undefined ? [] : await ablage.listSince(serverId, seit);

    return toStatsHistoryDto(
      serverId,
      fenster,
      Math.round(this.deps.config.statsSampleIntervalMs / 1000),
      proben,
    );
  }
}
