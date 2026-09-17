/**
 * Health-Check nach dem Start (Pflichtenheft §9): Wartet, bis der Server auf
 * dem Weg der Spieler erreichbar ist, und schließt den Start ab – oder lässt
 * ihn scheitern.
 *
 * Aus `service.ts` herausgelöst (Review 2026-09-16, Befund 2.1, dritter
 * Schnitt). Zustandswechsel und Ereignisse laufen weiter über den Dienst; er
 * reicht `transition` und `emitServerEvent` als Funktionen herein, damit es
 * genau eine State Machine bleibt.
 */

import { type AgentGatewayLogger } from './agent-gateway.js';
import { isServerOrchestrationError } from './errors.js';
import { type GameRegistry } from './game-registry.js';
import { type HealthProbe, awaitHealthy } from './health-check.js';
import { type ServerRecord, type ServerRepository } from './repository.js';
import { type ServerLifecycleEvent } from './state-machine.js';

export type StartIntent = 'start' | 'restart';

export interface StartupHealthDependencies {
  readonly registry: GameRegistry;
  readonly repository: Pick<ServerRepository, 'findHost'>;
  readonly config: {
    readonly healthCheckHost: string;
    readonly healthCheckAttemptTimeoutMs: number;
    readonly healthCheckIntervalMs: number;
  };
  readonly healthProbe: HealthProbe;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now: () => Date;
  readonly log: AgentGatewayLogger;
  readonly requireServer: (serverId: string) => Promise<ServerRecord>;
  /** Öffentlicher Hostname des Servers – Ziel der Sonde bei Hostname-Routing. */
  readonly hostnameFor: (server: ServerRecord) => string;
  /** Beantwortet dieser Server in seiner Einstellung Abfragen? */
  readonly antwortetAufAbfragen: (server: ServerRecord) => boolean;
  /** Zustandswechsel über die State Machine des Dienstes. */
  readonly transition: (server: ServerRecord, event: ServerLifecycleEvent) => Promise<unknown>;
  /** Wie `emitServerEvent()` – mit vollständiger Nutzlast nach §14. */
  readonly emitServerEvent: (
    event: string,
    server: ServerRecord | string,
    extra?: Record<string, unknown>,
  ) => Promise<void>;
}

export class StartupHealthCheck {
  private readonly deps: StartupHealthDependencies;

  constructor(deps: StartupHealthDependencies) {
    this.deps = deps;
  }

  /**
   * Wartet auf den Health-Check und schließt den Start ab.
   *
   * Verschwindet der Server währenddessen (gelöscht, während der Check über
   * Minuten lief – Fundpunkt 127), gibt es keinen Zustand mehr, der
   * fortzuschreiben wäre: Der Start ist damit schlicht abgebrochen, kein
   * Fehler. `deleteServer()` lehnt das Löschen im Zustand `starting` zwar ab,
   * doch der Datensatz kann auch anders verschwinden (Kaskade, Abgleich).
   */
  async awaitStartupHealth(serverId: string, anlass: StartIntent = 'start'): Promise<void> {
    try {
      await this.run(serverId, anlass);
    } catch (error: unknown) {
      if (isServerOrchestrationError(error) && error.code === 'SERVER_NOT_FOUND') {
        this.deps.log.warn(
          { serverId },
          'Health-Check abgebrochen – der Server existiert nicht mehr',
        );

        return;
      }

      throw error;
    }
  }

  private async run(serverId: string, anlass: StartIntent): Promise<void> {
    const server = await this.deps.requireServer(serverId);
    const definition = this.deps.registry.require(server.gameType);
    const host = await this.deps.repository.findHost(server.hostId);

    /*
     * **Geprüft wird der Abfrage-Port, nicht der Spiel-Port** (Fundpunkt 196).
     *
     * Bei den meisten Spielen ist das derselbe (Minecraft antwortet auf 25565
     * auf beides). Valheim nicht: Dort läuft das Spiel auf 2456 und die
     * Serverliste antwortet auf 2457. Welcher Port gemeint ist, sagt die
     * Definition über `query.containerPort`; hier wird die öffentliche Nummer
     * gesucht, die frp diesem Container-Port gegeben hat. Findet sich keine,
     * bleibt es beim Haupt-Port – so verhält sich jede Definition ohne eigenen
     * Abfrage-Port wie bisher.
     */
    const primary =
      server.assignedPorts.find(
        (assignment) => assignment.containerPort === definition.query.containerPort,
      ) ?? server.assignedPorts.find((assignment) => assignment.primary);

    if (host === null || primary === undefined) {
      await this.deps.transition(server, {
        type: 'healthCheckFailed',
        reason: 'Die Node oder die Portzuweisung des Servers ist unvollständig.',
      });
      await this.deps.emitServerEvent('server.failed', serverId, {
        detail: 'Portzuweisung unvollständig',
      });

      return;
    }

    /*
     * Geprüft wird der Weg der Spieler, nicht die Node im Tunnel (Fundpunkt 183).
     *
     * Bis dahin zielte der Check auf `host.wireguardIp` – und das konnte nie
     * antworten: Der Agent bindet die Spielports auf der Node absichtlich nur an
     * `127.0.0.1` (hardening.ts, `DEFAULT_HOST_IP`, damit das Heim-LAN sie nicht
     * sieht), und die WireGuard-Firewall der Node verwirft jede neue
     * Verbindung aus dem Tunnel. Jeder Start lief so nach
     * `startupTimeoutSeconds` in `error`, während das Spiel längst lief und
     * Spieler drauf waren. Aufgefallen beim ersten echten Minecraft-Start am
     * 2026-09-09.
     *
     * Erreichbar ist der Server von hier aus genau dort, wo ihn auch die Spieler
     * erreichen: auf der öffentlichen Adresse der VPS, hinter frps. Damit prüft
     * der Check zugleich den Tunnel – ein Server, der auf der Node läuft, aber
     * durch frp nicht durchkommt, ist für Spieler nicht „running".
     *
     * **Mit Hostname-Routing zählt der Name, nicht die Adresse** (Fundpunkt 193).
     * Dort teilen sich alle Server den Router-Port; auseinandergehalten werden
     * sie am Namen, den der Client im Handshake mitschickt. Eine Sonde auf
     * `publicIpv4:25565` schickt die IP als Namen mit, und Infrared weist sie ab
     * („no proxy with uid <ip>@:25565"), obwohl der Server läuft – jeder Start
     * liefe in `error`. Deshalb geht die Sonde auf den Hostnamen des Servers:
     * Er löst über den CNAME auf dieselbe VPS auf, und `gamedig` trägt ihn als
     * Ziel in den Handshake ein. Damit prüft der Check denselben Weg wie ein
     * Spieler, Router eingeschlossen.
     *
     * **Welche Adresse das ist, sagt `healthCheckHost`** (Fundpunkt 288). Bei
     * UDP-Spielen ist die öffentliche Adresse der VPS aus dem Backend-Container
     * heraus die falsche: Das Paket geht hinaus und kommt zurück, aber die
     * NAT-Schleife des Hosts schreibt den Absender auf das Docker-Gateway um.
     * `gamedig` verwirft eine UDP-Antwort, deren Absender nicht das Ziel ist –
     * jeder Versuch endete in „UDP - Timed out", und jeder Start eines
     * UDP-Spiels lief nach seiner ganzen Frist in `error`, während Spieler
     * darauf waren. Die Begründung im Langen steht an `HEALTH_CHECK_HOST`.
     *
     * **Ein Server, den niemand abfragen kann, ist deshalb nicht krank.**
     * Valheim mit `-public 0` beantwortet keine A2S-Abfrage. Eine Sonde darauf
     * läuft zwangsläufig in die Frist, und der Server landete nach zwanzig
     * Minuten in `error`, während Spieler darauf unterwegs sind. Der Start
     * gilt hier deshalb als geglückt, sobald der Container läuft – mehr ist
     * über diesen Server nicht in Erfahrung zu bringen, und die falsche Aussage
     * wäre die schlechtere. Der Preis: keine Spielerzahl, kein Ping, kein
     * automatischer Stopp bei 0 Spielern.
     */
    if (!this.deps.antwortetAufAbfragen(server)) {
      this.deps.log.info(
        { serverId, gameType: server.gameType },
        'Start ohne Abfrage bestaetigt - dieser Server beantwortet in seiner Einstellung keine Abfragen',
      );
      await this.deps.transition(server, { type: 'healthCheckPassed' });
      await this.deps.emitServerEvent(
        anlass === 'restart' ? 'server.restarted' : 'server.started',
        serverId,
        { pingMs: null },
      );

      return;
    }

    const result = await awaitHealthy({
      target: {
        host: definition.supportsVirtualHostRouting
          ? this.deps.hostnameFor(server)
          : this.deps.config.healthCheckHost,
        port: primary.publicPort,
        query: definition.query,
      },
      startupTimeoutMs: definition.startupTimeoutSeconds * 1_000,
      attemptTimeoutMs: this.deps.config.healthCheckAttemptTimeoutMs,
      intervalMs: this.deps.config.healthCheckIntervalMs,
      probe: this.deps.healthProbe,
      sleep: this.deps.sleep,
      // Dieselbe Uhr wie der Rest des Dienstes – sonst könnte ein Test die Zeit
      // stellen und die Startfrist liefe trotzdem gegen die echte Uhr.
      now: () => this.deps.now().getTime(),
    });

    // Zwischenzeitlich kann der Server abgestürzt oder gestoppt worden sein.
    const current = await this.deps.requireServer(serverId);

    if (current.status !== 'starting') {
      this.deps.log.warn(
        { serverId, status: current.status },
        'Health-Check-Ergebnis verworfen – der Server ist nicht mehr im Startvorgang',
      );

      return;
    }

    if (result.healthy) {
      await this.deps.transition(current, { type: 'healthCheckPassed' });
      /*
       * Genau eine Meldung je Vorgang (Audit event-flow-09): Beim Neustart
       * steht hier `server.restarted` („Neustart abgeschlossen – der Server ist
       * wieder erreichbar"), sonst `server.started`. Beide zu senden wäre für
       * denselben Vorgang zweimal dieselbe Nachricht.
       */
      await this.deps.emitServerEvent(
        anlass === 'restart' ? 'server.restarted' : 'server.started',
        serverId,
        { pingMs: result.pingMs },
      );

      return;
    }

    await this.deps.transition(current, {
      type: 'healthCheckFailed',
      reason: result.reason ?? 'Der Server war nach dem Start nicht erreichbar.',
    });
    await this.deps.emitServerEvent('server.failed', serverId, { detail: result.reason ?? null });
  }
}
