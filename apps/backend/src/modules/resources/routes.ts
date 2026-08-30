/**
 * REST-Routen der Nutzer-Kontingente (Pflichtenheft §10, Lastenheft §3.4 und
 * §3.7, WORK_STATUS.md Gefundener Punkt 88) sowie des eigenen Kontingents
 * (`GET /me/resource-quota`, Arbeitspaket P6).
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
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  RbacError,
  isRbacError,
  replyWithErrorCode,
  requireActor,
  requirePermission,
} from '../rbac/index.js';
import { isResourceError } from './errors.js';
import type { ResourceService } from './service.js';

const userIdParamsSchema = z.object({ userId: idSchema });

export interface ResourceRoutesOptions {
  /** Bestehender Ressourcen-Service aus B4 – hier nur an HTTP gehängt. */
  readonly resourceLimits: ResourceService;
  /**
   * Konto des Aufrufers für `GET /me/resource-quota`.
   *
   * Dieselbe Aufteilung wie bei `resolveViewerId` in B3 und `resolveUserId` in
   * B5/B6: Das Modul, das die Sitzung kennt (B1), liefert den Wert. Ohne Angabe
   * greift die Voreinstellung `request.authUser?.id ?? null` – genau die
   * Funktion, die `server.ts` den übrigen Modulen ohnehin übergibt. Läuft das
   * Auth-Modul nicht, gilt jeder Aufruf als nicht angemeldet und die Route
   * antwortet mit `AUTH_REQUIRED`.
   */
  readonly resolveUserId?: (request: FastifyRequest) => string | null;
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
  const resolveUserId = options.resolveUserId ?? ((request) => request.authUser?.id ?? null);

  return async function resourceRoutes(app: FastifyInstance): Promise<void> {
    // -- Eigenes Kontingent (Arbeitspaket P6) --------------------------------

    /*
     * Kontingent des angemeldeten Nutzers – die Übersicht, die der
     * Erstellungs-Wizard (F3) vor dem Anlegen eines Servers zeigt.
     *
     * Kein `requirePermission`-Guard: das eigene Kontingent darf jedes
     * angemeldete Konto sehen. Geprüft wird nur, dass überhaupt eine Sitzung
     * dahintersteht – `requireActor()` und die fehlende Konto-Id enden beide in
     * `AUTH_REQUIRED` (401).
     */
    app.get(
      '/me/resource-quota',
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const actor = requireActor(request);
          const userId = resolveUserId(request);

          if (!userId) {
            throw new RbacError('AUTH_REQUIRED');
          }

          return ok(await resourceLimits.getOwnQuota(actor, userId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

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
