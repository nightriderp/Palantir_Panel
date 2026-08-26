/**
 * REST-Routen der Server-Orchestrierung (Pflichtenheft §5).
 *
 * Alle Antworten laufen über `ok()`/`fail()` aus `@palantir/contracts` – der
 * Envelope wird nirgends von Hand gebaut (Pflichtenheft §5.1). Fehler tragen
 * benannte Codes aus dem Katalog; ein Freitext-Fehler kommt hier nicht vor
 * (CLAUDE.md §5).
 *
 * **Berechtigungen:** Der Zugriff läuft über den Guard aus B2
 * (`requirePermission`) für die grobe Schranke und über das `permissions`-Objekt
 * des DTOs für die feine – Letzteres ist die einzige Stelle, die die
 * Mitgliedsstufe kennt. Eine Route prüft deshalb nie selbst Rollen, sondern
 * fragt das berechnete Flag ab.
 */

import { type GameServerPermissions, fail, httpStatusForErrorCode, ok } from '@palantir/contracts';
import {
  cloneServerInputSchema,
  consoleCommandSchema,
  createServerInputSchema,
  updateServerSettingsInputSchema,
  serverMemberInputSchema,
} from '@palantir/validation';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireActor, requirePermission } from '../rbac/index.js';
import { type ServerDtoContext, toGameServerDto } from './dto.js';
import { ServerOrchestrationError, isServerOrchestrationError } from './errors.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerRepository } from './repository.js';
import { type ServerOrchestrationService } from './service.js';
import { checkSubdomain } from './subdomain.js';

export interface ServerRoutesOptions {
  readonly service: ServerOrchestrationService;
  readonly repository: ServerRepository;
  readonly registry: GameRegistry;
  readonly baseDomain: string;
}

const serverIdParamsSchema = z.object({ id: z.string().uuid() });
const memberParamsSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/** Antwortet mit dem Envelope aus §5.1 und dem HTTP-Status des Fehlercodes. */
async function replyWithError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isServerOrchestrationError(error)) {
    await reply.status(httpStatusForErrorCode(error.code)).send(fail(error.code, error.message));

    return;
  }

  throw error;
}

export function registerServerRoutes(app: FastifyInstance, options: ServerRoutesOptions): void {
  const { service, repository, registry, baseDomain } = options;

  /** Baut den DTO-Kontext eines Servers für den aktuellen Aufrufer. */
  async function dtoContext(request: FastifyRequest, serverId: string): Promise<ServerDtoContext> {
    const actor = requireActor(request);
    const viewerId = request.viewerUserId ?? null;
    const members = await repository.listMembers(serverId);

    return {
      actor,
      viewerId,
      viewerMemberLevel:
        viewerId === null
          ? null
          : (members.find((member) => member.userId === viewerId)?.level ?? null),
      memberCount: members.length,
      registry,
      baseDomain,
      recentCrashCount: 0,
    };
  }

  /**
   * Lädt einen Server und prüft ein Flag seines `permissions`-Objekts.
   *
   * Ein Server, den der Aufrufer nicht sehen darf, wird als `SERVER_NOT_FOUND`
   * gemeldet und nicht als `PERMISSION_DENIED`: Die Existenz eines fremden
   * Servers ist selbst schon eine Information.
   */
  async function loadAuthorized(
    request: FastifyRequest,
    serverId: string,
    flag: keyof GameServerPermissions,
  ) {
    const server = await service.requireServer(serverId);
    const context = await dtoContext(request, serverId);
    const dto = toGameServerDto(server, {
      ...context,
      recentCrashCount: service.recentCrashCount(server),
    });

    if (!dto.permissions.canView) {
      throw new ServerOrchestrationError('SERVER_NOT_FOUND', undefined, { serverId });
    }

    if (!dto.permissions[flag]) {
      throw new ServerOrchestrationError('PERMISSION_DENIED');
    }

    return { server, context, dto };
  }

  // -- Spiele-Registry (Pflichtenheft §11) ------------------------------------

  app.get('/api/game-types', async (request, reply) => {
    try {
      requireActor(request);

      return await reply.send(ok(registry.toDtoList()));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Serverliste und Detail --------------------------------------------------

  app.get('/api/servers', async (request, reply) => {
    try {
      const actor = requireActor(request);
      const viewerId = request.viewerUserId ?? null;

      // Wer alle Server sehen darf, bekommt alle; alle anderen ihre eigenen und
      // die, bei denen sie Mitglied sind. Die Feinprüfung macht danach das
      // `permissions`-Objekt je Server.
      const servers = actor.permissions.has('server.view.any')
        ? await repository.listAll()
        : viewerId === null
          ? []
          : await repository.listByOwnerOrMembership(viewerId);

      const dtos = [];

      for (const server of servers) {
        const context = await dtoContext(request, server.id);
        const dto = toGameServerDto(server, {
          ...context,
          recentCrashCount: service.recentCrashCount(server),
        });

        if (dto.permissions.canView) {
          dtos.push(dto);
        }
      }

      return await reply.send(ok(dtos));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/servers/:id', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(dto));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Subdomain-Prüfung (Pflichtenheft §13) -----------------------------------

  app.get('/api/servers/subdomain-check', async (request, reply) => {
    try {
      requireActor(request);

      const query = z.object({ subdomain: z.string() }).parse(request.query);
      const result = await checkSubdomain(query.subdomain, repository);

      return await reply.send(ok(result));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Anlegen, Ändern, Klonen, Löschen ---------------------------------------

  app.post(
    '/api/servers',
    { preHandler: requirePermission('server.create') },
    async (request, reply) => {
      try {
        const actor = requireActor(request);
        const viewerId = request.viewerUserId;

        if (viewerId === undefined || viewerId === null) {
          throw new ServerOrchestrationError('AUTH_REQUIRED');
        }

        void actor;

        const input = createServerInputSchema.parse(request.body);
        const server = await service.createServer(input, viewerId);
        const context = await dtoContext(request, server.id);

        return await reply.status(201).send(
          ok(
            toGameServerDto(server, {
              ...context,
              recentCrashCount: service.recentCrashCount(server),
            }),
          ),
        );
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

  app.patch('/api/servers/:id', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageSettings');

      const input = updateServerSettingsInputSchema.parse(request.body);
      const server = await service.updateServer(id, input);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/clone', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canClone');

      const input = cloneServerInputSchema.parse(request.body);
      const clone = await service.cloneServer(id, input, viewerId);
      const context = await dtoContext(request, clone.id);

      return await reply.status(201).send(
        ok(
          toGameServerDto(clone, {
            ...context,
            recentCrashCount: service.recentCrashCount(clone),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canDelete');
      await service.deleteServer(id);

      return await reply.send(ok(null));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Lifecycle (Pflichtenheft §9) -------------------------------------------

  app.post('/api/servers/:id/start', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canStart');

      const server = await service.startServer(id, viewerId);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/stop', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canStop');

      const server = await service.stopServer(id);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/restart', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canRestart');

      const server = await service.restartServer(id, viewerId);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Live-Daten, Konsole, Dateien -------------------------------------------

  app.get('/api/servers/:id/stats', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(await service.getStats(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/servers/:id/logs', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = z.object({ tail: z.coerce.number().int().positive().max(5_000).optional() });

      await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(await service.getLogs(id, query.parse(request.query).tail)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/console', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canUseConsole');

      const input = z.object({ command: consoleCommandSchema }).parse(request.body);

      return await reply.send(ok(await service.execConsole(id, input.command)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/servers/:id/files', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = z.object({ path: z.string().startsWith('/') }).parse(request.query);

      await loadAuthorized(request, id, 'canManageFiles');

      return await reply.send(ok(await service.listFiles(id, query.path)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Mitglieder (Lastenheft §3.3) -------------------------------------------

  app.get('/api/servers/:id/members', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageMembers');

      return await reply.send(ok(await repository.listMembers(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.put('/api/servers/:id/members', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      const { server } = await loadAuthorized(request, id, 'canManageMembers');
      const input = serverMemberInputSchema.parse(request.body);

      // Der Besitzer steht nicht in der Mitgliederliste – er hat ohnehin alle
      // Rechte, und ein Eintrag mit niedrigerer Stufe wäre irreführend.
      if (input.userId === server.ownerId) {
        throw new ServerOrchestrationError(
          'SERVER_STATE_CONFLICT',
          'Der Besitzer des Servers kann nicht als Mitglied eingetragen werden.',
        );
      }

      await repository.upsertMember(id, input.userId, input.level);

      return await reply.send(ok(await repository.listMembers(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id/members/:userId', async (request, reply) => {
    try {
      const { id, userId } = memberParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageMembers');
      await repository.removeMember(id, userId);

      return await reply.send(ok(await repository.listMembers(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });
}
