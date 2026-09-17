/**
 * Periodische Server-Abfrage des Agents (`SET_SERVER_QUERY`, Gefundener
 * Punkt 74): Ziel bestimmen, setzen, beenden und je Node abgleichen.
 *
 * Aus `service.ts` herausgelöst (Review 2026-09-16, Befund 2.1, dritter
 * Schnitt). Der Agent kennt keine Spiele und errät nichts: Abfrageart und Port
 * kommen aus der Spiele-Definition und der Portvergabe. Ob ein Server in
 * seiner Einstellung überhaupt Abfragen beantwortet, entscheidet der Dienst
 * (`antwortetAufAbfragen`) und reicht die Antwort als Funktion herein.
 */

import { type AgentServerQueryTarget } from '@palantir/contracts';
import { type AgentGatewayLogger, type AgentRegistry } from './agent-gateway.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerRecord, type ServerRepository } from './repository.js';

export interface ServerQueryDependencies {
  readonly agents: Pick<AgentRegistry, 'get'>;
  readonly registry: GameRegistry;
  readonly repository: Pick<ServerRepository, 'listByHost'>;
  readonly log: AgentGatewayLogger;
  /** Beantwortet dieser Server in seiner Einstellung Abfragen? (Valheim ohne `-public 1`: nein.) */
  readonly antwortetAufAbfragen: (server: ServerRecord) => boolean;
}

export class ServerQueryTargets {
  private readonly deps: ServerQueryDependencies;

  constructor(deps: ServerQueryDependencies) {
    this.deps = deps;
  }

  /**
   * Ziel für die Abfrage; `null`, solange der Server keinen Container oder
   * keinen primären Port hat – dann gibt es nichts abzufragen.
   *
   * Als Adresse bleibt die Vorgabe des Agents (`127.0.0.1`): Die Portbindung
   * liegt auf dem Homeserver selbst, im LAN lauscht nichts (Pflichtenheft §18).
   */
  queryTargetFor(server: ServerRecord): AgentServerQueryTarget | null {
    if (server.dockerContainerId === null) {
      return null;
    }

    // Ein Auftrag, der nicht zu erfüllen ist, gehört nicht gestellt: Valheim
    // ohne `-public 1` beantwortet keine Abfrage, und der Agent liefe alle paar
    // Sekunden in eine Frist.
    if (!this.deps.antwortetAufAbfragen(server)) {
      return null;
    }

    const definition = this.deps.registry.require(server.gameType);
    // Beide Ports gehen mit: der Host-Port, unter dem der Container
    // veröffentlicht ist (derselbe Wert wie `hostPort` in `CREATE_CONTAINER`),
    // und der Port IM Container. Der Agent fragt über das Spielenetz auf dem
    // Container-Port (Fundpunkt 188) – der Host-Port ist an 127.0.0.1 der Node
    // gebunden, und das ist nicht das Loopback des Agent-Containers.
    const primary =
      server.assignedPorts.find(
        (zuweisung) => zuweisung.containerPort === definition.query.containerPort,
      ) ?? server.assignedPorts.find((zuweisung) => zuweisung.primary);

    if (primary === undefined) {
      return null;
    }

    return {
      containerId: server.dockerContainerId,
      hostPort: primary.publicPort,
      // Der Port, den die Definition zur Abfrage nennt – bei Valheim der
      // Abfrage-Port neben dem Spiel-Port (Fundpunkt 196).
      containerPort: definition.query.containerPort,
      query:
        definition.query.kind === 'gamedig'
          ? { kind: 'gamedig', protocol: definition.query.protocol }
          : { kind: 'portConnect' },
    };
  }

  /**
   * Abfrage für einen Server setzen oder beenden.
   *
   * `active: false` schickt `target: null` – der Agent stellt die Abfrage dann
   * ein. Beides ist idempotent und darf wiederholt werden.
   *
   * **Scheitert bewusst leise.** Die Abfrage liefert Spielerzahl und
   * Antwortzeit; sie ist eine Zutat zur Anzeige, kein Teil des Lifecycles. Ein
   * Serverstart darf nicht daran scheitern, dass der Agent den Zusatzbefehl
   * nicht annimmt – gemeldet wird er trotzdem, sonst sucht später niemand die
   * fehlenden Messwerte.
   */
  async applyServerQuery(server: ServerRecord, active: boolean): Promise<void> {
    const session = this.deps.agents.get(server.hostId);

    if (session === null) {
      return;
    }

    const target = active ? this.queryTargetFor(server) : null;

    if (active && target === null) {
      return;
    }

    try {
      await session.sendCommand('SET_SERVER_QUERY', server.id, { serverId: server.id, target });
    } catch (error: unknown) {
      this.deps.log.warn(
        {
          serverId: server.id,
          aktiv: active,
          error: error instanceof Error ? error.message : String(error),
        },
        'Server-Abfrage konnte nicht gesetzt werden',
      );
    }
  }

  /**
   * Abfragen einer Node **abgleichen** – setzen, was laufen soll, und abräumen,
   * was nicht mehr laufen soll (Audit event-flow-10).
   *
   * Der Aufruf gehört an jeden Verbindungsaufbau des Agents: Er hält seine
   * Ziele im Arbeitsspeicher und hat sie nach einem Neustart vergessen. Der
   * Befehl ist idempotent, ein zweites Setzen desselben Ziels also folgenlos.
   *
   * **Warum auch die nicht laufenden Server angefasst werden.** Überlebt der
   * Agent einen Neustart des Backends, behält er seine Ziele. Ging in derselben
   * Zeit ein Server verloren – abgestürzt, vom Abgleich auf `stopped` gesetzt –,
   * fragte er dessen toten Port bis zu seinem eigenen Neustart weiter ab und
   * schickte für jeden Fehlschlag ein `STATS_UPDATE` zurück. Ein `null` je
   * übrigem Server beendet das in einem Zug; die Rückgabe nennt weiterhin nur
   * die tatsächlich **gesetzten** Ziele.
   */
  async refreshServerQueries(hostId: string): Promise<readonly string[]> {
    const gesetzt: string[] = [];

    for (const server of await this.deps.repository.listByHost(hostId)) {
      const aktiv = server.status === 'running' || server.status === 'starting';

      await this.applyServerQuery(server, aktiv);

      if (aktiv) {
        gesetzt.push(server.id);
      }
    }

    return gesetzt;
  }
}
