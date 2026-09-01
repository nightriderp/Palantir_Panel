/**
 * Routen der Kontingent-Anfragen (Mockup-Abgleich 12.3.1).
 *
 * Zwei Seiten, zwei Präfixe: `/quota-requests` gehört dem angemeldeten Konto,
 * `/admin/quota-requests` dem Administrator. Bewusst getrennt – wer seine
 * eigene Anfrage stellt, braucht kein `user.manage`, und wer bescheidet, soll
 * das nicht versehentlich am eigenen Antrag tun können.
 */

import { type ApiResponse, type QuotaRequestDto, ok } from '@palantir/contracts';
import {
  createQuotaRequestInputSchema,
  decideQuotaRequestInputSchema,
  quotaRequestQuerySchema,
} from '@palantir/validation';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { replyWithErrorCode, requireActor, requirePermission } from '../rbac/index.js';
import { type QuotaRequestService } from './index.js';
import { isQuotaRequestError } from './errors.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export interface QuotaRequestRouteOptions {
  readonly service: QuotaRequestService;
  /** Konto des Aufrufers; `null`, wenn niemand angemeldet ist. */
  readonly actorUserId: (request: FastifyRequest) => string | null;
}

export function registerQuotaRequestRoutes(options: QuotaRequestRouteOptions) {
  return async function register(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        if (isQuotaRequestError(error)) {
          await replyWithErrorCode(reply, error.code, error.message);

          return undefined;
        }

        throw error;
      }
    }

    /** Konto des Aufrufers – ohne Anmeldung gibt es hier nichts zu tun. */
    function requireUserId(request: FastifyRequest): string {
      const userId = options.actorUserId(request);

      if (userId === null) {
        throw new Error('Diese Route setzt eine Anmeldung voraus.');
      }

      return userId;
    }

    // -- Eigene Anfragen ----------------------------------------------------

    app.post('/quota-requests', async (request, reply) =>
      handle<QuotaRequestDto>(reply, async () => {
        const input = createQuotaRequestInputSchema.parse(request.body ?? {});
        const userId = requireUserId(request);

        return options.service.create(requireActor(request), userId, input);
      }),
    );

    app.get('/quota-requests/mine', async (request, reply) =>
      handle<QuotaRequestDto[]>(reply, async () =>
        options.service.listOwn(requireActor(request), requireUserId(request)),
      ),
    );

    app.delete<{ Params: { id: string } }>('/quota-requests/:id', async (request, reply) =>
      handle<null>(reply, async () => {
        const { id } = idParamsSchema.parse(request.params);

        await options.service.withdraw(requireActor(request), requireUserId(request), id);

        return null;
      }),
    );

    // -- Bescheiden (Administration) ---------------------------------------

    app.get(
      '/admin/quota-requests',
      { preHandler: requirePermission('user.manage') },
      async (request, reply) =>
        handle<QuotaRequestDto[]>(reply, async () => {
          const query = quotaRequestQuerySchema.parse(request.query ?? {});

          return options.service.list(requireActor(request), query);
        }),
    );

    app.post<{ Params: { id: string } }>(
      '/admin/quota-requests/:id/approve',
      { preHandler: requirePermission('user.manage') },
      async (request, reply) =>
        handle<QuotaRequestDto>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);
          const input = decideQuotaRequestInputSchema.parse(request.body ?? {});

          return options.service.approve(
            requireActor(request),
            options.actorUserId(request),
            id,
            input,
          );
        }),
    );

    app.post<{ Params: { id: string } }>(
      '/admin/quota-requests/:id/reject',
      { preHandler: requirePermission('user.manage') },
      async (request, reply) =>
        handle<QuotaRequestDto>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);
          const input = decideQuotaRequestInputSchema.parse(request.body ?? {});

          return options.service.reject(
            requireActor(request),
            options.actorUserId(request),
            id,
            input,
          );
        }),
    );
  };
}
