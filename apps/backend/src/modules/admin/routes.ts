/**
 * REST-Routen der Admin-Funktionen (B8).
 *
 * Alle Routen liegen unter `/admin` und antworten im Response-Envelope aus
 * Pflichtenheft §5.1 – geformt über `ok()`/`fail()` aus `@palantir/contracts`,
 * nie von Hand.
 *
 * Berechtigungen laufen doppelt: als `preHandler`-Guard aus B2 (schnelles
 * Ablehnen, bevor ein Handler läuft) und noch einmal im jeweiligen Service.
 * Die zweite Prüfung gilt auch für Aufrufer außerhalb des HTTP-Pfads, etwa die
 * Wartungs-Kommandos.
 *
 * Eingaben werden ausschließlich gegen die Zod-Schemas aus
 * `@palantir/validation` geprüft – kein zweiter, abweichender Regelsatz im
 * Backend.
 */

import { type ApiResponse, fail, httpStatusForErrorCode, ok } from '@palantir/contracts';
import {
  approveRegistrationRequestInputSchema,
  auditLogQuerySchema,
  blockRegistrationRequestInputSchema,
  createHostNodeInputSchema,
  createPortRangeInputSchema,
  deleteStorageEntryInputSchema,
  idSchema,
  registrationRequestQuerySchema,
  startStorageScanInputSchema,
  updateHostNodeInputSchema,
  updatePortRangeInputSchema,
} from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireActor, requireAnyPermission, requirePermission } from '../rbac/index.js';
import { archiveAuditEntries, type AuditArchiveDependencies } from './audit-archive.js';
import type { AuditService } from './audit.js';
import type { AdminContext } from './context.js';
import { AdminError, isAdminError } from './errors.js';
import type { HostNodeService } from './nodes.js';
import type { PortPoolService } from './ports.js';
import type { RegistrationRequestService } from './registration-requests.js';
import type { StorageExplorerService } from './storage.js';

export interface AdminRouteServices {
  readonly nodes: HostNodeService;
  readonly ports: PortPoolService;
  readonly audit: AuditService;
  readonly storage: StorageExplorerService;
  readonly registrationRequests: RegistrationRequestService;
  /**
   * Abhängigkeiten des Archivierungslaufs. Fehlen sie, antwortet der Endpunkt
   * mit `AUDIT_ARCHIVE_FAILED` – der Lauf braucht ein Archivverzeichnis.
   */
  readonly auditArchive?: AuditArchiveDependencies;
}

const nodeIdParamsSchema = z.object({ nodeId: idSchema });
const rangeIdParamsSchema = z.object({ rangeId: idSchema });
const allocationIdParamsSchema = z.object({ allocationId: idSchema });
const userIdParamsSchema = z.object({ userId: idSchema });

/**
 * Grobe Herkunft des Requests (Pflichtenheft §6, `Session.ipHint`).
 *
 * Bewusst gekürzt: Für die Nachvollziehbarkeit reicht das Netz, die vollständige
 * Adresse wäre mehr personenbezogene Angabe als nötig.
 */
export function ipHintOf(request: FastifyRequest): string | null {
  const ip = request.ip;

  if (!ip) {
    return null;
  }

  if (ip.includes('.')) {
    const parts = ip.split('.');

    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : ip;
  }

  // IPv6: die ersten vier Gruppen reichen zur groben Zuordnung.
  return `${ip.split(':').slice(0, 4).join(':')}::x`;
}

/**
 * Baut den Aufrufkontext.
 *
 * `userId` und `displayName` liefert B1 über die Sitzung. Solange das
 * Auth-Modul fehlt, bleiben beide `null` – der Eintrag im Audit-Log ist dann
 * ein Systemeintrag statt eines namentlichen. Die Route selbst kommt in dem
 * Zustand ohnehin nicht bis hierher, weil ohne Sitzung kein Actor existiert.
 */
export function contextFrom(request: FastifyRequest): AdminContext {
  return {
    actor: requireActor(request),
    userId: request.adminIdentity?.userId ?? null,
    displayName: request.adminIdentity?.displayName ?? null,
    ipHint: ipHintOf(request),
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Identität des angemeldeten Kontos für das Audit-Log. Wird von B1 gesetzt,
     * sobald das Auth-Modul steht; bis dahin bleibt sie leer.
     */
    adminIdentity?: { userId: string; displayName: string } | null;
  }
}

/** Verdichtet die Zod-Fehler zu einer lesbaren Meldung – ohne den Rohbaum auszuliefern. */
function describeValidationError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

/** Wandelt einen Fehler in den Envelope aus Pflichtenheft §5.1. */
async function replyWithError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isAdminError(error)) {
    await reply.status(httpStatusForErrorCode(error.code)).send(fail(error.code, error.message));

    return;
  }

  if (error instanceof z.ZodError) {
    await reply
      .status(httpStatusForErrorCode('VALIDATION_FAILED'))
      .send(fail('VALIDATION_FAILED', describeValidationError(error)));

    return;
  }

  throw error;
}

/**
 * Führt einen Handler aus und übersetzt {@link AdminError} sowie
 * Schema-Verletzungen in die passende Antwort. Alles andere geht an Fastifys
 * regulären Fehlerpfad – ein unerwarteter Fehler soll nicht als fachliche
 * Antwort getarnt werden.
 */
async function handle<T>(
  reply: FastifyReply,
  run: () => Promise<T>,
): Promise<ApiResponse<T> | undefined> {
  try {
    return ok(await run());
  } catch (error: unknown) {
    await replyWithError(reply, error);

    return undefined;
  }
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  services: AdminRouteServices,
): Promise<void> {
  // -- Nodes (Lastenheft §3.7) ----------------------------------------------

  app.get(
    '/admin/nodes',
    { preHandler: requireAnyPermission('node.view', 'node.manage') },
    async (request, reply) => handle(reply, () => services.nodes.list(contextFrom(request))),
  );

  app.get(
    '/admin/nodes/:nodeId',
    { preHandler: requireAnyPermission('node.view', 'node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { nodeId } = nodeIdParamsSchema.parse(request.params);

        return services.nodes.get(contextFrom(request), nodeId);
      }),
  );

  app.post(
    '/admin/nodes',
    { preHandler: requirePermission('node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const input = createHostNodeInputSchema.parse(request.body);

        return services.nodes.create(contextFrom(request), input);
      }),
  );

  app.patch(
    '/admin/nodes/:nodeId',
    { preHandler: requirePermission('node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { nodeId } = nodeIdParamsSchema.parse(request.params);
        const input = updateHostNodeInputSchema.parse(request.body);

        return services.nodes.update(contextFrom(request), nodeId, input);
      }),
  );

  app.delete(
    '/admin/nodes/:nodeId',
    { preHandler: requirePermission('node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { nodeId } = nodeIdParamsSchema.parse(request.params);
        await services.nodes.remove(contextFrom(request), nodeId);

        return null;
      }),
  );

  // -- Öffentlicher Port-Bereich (Pflichtenheft §2.4) ------------------------

  app.get(
    '/admin/addresses/ports',
    { preHandler: requirePermission('address.manage') },
    async (request, reply) => handle(reply, () => services.ports.getPool(contextFrom(request))),
  );

  app.post(
    '/admin/addresses/ranges',
    { preHandler: requirePermission('address.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const input = createPortRangeInputSchema.parse(request.body);

        return services.ports.createRange(contextFrom(request), input);
      }),
  );

  app.patch(
    '/admin/addresses/ranges/:rangeId',
    { preHandler: requirePermission('address.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { rangeId } = rangeIdParamsSchema.parse(request.params);
        const input = updatePortRangeInputSchema.parse(request.body);

        return services.ports.updateRange(contextFrom(request), rangeId, input);
      }),
  );

  app.delete(
    '/admin/addresses/ranges/:rangeId',
    { preHandler: requirePermission('address.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { rangeId } = rangeIdParamsSchema.parse(request.params);
        await services.ports.removeRange(contextFrom(request), rangeId);

        return null;
      }),
  );

  app.get(
    '/admin/addresses/allocations',
    { preHandler: requirePermission('address.manage') },
    async (request, reply) =>
      handle(reply, () => services.ports.listAllocations(contextFrom(request))),
  );

  app.delete(
    '/admin/addresses/allocations/:allocationId',
    { preHandler: requirePermission('address.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { allocationId } = allocationIdParamsSchema.parse(request.params);
        await services.ports.releaseAllocation(contextFrom(request), allocationId);

        return null;
      }),
  );

  // -- Audit-Log (Pflichtenheft §6) -----------------------------------------

  app.get('/admin/audit', { preHandler: requirePermission('audit.view') }, async (request, reply) =>
    handle(reply, async () => {
      const query = auditLogQuerySchema.parse(request.query);

      return services.audit.list(contextFrom(request), query);
    }),
  );

  /**
   * Archivierungslauf (Pflichtenheft §6).
   *
   * Es gibt hier bewusst **keinen** Endpunkt zum Ändern oder Löschen einzelner
   * Einträge – das Log ist append-only. Dieser Lauf ist der einzige Weg, auf
   * dem Einträge die aktive Tabelle verlassen, und er exportiert sie vorher
   * vollständig.
   *
   * Geschützt mit `audit.view`: Der Permission-Katalog kennt für das Log keine
   * zweite Berechtigung (Pflichtenheft §8), und eine neue einzuführen wäre eine
   * Katalog-Erweiterung außerhalb dieses Arbeitspakets.
   */
  app.post(
    '/admin/audit/archive',
    { preHandler: requirePermission('audit.view') },
    async (request, reply) =>
      handle(reply, async () => {
        if (!services.auditArchive) {
          throw new AdminError(
            'AUDIT_ARCHIVE_FAILED',
            'Für die Archivierung ist kein Archivverzeichnis konfiguriert (AUDIT_ARCHIVE_DIR in der zentralen .env).',
          );
        }

        return archiveAuditEntries(services.auditArchive, contextFrom(request).actor);
      }),
  );

  // -- Speicherverwaltung (Lastenheft §3.8, Pflichtenheft §16) ---------------

  app.get(
    '/admin/storage/:nodeId',
    { preHandler: requireAnyPermission('node.view', 'node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { nodeId } = nodeIdParamsSchema.parse(request.params);

        return services.storage.getSnapshot(contextFrom(request), nodeId);
      }),
  );

  app.post(
    '/admin/storage/:nodeId/scan',
    { preHandler: requirePermission('node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { nodeId } = nodeIdParamsSchema.parse(request.params);
        const input = startStorageScanInputSchema.parse(request.body ?? {});

        return services.storage.scan(contextFrom(request), nodeId, input);
      }),
  );

  /**
   * Einen Posten der Speicherübersicht entfernen.
   *
   * Aktive Server-Datenordner werden hier mit `STORAGE_ENTRY_NOT_DELETABLE`
   * abgelehnt – sie verschwinden ausschließlich über den dedizierten
   * Server-Löschen-Vorgang (Lastenheft §3.8).
   */
  app.delete(
    '/admin/storage/:nodeId/entries',
    { preHandler: requirePermission('node.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { nodeId } = nodeIdParamsSchema.parse(request.params);
        const { entryId } = deleteStorageEntryInputSchema.parse(request.body);

        return services.storage.deleteEntry(contextFrom(request), nodeId, entryId);
      }),
  );

  // -- Freischalt-Warteliste (Lastenheft §3.1 und §3.7) ---------------------

  app.get(
    '/admin/requests',
    { preHandler: requirePermission('user.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const query = registrationRequestQuerySchema.parse(request.query ?? {});

        return services.registrationRequests.list(contextFrom(request), query);
      }),
  );

  app.post(
    '/admin/requests/:userId/approve',
    { preHandler: requirePermission('user.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { userId } = userIdParamsSchema.parse(request.params);
        const input = approveRegistrationRequestInputSchema.parse(request.body ?? {});

        return services.registrationRequests.approve(contextFrom(request), userId, input);
      }),
  );

  app.post(
    '/admin/requests/:userId/block',
    { preHandler: requirePermission('user.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { userId } = userIdParamsSchema.parse(request.params);
        const input = blockRegistrationRequestInputSchema.parse(request.body ?? {});

        return services.registrationRequests.block(contextFrom(request), userId, input);
      }),
  );

  app.post(
    '/admin/requests/:userId/unblock',
    { preHandler: requirePermission('user.manage') },
    async (request, reply) =>
      handle(reply, async () => {
        const { userId } = userIdParamsSchema.parse(request.params);

        return services.registrationRequests.unblock(contextFrom(request), userId);
      }),
  );
}
