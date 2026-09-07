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
import { accountRateLimit } from '../../lib/abuse-limits.js';
import {
  RbacError,
  isRbacError,
  replyWithErrorCode,
  requireActor,
  requireApproved,
  requirePermission,
} from '../rbac/index.js';
import { type QuotaRequestService } from './index.js';
import { isQuotaRequestError } from './errors.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export interface QuotaRequestRouteOptions {
  readonly service: QuotaRequestService;
  /** Konto des Aufrufers; `null`, wenn niemand angemeldet ist. */
  readonly actorUserId: (request: FastifyRequest) => string | null;
}

export function registerQuotaRequestRoutes(options: QuotaRequestRouteOptions) {
  /*
   * Missbrauchsgrenze je Konto (Audit W2-3, `security-matrix-05`).
   *
   * Eine Kontingent-Anfrage wird von Hand beschieden; sie in Schleife zu
   * stellen füllt die Warteliste der Administratoren. Der Zähler entsteht
   * einmal je Registrierung, nicht je Request.
   */
  const createLimit = accountRateLimit({
    scope: 'quota.request',
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
        // `RbacError` gehört mit hierher: `requireActor`/`requireUserId` werfen
        // ihn, und ohne diese Übersetzung antwortete erst der globale Handler –
        // mit derselben 401, aber als „nicht abgefangen" im Log.
        if (isQuotaRequestError(error) || isRbacError(error)) {
          await replyWithErrorCode(reply, error.code, error.message);

          return undefined;
        }

        throw error;
      }
    }

    /**
     * Konto des Aufrufers – ohne Anmeldung gibt es hier nichts zu tun.
     *
     * Benannter Code statt eines nackten `Error` (CLAUDE.md §5): Sonst hängt es
     * an der Auswertungsreihenfolge der Argumente, ob ein anonymer Aufruf als
     * `AUTH_REQUIRED` (401) oder als `INTERNAL_ERROR` (500) endet
     * (backend-admin-resources-05).
     */
    function requireUserId(request: FastifyRequest): string {
      const userId = options.actorUserId(request);

      if (userId === null) {
        throw new RbacError('AUTH_REQUIRED');
      }

      return userId;
    }

    // -- Eigene Anfragen ----------------------------------------------------

    /*
     * `requireApproved()` statt bloßer Anmeldung: Ein noch nicht freigeschaltetes
     * Konto soll „keinerlei Zugriff auf Funktionen" haben (Lastenheft §3.1). Ohne
     * den Guard könnte es die Warteliste der Administratoren mit Kontingent-
     * Wünschen füllen, obwohl es noch keinen einzigen Server anlegen darf
     * (security-matrix-06).
     */
    app.post(
      '/quota-requests',
      // Erst die Freischaltung, dann der Zähler: Ein Konto in der Warteliste
      // kommt gar nicht so weit, dass es ein Kontingent verbrauchen könnte.
      { preHandler: [requireApproved(), createLimit] },
      async (request, reply) =>
        handle<QuotaRequestDto>(reply, async () => {
          const input = createQuotaRequestInputSchema.parse(request.body ?? {});
          const userId = requireUserId(request);

          return options.service.create(requireActor(request), userId, input);
        }),
    );

    app.get('/quota-requests/mine', { preHandler: requireApproved() }, async (request, reply) =>
      handle<QuotaRequestDto[]>(reply, async () =>
        options.service.listOwn(requireActor(request), requireUserId(request)),
      ),
    );

    app.delete<{ Params: { id: string } }>(
      '/quota-requests/:id',
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
