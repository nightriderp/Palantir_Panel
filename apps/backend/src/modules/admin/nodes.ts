/**
 * HostNode-Verwaltung (Lastenheft §3.7, Pflichtenheft §6).
 *
 * Übersicht der Homeserver inklusive Auslastung, Kapazität und Status.
 *
 * Drei Größen, die leicht verwechselt werden:
 * - **total** – was die Node laut Konfiguration hat
 * - **allocated** – die Summe der Ressourcen-Limits aller dort angelegten
 *   Server, also der reservierte Anteil
 * - **usage** – die tatsächlich gemessene Auslastung
 *
 * `allocated` und `usage` kann B8 nicht selbst wissen: Die Server-Tabelle
 * gehört zu B3, die Messwerte kommen über B4 bzw. den Agent. Beides steckt
 * deshalb hinter je einer Schnittstelle, die vorerst leer beantwortet wird –
 * die Übersicht funktioniert, die Zahlen füllen sich, sobald die Pakete da sind.
 */

import {
  type HostNodeCapacity,
  type HostNodeDto,
  type HostNodePermissions,
  type HostNodeStatus,
  type HostNodeUsage,
  type NodeResources,
} from '@palantir/contracts';
import type { CreateHostNodeInput, UpdateHostNodeInput } from '@palantir/validation';
import {
  type PermissionActor,
  computePermissionFlags,
  hasAnyPermission,
  hasPermission,
} from '../rbac/index.js';
import { isUniqueViolation } from '../../db/errors.js';
import { type AuditService, entryFor } from './audit.js';
import type { AdminContext } from './context.js';
import { AdminError } from './errors.js';
import type { NodePortBinding } from './ports.js';
import { generateAgentToken, hashAgentToken } from './agent-token.js';

/** Node, wie sie in der Datenbank steht. */
export interface HostNodeRecord {
  readonly id: string;
  readonly name: string;
  readonly wireguardIp: string;
  readonly totalResources: NodeResources;
  readonly status: HostNodeStatus;
  readonly statusMessage: string | null;
  readonly lastSeenAt: Date | null;
  readonly createdAt: Date;
  /**
   * Hat diese Node ein eigenes Agent-Token? (Gefundene Punkte 57 und 110.)
   *
   * Bewusst nur das Ja/Nein und nicht der Hash: Über das Modul hinaus wird der
   * Hash nirgends gebraucht, und was nicht herumgereicht wird, kann auch nicht
   * versehentlich in einer Antwort landen.
   */
  readonly hasAgentToken: boolean;
}

export interface CreateHostNodeData {
  readonly name: string;
  readonly wireguardIp: string;
  readonly totalResources: NodeResources;
}

/**
 * Was tatsächlich in die Zeile geschrieben wird.
 *
 * `status` steht hier weiterhin, ist aber nichts, was ein Aufrufer von außen
 * wählt: Der Dienst leitet ihn aus der Wartungs-Entscheidung und der
 * Agent-Verbindung ab (siehe {@link HostNodeService.update}). Das Eingabe-DTO
 * kennt dieses Feld nicht mehr.
 */
export interface UpdateHostNodeData {
  readonly name?: string;
  readonly wireguardIp?: string;
  readonly totalResources?: NodeResources;
  readonly status?: HostNodeStatus;
  readonly statusMessage?: string | null;
}

export interface HostNodeRepository {
  listAll(): Promise<HostNodeRecord[]>;
  findById(id: string): Promise<HostNodeRecord | null>;
  /** Prüft Name **und** WireGuard-Adresse – beide müssen eindeutig sein. */
  findByNameOrIp(
    name: string | undefined,
    wireguardIp: string | undefined,
  ): Promise<HostNodeRecord | null>;
  create(data: CreateHostNodeData): Promise<HostNodeRecord>;
  update(id: string, data: UpdateHostNodeData): Promise<HostNodeRecord>;
  remove(id: string): Promise<void>;
  /**
   * Node zu einem Agent-Token finden (Gefundener Punkt 57).
   *
   * Gesucht wird über den Hash, nie über das Token selbst – gespeichert ist
   * ohnehin nur der Hash.
   */
  findByAgentTokenHash(hash: string): Promise<HostNodeRecord | null>;
  /** Agent-Token einer Node setzen oder ersetzen. Übergeben wird der Hash. */
  setAgentTokenHash(id: string, hash: string): Promise<void>;
}

/** Was auf einer Node an Servern liegt – geliefert von B3. */
export interface NodePlacement {
  readonly serverCount: number;
  readonly allocated: NodeResources;
}

/**
 * Belegung je Node.
 *
 * Bis B3 die Tabelle `game_servers` mitbringt, liefert
 * {@link emptyNodePlacementSource} für jede Node null Server und null
 * reservierte Ressourcen – `available` entspricht dann `total`.
 */
export interface NodePlacementSource {
  load(): Promise<ReadonlyMap<string, NodePlacement>>;
}

/**
 * Gemessene Auslastung je Node.
 *
 * Kommt aus dem Ist-Zustands-Bericht des Agents bzw. aus B4
 * (Ressourcen & Kapazität). Bis dahin liefert {@link emptyNodeUsageSource}
 * keine Messwerte, und `usage` bleibt `null`.
 */
export interface NodeUsageSource {
  load(): Promise<ReadonlyMap<string, HostNodeUsage>>;
}

export function emptyNodePlacementSource(): NodePlacementSource {
  return { load: async () => new Map() };
}

export function emptyNodeUsageSource(): NodeUsageSource {
  return { load: async () => new Map() };
}

const NO_RESOURCES: NodeResources = { ramMb: 0, cpuCores: 0, diskMb: 0 };

/** Rest nie unter null – ein überbuchter Wert wäre für die Anzeige unbrauchbar. */
function subtract(total: NodeResources, allocated: NodeResources): NodeResources {
  return {
    ramMb: Math.max(0, total.ramMb - allocated.ramMb),
    cpuCores: Math.max(0, total.cpuCores - allocated.cpuCores),
    diskMb: Math.max(0, total.diskMb - allocated.diskMb),
  };
}

export function computeCapacity(
  total: NodeResources,
  allocated: NodeResources = NO_RESOURCES,
): HostNodeCapacity {
  return { total, allocated, available: subtract(total, allocated) };
}

export function computeHostNodePermissions(actor: PermissionActor): HostNodePermissions {
  return computePermissionFlags<keyof HostNodePermissions>(actor, {
    // Wer verwaltet, muss sehen können.
    canView: ['node.view', 'node.manage'],
    canManage: 'node.manage',
    canManageStorage: 'node.manage',
  });
}

export interface HostNodeService {
  list(ctx: AdminContext): Promise<HostNodeDto[]>;
  get(ctx: AdminContext, nodeId: string): Promise<HostNodeDto>;
  create(ctx: AdminContext, input: CreateHostNodeInput): Promise<HostNodeDto>;
  /**
   * Node bearbeiten.
   *
   * Der Zustand ist kein Eingabefeld: `maintenance: true` legt die Node still,
   * `maintenance: false` gibt sie an die automatische Führung zurück und trägt
   * ein, was gerade wirklich gilt – `online` bei bestehender Agent-Sitzung,
   * sonst `offline`.
   */
  update(ctx: AdminContext, nodeId: string, input: UpdateHostNodeInput): Promise<HostNodeDto>;
  remove(ctx: AdminContext, nodeId: string): Promise<void>;
  /** Node laden oder mit `NODE_NOT_FOUND` abbrechen – auch für andere Dienste des Moduls. */
  require(nodeId: string): Promise<HostNodeRecord>;
  /**
   * Neues Agent-Token für eine Node erzeugen (Gefundener Punkt 57).
   *
   * Gibt das Token **einmal** im Klartext zurück; gespeichert wird nur sein
   * Hash. Ein bereits vergebenes Token wird dabei ersetzt – der bisherige Agent
   * dieser Node kommt danach nicht mehr herein, bis er das neue Token bekommt.
   * Erfordert `node.manage`.
   */
  issueAgentToken(ctx: AdminContext, nodeId: string): Promise<{ token: string }>;
  /**
   * Node zu einem vorgelegten Agent-Token, oder `null`.
   *
   * Ohne Permission-Prüfung: Der Aufrufer ist der Agent-Endpunkt (B3), der zu
   * diesem Zeitpunkt noch niemanden authentifiziert hat – das Token **ist** der
   * Nachweis.
   */
  findByAgentToken(token: string): Promise<HostNodeRecord | null>;
}

/**
 * Port-Bereiche, die exklusiv an eine Node gebunden sind (Audit W3-6,
 * backend-admin-resources-08).
 *
 * Erfüllt vom `PortPoolService` desselben Moduls. Bewusst diese schmale Sicht
 * statt der ganzen Port-Verwaltung: Die Node-Verwaltung braucht vor dem Löschen
 * genau zwei Auskünfte – hängen Bereiche an der Node, und sind daraus Ports
 * vergeben.
 *
 * Ohne diese Abhängigkeit verhält sich `remove()` wie bisher; dann fehlt nur
 * die Prüfung, nicht die Funktion.
 */
export interface NodePortBindingSource {
  listNodeBindings(nodeId: string): Promise<readonly NodePortBinding[]>;
  removeNodeBinding(ctx: AdminContext, rangeId: string): Promise<void>;
}

/**
 * Besteht für eine Node gerade eine Agent-Sitzung?
 *
 * Die einzige Auskunft, die die Node-Verwaltung von B3 braucht, um eine Node
 * nach dem Ende der Wartung wieder richtig einzutragen: Ein Agent, der
 * durchgehend verbunden ist, macht keinen neuen Handshake – der Zustand käme
 * ohne diese Frage nie von `offline` zurück auf `online`.
 *
 * Bewusst so schmal und bewusst synchron: Die Antwort steht in der
 * `AgentRegistry` im Arbeitsspeicher (Pflichtenheft §2.2), es ist kein
 * Datenbank- oder Netzzugriff nötig. Fehlt die Auskunft, verhält sich der
 * Dienst wie bisher – nur eben ohne den Rückweg nach `online`.
 */
export interface NodeConnectionSource {
  isConnected(nodeId: string): boolean;
}

export interface HostNodeServiceDependencies {
  readonly repository: HostNodeRepository;
  readonly audit: AuditService;
  readonly placements?: NodePlacementSource;
  readonly usage?: NodeUsageSource;
  /** Port-Bereiche der Node – für die Prüfung beim Löschen (Audit W3-6). */
  readonly portBindings?: NodePortBindingSource;
  /** Offene Agent-Verbindungen – für den Zustand nach dem Ende einer Wartung. */
  readonly connections?: NodeConnectionSource;
}

function requireNodeRead(actor: PermissionActor): void {
  if (!hasAnyPermission(actor, ['node.view', 'node.manage'])) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

function requireNodeManage(actor: PermissionActor): void {
  if (!hasPermission(actor, 'node.manage')) {
    throw new AdminError('PERMISSION_DENIED');
  }
}

export function createHostNodeService(deps: HostNodeServiceDependencies): HostNodeService {
  const placements = deps.placements ?? emptyNodePlacementSource();
  const usageSource = deps.usage ?? emptyNodeUsageSource();

  function toDto(
    actor: PermissionActor,
    node: HostNodeRecord,
    placement: NodePlacement | undefined,
    usage: HostNodeUsage | undefined,
  ): HostNodeDto {
    return {
      id: node.id,
      name: node.name,
      wireguardIp: node.wireguardIp,
      status: node.status,
      statusMessage: node.statusMessage,
      capacity: computeCapacity(node.totalResources, placement?.allocated ?? NO_RESOURCES),
      usage: usage ?? null,
      serverCount: placement?.serverCount ?? 0,
      lastSeenAt: node.lastSeenAt?.toISOString() ?? null,
      hasAgentToken: node.hasAgentToken,
      createdAt: node.createdAt.toISOString(),
      permissions: computeHostNodePermissions(actor),
    };
  }

  async function requireNode(nodeId: string): Promise<HostNodeRecord> {
    const node = await deps.repository.findById(nodeId);

    if (!node) {
      throw new AdminError('NODE_NOT_FOUND');
    }

    return node;
  }

  async function ensureAddressFree(
    name: string | undefined,
    wireguardIp: string | undefined,
    ignoreNodeId?: string,
  ): Promise<void> {
    if (name === undefined && wireguardIp === undefined) {
      return;
    }

    const existing = await deps.repository.findByNameOrIp(name, wireguardIp);

    if (existing && existing.id !== ignoreNodeId) {
      throw new AdminError('NODE_ADDRESS_TAKEN');
    }
  }

  /**
   * Führt den Schreibvorgang aus und übersetzt die Kollision zweier
   * gleichzeitiger Aufrufe (Audit W2-9, `backend-admin-resources-12`).
   *
   * `ensureAddressFree()` und der folgende Schreibvorgang sind zwei getrennte
   * Anweisungen; zwei gleichzeitige Aufrufe mit demselben Namen bestehen beide
   * die Vorprüfung. Den zweiten fängt der Unique-Index auf `host_nodes.name`
   * bzw. `host_nodes.wireguard_ip` – bisher als roher Postgres-Fehler und damit
   * als 500 statt als `NODE_ADDRESS_TAKEN` (409). Die Port-Vergabe in
   * `ports.ts` behandelt dasselbe Rennen seit jeher so.
   */
  /**
   * Zustand einer Node, die gerade aus der Wartung entlassen wird.
   *
   * `markHostConnected` hebt `offline` nur beim **Handshake** auf `online`. Ein
   * durchgehend verbundener Agent macht keinen neuen Handshake – ohne diese
   * Ableitung bliebe die Node bis zu ihrer nächsten Neuverbindung fälschlich
   * als offline geführt.
   *
   * Fehlt die Auskunft (Aufbau ohne Agent-Gateway, etwa in Tests), gilt
   * `offline` als sichere Annahme: Ein fälschlich `online` geführter Knoten
   * nähme Server-Starts an, die dann am nicht erreichbaren Agent scheitern; ein
   * fälschlich `offline` geführter wird beim nächsten Handshake von selbst
   * richtiggestellt.
   */
  function abgeleiteterZustand(nodeId: string): HostNodeStatus {
    return deps.connections?.isConnected(nodeId) === true ? 'online' : 'offline';
  }

  async function mitAdresskonflikt<T>(schreiben: () => Promise<T>): Promise<T> {
    try {
      return await schreiben();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new AdminError('NODE_ADDRESS_TAKEN');
      }

      throw error;
    }
  }

  return {
    async list(ctx) {
      requireNodeRead(ctx.actor);

      const [nodes, placementMap, usageMap] = await Promise.all([
        deps.repository.listAll(),
        placements.load(),
        usageSource.load(),
      ]);

      return nodes.map((node) =>
        toDto(ctx.actor, node, placementMap.get(node.id), usageMap.get(node.id)),
      );
    },

    async get(ctx, nodeId) {
      requireNodeRead(ctx.actor);

      const node = await requireNode(nodeId);
      const [placementMap, usageMap] = await Promise.all([placements.load(), usageSource.load()]);

      return toDto(ctx.actor, node, placementMap.get(node.id), usageMap.get(node.id));
    },

    async create(ctx, input) {
      requireNodeManage(ctx.actor);
      await ensureAddressFree(input.name, input.wireguardIp);

      const node = await mitAdresskonflikt(() =>
        deps.repository.create({
          name: input.name,
          wireguardIp: input.wireguardIp,
          totalResources: input.totalResources,
        }),
      );

      await deps.audit.record(
        entryFor(ctx, {
          action: 'node.created',
          targetType: 'node',
          targetId: node.id,
          metadata: { name: node.name, wireguardIp: node.wireguardIp },
        }),
      );

      return toDto(ctx.actor, node, undefined, undefined);
    },

    async update(ctx, nodeId, input) {
      requireNodeManage(ctx.actor);

      const node = await requireNode(nodeId);
      await ensureAddressFree(input.name, input.wireguardIp, node.id);

      const { maintenance, ...rest } = input;
      const data: UpdateHostNodeData = {
        ...rest,
        ...(maintenance === undefined
          ? {}
          : { status: maintenance ? 'maintenance' : abgeleiteterZustand(node.id) }),
      };

      const updated = await mitAdresskonflikt(() => deps.repository.update(node.id, data));

      /*
       * Im Audit steht der geschriebene Zustand, nicht nur der Feldname:
       * „changed: [maintenance]" ließe offen, ob die Node danach `online` oder
       * `offline` geführt wird – genau das ist beim Ende einer Wartung die
       * interessante Hälfte.
       */
      await deps.audit.record(
        entryFor(ctx, {
          action: 'node.updated',
          targetType: 'node',
          targetId: node.id,
          metadata: {
            changed: Object.keys(input),
            ...(data.status === undefined ? {} : { status: data.status }),
          },
        }),
      );

      const [placementMap, usageMap] = await Promise.all([placements.load(), usageSource.load()]);

      return toDto(ctx.actor, updated, placementMap.get(updated.id), usageMap.get(updated.id));
    },

    async issueAgentToken(ctx, nodeId) {
      requireNodeManage(ctx.actor);

      const node = await requireNode(nodeId);
      const token = generateAgentToken();

      await deps.repository.setAgentTokenHash(node.id, hashAgentToken(token));

      /*
       * Das Token selbst gehört nicht ins Audit-Log – dort stünde sonst ein
       * gültiger Zugang zur Node. Protokolliert wird, dass es vergeben wurde.
       */
      await deps.audit.record(
        entryFor(ctx, {
          action: 'node.agentTokenIssued',
          targetType: 'node',
          targetId: node.id,
          metadata: { name: node.name },
        }),
      );

      return { token };
    },

    async findByAgentToken(token) {
      if (token.length === 0) {
        return null;
      }

      return deps.repository.findByAgentTokenHash(hashAgentToken(token));
    },

    async remove(ctx, nodeId) {
      requireNodeManage(ctx.actor);

      const node = await requireNode(nodeId);
      const placement = (await placements.load()).get(node.id);

      if (placement && placement.serverCount > 0) {
        // Sonst blieben Container ohne zuständige Node zurück.
        throw new AdminError('NODE_IN_USE');
      }

      /*
       * Node-gebundene Port-Bereiche (Audit W3-6, backend-admin-resources-08).
       *
       * `port_ranges.node_id` löscht per `ON DELETE CASCADE` mit, die daraus
       * vergebenen Zuordnungen stehen aber unter `ON DELETE RESTRICT`. Ohne
       * diese Prüfung liefen beide Fälle daneben:
       *
       * - Bereich mit vergebenen Ports: Der Löschversuch lief in den
       *   Fremdschlüssel und kam als roher 500 heraus statt als `NODE_IN_USE`.
       * - Leerer Bereich: Er verschwand still per CASCADE – ohne den
       *   Audit-Eintrag, den ein Löschen von Hand immer schreibt.
       */
      const bindungen = (await deps.portBindings?.listNodeBindings(node.id)) ?? [];
      const belegt = bindungen.filter((bindung) => bindung.allocatedPorts > 0);

      if (belegt.length > 0) {
        throw new AdminError(
          'NODE_IN_USE',
          `An dieser Node hängen Port-Bereiche mit vergebenen Ports (${belegt
            .map((bindung) => bindung.label)
            .join(', ')}). Erst die Ports freigeben, dann die Node entfernen.`,
        );
      }

      // Leere Bereiche über den Port-Dienst räumen, damit der Audit-Eintrag
      // `address.rangeDeleted` entsteht, bevor der CASCADE zuschlägt.
      for (const bindung of bindungen) {
        await deps.portBindings?.removeNodeBinding(ctx, bindung.id);
      }

      await deps.repository.remove(node.id);
      await deps.audit.record(
        entryFor(ctx, {
          action: 'node.deleted',
          targetType: 'node',
          targetId: node.id,
          metadata: { name: node.name },
        }),
      );
    },

    require: requireNode,
  };
}
