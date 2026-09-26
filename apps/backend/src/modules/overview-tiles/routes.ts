/**
 * Routen der Übersichts-Kacheln ohne Server.
 *
 * Lesen darf jedes freigeschaltete Konto: Die Kacheln stehen in der Übersicht,
 * für alle dieselben. Anlegen, Ändern und Entfernen verlangen `instance.manage`
 * – sie gehören zum Erscheinungsbild der Instanz, wie Schriften und Farbschema.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import {
  createOverviewTileInputSchema,
  overviewTileParamsSchema,
  updateOverviewTileInputSchema,
} from '@palantir/validation';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  isRbacError,
  replyWithErrorCode,
  requireActor,
  requireApproved,
  requirePermission,
} from '../rbac/index.js';
import { type OverviewTileService, isOverviewTileError } from './index.js';

export interface OverviewTileRouteOptions {
  readonly service: OverviewTileService;
  readonly actorUserId: (request: FastifyRequest) => string | null;
}

export function registerOverviewTileRoutes(options: OverviewTileRouteOptions) {
  return async function register(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        if (isOverviewTileError(error) || isRbacError(error)) {
          await replyWithErrorCode(reply, error.code, error.message);

          return undefined;
        }

        if (error instanceof z.ZodError) {
          await replyWithErrorCode(
            reply,
            'VALIDATION_FAILED',
            error.issues
              .map((issue) => `${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`)
              .join('; '),
          );

          return undefined;
        }

        throw error;
      }
    }

    app.get('/api/overview-tiles', { preHandler: requireApproved() }, async (request, reply) =>
      handle(reply, () => options.service.list(requireActor(request))),
    );

    app.post(
      '/api/admin/overview-tiles',
      { preHandler: requirePermission('instance.manage') },
      async (request, reply) =>
        handle(reply, async () => {
          const input = createOverviewTileInputSchema.parse(request.body ?? {});
          const tile = await options.service.create(
            requireActor(request),
            options.actorUserId(request),
            input,
          );

          reply.status(201);

          return tile;
        }),
    );

    app.patch<{ Params: { tileId: string } }>(
      '/api/admin/overview-tiles/:tileId',
      { preHandler: requirePermission('instance.manage') },
      async (request, reply) =>
        handle(reply, async () => {
          const { tileId } = overviewTileParamsSchema.parse(request.params);
          const input = updateOverviewTileInputSchema.parse(request.body ?? {});

          return options.service.update(requireActor(request), tileId, input);
        }),
    );

    app.delete<{ Params: { tileId: string } }>(
      '/api/admin/overview-tiles/:tileId',
      { preHandler: requirePermission('instance.manage') },
      async (request, reply) =>
        handle<null>(reply, async () => {
          const { tileId } = overviewTileParamsSchema.parse(request.params);

          await options.service.remove(tileId);

          return null;
        }),
    );
  };
}
