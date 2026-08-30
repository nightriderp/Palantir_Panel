/**
 * REST-Routen der Nutzer-Kontingente (Pflichtenheft §10, Lastenheft §3.4 und
 * §3.7, WORK_STATUS.md Gefundener Punkt 88).
 *
 * Bis hierher hatte der `ResourceService` (B4) zwar `getUserLimits`/
 * `setUserLimits`/`clearUserLimits`, aber keine HTTP-Route – die
 * Kontingent-Verwaltung in F10 hatte deshalb keinen Endpunkt. Diese drei Routen
 * hängen den bestehenden Service an `/admin/users/:userId/limits`, ohne eine
 * zweite Kontingent-Logik zu bauen (CLAUDE.md §3).
 *
 * Wie in den übrigen Modulen läuft die Berechtigung doppelt: der
 * `preHandler`-Guard aus B2 (`user.manage`) lehnt früh ab, der Service prüft
 * dieselbe Permission noch einmal selbst – die Regel gilt damit auch für
 * Aufrufer außerhalb des HTTP-Pfads.
 *
 * Jede Antwort nutzt den Response-Envelope aus §5.1 über `ok()`/`fail()`
 * (`replyWithErrorCode`) – kein lokal geformtes Format.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import { idSchema, userResourceLimitsInputSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { isRbacError, replyWithErrorCode, requireActor, requirePermission } from '../rbac/index.js';
import { isResourceError } from './errors.js';
import type { ResourceService } from './service.js';

const userIdParamsSchema = z.object({ userId: idSchema });

export interface ResourceRoutesOptions {
  /** Bestehender Ressourcen-Service aus B4 – hier nur an HTTP gehängt. */
  readonly resourceLimits: ResourceService;
}

/**
 * Wandelt einen Modulfehler in die Antwort aus Pflichtenheft §5.1.
 *
 * {@link ResourceError} (`USER_NOT_FOUND`, `PERMISSION_DENIED`, …) trägt
 * denselben Code-Katalog wie {@link RbacError}; beide werden als fachliche
 * Antwort ausgeliefert. Ungültige Eingaben werden zu `VALIDATION_FAILED`. Alles
 * Übrige wird weitergeworfen und landet im allgemeinen Fehlerpfad – ein
 * unerwarteter Fehler soll nicht als fachliche Ablehnung erscheinen.
 */
async function handleError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isResourceError(error) || isRbacError(error)) {
    await replyWithErrorCode(reply, error.code, error.message);

    return;
  }

  if (error instanceof z.ZodError) {
    await replyWithErrorCode(
      reply,
      'VALIDATION_FAILED',
      error.issues
        .map((issue) => `${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`)
        .join('; '),
    );

    return;
  }

  throw error;
}

export function registerResourceRoutes(options: ResourceRoutesOptions) {
  const { resourceLimits } = options;

  return async function resourceRoutes(app: FastifyInstance): Promise<void> {
    // -- Nutzer-Kontingente (Lastenheft §3.7) --------------------------------

    app.get(
      '/admin/users/:userId/limits',
      { preHandler: requirePermission('user.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { userId } = userIdParamsSchema.parse(request.params);

          return ok(await resourceLimits.getUserLimits(requireActor(request), userId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    /*
     * Teil-Update: nicht genannte Felder bleiben stehen, ausdrückliches `null`
     * hebt die jeweilige Grenze auf. `PUT`, weil derselbe Körper zum selben
     * Zielzustand führt (idempotent) – der Merge steckt im Service.
     */
    app.put(
      '/admin/users/:userId/limits',
      { preHandler: requirePermission('user.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { userId } = userIdParamsSchema.parse(request.params);
          const input = userResourceLimitsInputSchema.parse(request.body ?? {});

          return ok(await resourceLimits.setUserLimits(requireActor(request), userId, input));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    /* Kontingent vollständig aufheben – danach gilt für den Nutzer kein Limit. */
    app.delete(
      '/admin/users/:userId/limits',
      { preHandler: requirePermission('user.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { userId } = userIdParamsSchema.parse(request.params);

          return ok(await resourceLimits.clearUserLimits(requireActor(request), userId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );
  };
}
