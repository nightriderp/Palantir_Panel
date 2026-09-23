/**
 * HTTP-Routen der Spiel-Wünsche.
 *
 * Schnitt wie bei den Kontingent-Anfragen: Was ein Konto mit dem eigenen
 * Wunsch tut, liegt unter `/game-requests`; was der Betreiber damit tut, unter
 * `/admin/game-requests` hinter `user.manage`.
 */

import { type ApiResponse, type GameRequestDto, ok } from '@palantir/contracts';
import {
  createGameRequestInputSchema,
  decideGameRequestInputSchema,
  gameRequestQuerySchema,
} from '@palantir/validation';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountRateLimit } from '../../lib/abuse-limits.js';
import { toIpHint } from '../auth/request-context.js';
import {
  RbacError,
  isRbacError,
  replyWithErrorCode,
  requireActor,
  requireApproved,
  requirePermission,
} from '../rbac/index.js';
import { type GameRequestService } from './index.js';
import { isGameRequestError } from './errors.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export interface GameRequestRouteOptions {
  readonly service: GameRequestService;
  readonly actorUserId: (request: FastifyRequest) => string | null;
}

export function registerGameRequestRoutes(options: GameRequestRouteOptions) {
  const createLimit = accountRateLimit({
    scope: 'game.request',
    resolveUserId: (request) => options.actorUserId(request),
  });

  return async function register(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        if (isGameRequestError(error) || isRbacError(error)) {
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

    app.post(
      '/game-requests',
      { preHandler: [requireApproved(), createLimit] },
      async (request, reply) =>
        handle<GameRequestDto>(reply, async () => {
          const input = createGameRequestInputSchema.parse(request.body ?? {});
          const userId = requireUserId(request);

          return options.service.create(requireActor(request), userId, input);
        }),
    );

    app.get('/game-requests/mine', { preHandler: requireApproved() }, async (request, reply) =>
      handle<GameRequestDto[]>(reply, async () =>
        options.service.listOwn(requireActor(request), requireUserId(request)),
      ),
    );

    app.delete<{ Params: { id: string } }>(
      '/game-requests/:id',
      { preHandler: requireApproved() },
      async (request, reply) =>
        handle<null>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);

          await options.service.withdraw(requireActor(request), requireUserId(request), id);

          return null;
        }),
    );

    // -- Bescheiden (Administration) ---------------------------------------

    app.get(
      '/admin/game-requests',
      { preHandler: requirePermission('gametype.manage') },
      async (request, reply) =>
        handle<GameRequestDto[]>(reply, async () => {
          const query = gameRequestQuerySchema.parse(request.query ?? {});

          return options.service.list(requireActor(request), query);
        }),
    );

    app.post<{ Params: { id: string } }>(
      '/admin/game-requests/:id/approve',
      { preHandler: requirePermission('gametype.manage') },
      async (request, reply) =>
        handle<GameRequestDto>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);
          const input = decideGameRequestInputSchema.parse(request.body ?? {});

          return options.service.approve(
            requireActor(request),
            options.actorUserId(request),
            id,
            input,
            { ipHint: toIpHint(request.ip) },
          );
        }),
    );

    app.post<{ Params: { id: string } }>(
      '/admin/game-requests/:id/reject',
      { preHandler: requirePermission('gametype.manage') },
      async (request, reply) =>
        handle<GameRequestDto>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);
          const input = decideGameRequestInputSchema.parse(request.body ?? {});

          return options.service.reject(
            requireActor(request),
            options.actorUserId(request),
            id,
            input,
            { ipHint: toIpHint(request.ip) },
          );
        }),
    );
  };
}
