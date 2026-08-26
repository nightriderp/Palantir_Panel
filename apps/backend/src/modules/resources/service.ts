/**
 * Ressourcen-Service (Pflichtenheft §10, Lastenheft §3.4).
 *
 * Zwei Aufgaben:
 *
 * 1. **Nutzer-Kontingente** lesen, setzen und aufheben – nachträglich durch
 *    einen Admin (`user.manage`).
 * 2. **Kapazitätsprüfung vor jedem Serverstart** – die Funktion, die B3
 *    aufruft, damit dort keine Parallelimplementierung entsteht.
 *
 * Wie im Rollen-Service (B2) prüft jede Methode die Berechtigung zusätzlich
 * selbst, nicht nur der Guard an der Route: die Regel gilt damit auch für
 * Aufrufer außerhalb des HTTP-Pfads (Skripte, andere Module).
 *
 * Die Kapazitätsprüfung ist bewusst **nicht** an eine Permission gebunden. Sie
 * ist eine Zusicherung des Systems, keine Rechtefrage – auch der Owner startet
 * keinen Server auf einer vollen Node (Pflichtenheft §10).
 */

import {
  NO_USER_RESOURCE_LIMITS,
  type CapacityCheckResult,
  type RequestedServerResources,
  type ResourceLowEvent,
  type ResourceWarningThresholds,
  type UserResourceLimitDto,
  type UserResourceLimitPermissions,
  type UserResourceLimits,
} from '@palantir/contracts';
import type { UserResourceLimitsInput } from '@palantir/validation';
import {
  type PermissionActor,
  computePermissionFlags,
  hasPermission,
} from '../rbac/permissions.js';
import { type CapacityCheckInput, checkCapacity } from './capacity.js';
import { ResourceError } from './errors.js';
import type {
  HostNodeRecord,
  HostNodeRepository,
  ServerUsageRepository,
  UserResourceLimitRecord,
  UserResourceLimitRepository,
} from './ports.js';
import { evaluateNodeWarnings } from './thresholds.js';

/**
 * `permissions`-Objekt eines Kontingent-DTOs (Pflichtenheft §5.2).
 *
 * `user.manage` deckt laut Permission-Katalog ausdrücklich das Setzen von
 * Kontingenten ab. `isSelf` ist vorgesehen für den Fall, dass B1 das eigene
 * Kontingent am Konto-DTO mitliefert: das eigene Kontingent darf man sehen,
 * aber nie selbst ändern.
 */
export function computeUserResourceLimitPermissions(
  actor: PermissionActor,
  isSelf = false,
): UserResourceLimitPermissions {
  return computePermissionFlags<keyof UserResourceLimitPermissions>(actor, {
    canView: isSelf ? true : 'user.manage',
    canEdit: 'user.manage',
  });
}

/** Anfrage an die Kapazitätsprüfung (Pflichtenheft §10). */
export interface StartCapacityRequest {
  /** Besitzer des Servers – sein Kontingent wird geprüft. */
  readonly ownerId: string;
  /** Ziel-Node (`GameServer.hostId`). */
  readonly nodeId: string;
  /** Die Limits, mit denen der Server starten soll. */
  readonly requested: RequestedServerResources;
  /**
   * Server, der bei der Belegung ausgelassen wird.
   *
   * Beim Start eines bereits angelegten Servers zwingend dessen eigene Id –
   * sonst zählt sein Speicherplatz doppelt. Beim Erstellungs-Wizard (F3) gibt es
   * noch keinen Server, dann bleibt das Feld leer.
   */
  readonly excludeServerId?: string;
  /** Zeitstempel für die Warn-Nutzlasten – injizierbar für Tests. */
  readonly at?: Date;
}

export interface ResourceService {
  /** Kontingent eines Nutzers samt aktueller Belegung. */
  getUserLimits(
    actor: PermissionActor,
    userId: string,
    options?: { readonly isSelf?: boolean },
  ): Promise<UserResourceLimitDto>;
  /**
   * Kontingent setzen oder ändern (Admin, `user.manage`).
   *
   * Teil-Update: nicht genannte Felder bleiben stehen, ausdrückliches `null`
   * hebt die jeweilige Grenze auf.
   */
  setUserLimits(
    actor: PermissionActor,
    userId: string,
    input: UserResourceLimitsInput,
  ): Promise<UserResourceLimitDto>;
  /** Kontingent vollständig aufheben – danach gilt für den Nutzer kein Limit. */
  clearUserLimits(actor: PermissionActor, userId: string): Promise<UserResourceLimitDto>;

  /**
   * **Prüf-Funktion für B3.** Beide Prüfungen aus Pflichtenheft §10, ohne zu
   * werfen – für Vorschauen (Erstellungs-Wizard) und Diagnose.
   */
  checkStartCapacity(request: StartCapacityRequest): Promise<CapacityCheckResult>;
  /**
   * Wie {@link ResourceService.checkStartCapacity}, wirft aber bei Ablehnung
   * einen {@link ResourceError} mit `RESOURCE_LIMIT_EXCEEDED`. Das ist der
   * Aufruf, den der Lifecycle-Befehl `START` in B3 nutzt.
   */
  assertStartCapacity(request: StartCapacityRequest): Promise<CapacityCheckResult>;

  /** Aktuelle Warnlage einer Node – für periodische Auswertung ohne Serverstart. */
  evaluateNodeState(nodeId: string, at?: Date): Promise<ResourceLowEvent[]>;
}

export interface ResourceServiceDependencies {
  readonly limits: UserResourceLimitRepository;
  readonly nodes: HostNodeRepository;
  /** Umsetzung kommt aus B3 (Tabelle `game_servers`) – siehe `ports.ts`. */
  readonly usage: ServerUsageRepository;
  readonly thresholds: ResourceWarningThresholds;
}

/** Teil-Update auf das gespeicherte Kontingent anwenden. */
function mergeLimits(
  current: UserResourceLimits,
  input: UserResourceLimitsInput,
): UserResourceLimits {
  return {
    maxRamMb: input.maxRamMb === undefined ? current.maxRamMb : (input.maxRamMb ?? null),
    maxCpuCores:
      input.maxCpuCores === undefined ? current.maxCpuCores : (input.maxCpuCores ?? null),
    maxDiskMb: input.maxDiskMb === undefined ? current.maxDiskMb : (input.maxDiskMb ?? null),
    maxConcurrentServers:
      input.maxConcurrentServers === undefined
        ? current.maxConcurrentServers
        : (input.maxConcurrentServers ?? null),
  };
}

export function createResourceService(deps: ResourceServiceDependencies): ResourceService {
  async function loadUserOrFail(userId: string): Promise<UserResourceLimitRecord> {
    const record = await deps.limits.findByUserId(userId);

    if (!record) {
      throw new ResourceError('USER_NOT_FOUND');
    }

    return record;
  }

  async function loadNodeOrFail(nodeId: string): Promise<HostNodeRecord> {
    const node = await deps.nodes.findById(nodeId);

    if (!node) {
      throw new ResourceError('NODE_NOT_FOUND');
    }

    return node;
  }

  async function toDto(
    actor: PermissionActor,
    record: UserResourceLimitRecord,
    isSelf: boolean,
  ): Promise<UserResourceLimitDto> {
    const usage = await deps.usage.usageForUser(record.userId);

    return {
      userId: record.userId,
      userDisplayName: record.userDisplayName,
      limits: record.limits,
      usage,
      updatedAt: record.updatedAt?.toISOString() ?? null,
      permissions: computeUserResourceLimitPermissions(actor, isSelf),
    };
  }

  function requireQuotaRead(actor: PermissionActor, isSelf: boolean): void {
    if (!isSelf && !hasPermission(actor, 'user.manage')) {
      throw new ResourceError('PERMISSION_DENIED');
    }
  }

  function requireQuotaWrite(actor: PermissionActor): void {
    if (!hasPermission(actor, 'user.manage')) {
      throw new ResourceError('PERMISSION_DENIED');
    }
  }

  async function buildCheckInput(request: StartCapacityRequest): Promise<CapacityCheckInput> {
    const node = await loadNodeOrFail(request.nodeId);
    const usageOptions = request.excludeServerId
      ? { excludeServerId: request.excludeServerId }
      : undefined;

    const [limitRecord, userUsage, nodeUsage] = await Promise.all([
      deps.limits.findByUserId(request.ownerId),
      deps.usage.usageForUser(request.ownerId, usageOptions),
      deps.usage.usageForNode(request.nodeId, usageOptions),
    ]);

    return {
      requested: request.requested,
      // Ein Konto ohne Kontingent-Datensatz verhält sich wie eines ohne Limits.
      // Die harte Node-Prüfung unten greift trotzdem.
      userLimits: limitRecord?.limits ?? NO_USER_RESOURCE_LIMITS,
      userUsage,
      node: { nodeId: node.id, total: node.totalResources, usage: nodeUsage },
      thresholds: deps.thresholds,
      ...(request.at ? { at: request.at } : {}),
    };
  }

  return {
    async getUserLimits(actor, userId, options) {
      const isSelf = options?.isSelf ?? false;
      requireQuotaRead(actor, isSelf);

      return toDto(actor, await loadUserOrFail(userId), isSelf);
    },

    async setUserLimits(actor, userId, input) {
      requireQuotaWrite(actor);

      const current = await loadUserOrFail(userId);
      const updated = await deps.limits.upsert(userId, mergeLimits(current.limits, input));

      if (!updated) {
        // Das Konto ist zwischen Lesen und Schreiben verschwunden.
        throw new ResourceError('USER_NOT_FOUND');
      }

      return toDto(actor, updated, false);
    },

    async clearUserLimits(actor, userId) {
      requireQuotaWrite(actor);

      const current = await loadUserOrFail(userId);
      await deps.limits.remove(userId);

      return toDto(actor, { ...current, limits: NO_USER_RESOURCE_LIMITS, updatedAt: null }, false);
    },

    async checkStartCapacity(request) {
      return checkCapacity(await buildCheckInput(request));
    },

    async assertStartCapacity(request) {
      const result = checkCapacity(await buildCheckInput(request));

      if (!result.allowed) {
        throw ResourceError.limitExceeded(result.violations);
      }

      return result;
    },

    async evaluateNodeState(nodeId, at) {
      const node = await loadNodeOrFail(nodeId);
      const usage = await deps.usage.usageForNode(nodeId);

      // Kein Start im Spiel: hier wird die tatsächliche, nicht die
      // hochgerechnete Belegung bewertet.
      return evaluateNodeWarnings({
        nodeId: node.id,
        total: node.totalResources,
        usage,
        thresholdPercent: deps.thresholds.nodePercent,
        ...(at ? { at } : {}),
      });
    },
  };
}
