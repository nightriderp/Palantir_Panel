/**
 * HTTP-Routen der eigenen Profile (Idee P / A2, 26.09.2026).
 *
 * Alles unter `/user-presets`, alles nur für das eigene Konto: Die Konto-Id
 * kommt aus der Sitzung, nie aus dem Pfad. Kein eigenes Recht – wer das Panel
 * nutzen darf, darf sich Profile merken (`requireApproved`). Ob jemand die
 * Werte an einem Server auch anwenden darf, prüft die Steuerung selbst.
 */

import { type ApiResponse, type UserPresetDto, ok } from '@palantir/contracts';
import {
  createUserPresetInputSchema,
  updateUserPresetInputSchema,
  userPresetQuerySchema,
} from '@palantir/validation';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RbacError, isRbacError, replyWithErrorCode, requireApproved } from '../rbac/index.js';
import { type UserPresetService } from './index.js';
import { isUserPresetError } from './errors.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export interface UserPresetRouteOptions {
  readonly service: UserPresetService;
  readonly actorUserId: (request: FastifyRequest) => string | null;
}

export function registerUserPresetRoutes(options: UserPresetRouteOptions) {
  return async function register(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        if (isUserPresetError(error) || isRbacError(error)) {
          await replyWithErrorCode(reply, error.code, error.message);

          return undefined;
        }

        throw error;
      }
    }

    function requireUserId(request: FastifyRequest): string {
      const userId = options.actorUserId(request);

      if (userId === null) {
        throw new RbacError('AUTH_REQUIRED');
      }

      return userId;
    }

    app.get('/user-presets', { preHandler: requireApproved() }, async (request, reply) =>
      handle<UserPresetDto[]>(reply, async () => {
        const query = userPresetQuerySchema.parse(request.query ?? {});

        return options.service.listOwn(requireUserId(request), query);
      }),
    );

    app.post('/user-presets', { preHandler: requireApproved() }, async (request, reply) =>
      handle<UserPresetDto>(reply, async () => {
        const input = createUserPresetInputSchema.parse(request.body ?? {});

        return options.service.create(requireUserId(request), input);
      }),
    );

    app.patch<{ Params: { id: string } }>(
      '/user-presets/:id',
      { preHandler: requireApproved() },
      async (request, reply) =>
        handle<UserPresetDto>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);
          const input = updateUserPresetInputSchema.parse(request.body ?? {});

          return options.service.update(requireUserId(request), id, input);
        }),
    );

    app.delete<{ Params: { id: string } }>(
      '/user-presets/:id',
      { preHandler: requireApproved() },
      async (request, reply) =>
        handle<null>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);

          await options.service.remove(requireUserId(request), id);

          return null;
        }),
    );
  };
}
