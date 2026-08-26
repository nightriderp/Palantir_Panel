/**
 * REST-Routen der Notification-Engine (Pflichtenheft §5).
 *
 * Jede Antwort nutzt den Response-Envelope aus §5.1 über `ok()`/`fail()` aus
 * `@palantir/contracts` – kein lokal geformtes Format (CLAUDE.md §3).
 *
 * Zwei verschiedene Zugänge, bewusst getrennt:
 *
 * - **Verwaltung** (Kanäle, Regeln, Ankündigungen, Zustellungsprotokoll):
 *   Permission `notification.manage` aus dem Katalog (Pflichtenheft §8), über
 *   `requirePermission` gesperrt.
 * - **Inbox**: braucht keine Permission, sondern eine Sitzung. Sie gehört dem
 *   Empfänger; die Zuordnung macht der Service über die Konto-Id, nicht über
 *   Rechte.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import {
  createAnnouncementInputSchema,
  createNotificationChannelInputSchema,
  createNotificationRuleInputSchema,
  markNotificationsReadInputSchema,
  notificationQuerySchema,
  updateAnnouncementInputSchema,
  updateNotificationChannelInputSchema,
  updateNotificationRuleInputSchema,
} from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isRbacError, replyWithErrorCode, requireActor, requirePermission } from '../rbac/index.js';
import { NotificationError, isNotificationError } from './errors.js';
import type { NotificationService } from './service.js';

const channelParamsSchema = z.object({ channelId: z.string().uuid() });
const ruleParamsSchema = z.object({ ruleId: z.string().uuid() });
const announcementParamsSchema = z.object({ announcementId: z.string().uuid() });
const notificationParamsSchema = z.object({ notificationId: z.string().uuid() });
const deliveryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export interface NotificationRoutesOptions {
  readonly notifications: NotificationService;
  /**
   * Konto-Id des Aufrufers (Arbeitspaket B1).
   *
   * Getrennt vom `PermissionActor`, weil dieser bewusst nur Rechte kennt und
   * keine Identität – die Inbox braucht aber genau die Identität.
   */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Wandelt einen Modulfehler in die Antwort aus Pflichtenheft §5.1.
 *
 * Ungültige Pfad-, Query- oder Körperwerte werden zu `VALIDATION_FAILED` – auch
 * dafür gilt: benannter Code, kein Freitext (CLAUDE.md §5). Alles Übrige wird
 * weitergeworfen; ein unerwarteter Fehler soll nicht als fachliche Ablehnung
 * erscheinen.
 */
async function handleError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isNotificationError(error) || isRbacError(error)) {
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

export function registerNotificationRoutes(options: NotificationRoutesOptions) {
  const { notifications } = options;

  return async function notificationRoutes(app: FastifyInstance): Promise<void> {
    /** Konto-Id des Aufrufers; `AUTH_REQUIRED`, wenn niemand angemeldet ist. */
    function userIdOf(request: FastifyRequest): string {
      const userId = options.resolveUserId(request);

      if (userId === null) {
        throw new NotificationError('AUTH_REQUIRED');
      }

      return userId;
    }

    // -- Inbox des angemeldeten Kontos --------------------------------------

    app.get(
      '/notifications',
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const query = notificationQuerySchema.parse(request.query ?? {});

          return ok(await notifications.listInbox(userIdOf(request), query));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/notifications/read',
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const input = markNotificationsReadInputSchema.parse(request.body ?? {});
          const changed = await notifications.markRead(userIdOf(request), input);

          return ok({ changed });
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.delete(
      '/notifications/:notificationId',
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { notificationId } = notificationParamsSchema.parse(request.params);

          await notifications.deleteNotification(userIdOf(request), notificationId);

          return ok({ deleted: true });
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Kanäle (Admin) ------------------------------------------------------

    app.get(
      '/admin/notification-channels',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          return ok(await notifications.listChannels(requireActor(request)));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/admin/notification-channels',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const input = createNotificationChannelInputSchema.parse(request.body ?? {});
          const channel = await notifications.createChannel(
            requireActor(request),
            options.resolveUserId(request),
            input,
          );

          reply.status(201);

          return ok(channel);
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.patch(
      '/admin/notification-channels/:channelId',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { channelId } = channelParamsSchema.parse(request.params);
          const input = updateNotificationChannelInputSchema.parse(request.body ?? {});

          return ok(
            await notifications.updateChannel(
              requireActor(request),
              options.resolveUserId(request),
              channelId,
              input,
            ),
          );
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.delete(
      '/admin/notification-channels/:channelId',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { channelId } = channelParamsSchema.parse(request.params);

          await notifications.deleteChannel(
            requireActor(request),
            options.resolveUserId(request),
            channelId,
          );

          return ok({ deleted: true });
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    /**
     * Testnachricht.
     *
     * Der einzige Weg, auf dem ein Zustellfehler den Aufrufer erreicht
     * (`NOTIFICATION_DELIVERY_FAILED`, 502): Hier hat jemand den Versand
     * ausdrücklich angestoßen und will wissen, ob der Kanal funktioniert.
     */
    app.post(
      '/admin/notification-channels/:channelId/test',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { channelId } = channelParamsSchema.parse(request.params);

          await notifications.testChannel(channelId);

          return ok({ delivered: true });
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Regeln (Admin) ------------------------------------------------------

    app.get(
      '/admin/notification-rules',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          return ok(await notifications.listRules(requireActor(request)));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/admin/notification-rules',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const input = createNotificationRuleInputSchema.parse(request.body ?? {});
          const rule = await notifications.createRule(
            requireActor(request),
            options.resolveUserId(request),
            input,
          );

          reply.status(201);

          return ok(rule);
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.patch(
      '/admin/notification-rules/:ruleId',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { ruleId } = ruleParamsSchema.parse(request.params);
          const input = updateNotificationRuleInputSchema.parse(request.body ?? {});

          return ok(
            await notifications.updateRule(
              requireActor(request),
              options.resolveUserId(request),
              ruleId,
              input,
            ),
          );
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.delete(
      '/admin/notification-rules/:ruleId',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { ruleId } = ruleParamsSchema.parse(request.params);

          await notifications.deleteRule(
            requireActor(request),
            options.resolveUserId(request),
            ruleId,
          );

          return ok({ deleted: true });
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Systemweite Ankündigungen (Admin) -----------------------------------

    app.get(
      '/admin/announcements',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          return ok(await notifications.listAnnouncements(requireActor(request)));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/admin/announcements',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const input = createAnnouncementInputSchema.parse(request.body ?? {});
          const announcement = await notifications.publishAnnouncement(
            requireActor(request),
            options.resolveUserId(request),
            input,
          );

          reply.status(201);

          return ok(announcement);
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.patch(
      '/admin/announcements/:announcementId',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { announcementId } = announcementParamsSchema.parse(request.params);
          const input = updateAnnouncementInputSchema.parse(request.body ?? {});

          return ok(
            await notifications.updateAnnouncement(
              requireActor(request),
              options.resolveUserId(request),
              announcementId,
              input,
            ),
          );
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.delete(
      '/admin/announcements/:announcementId',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { announcementId } = announcementParamsSchema.parse(request.params);

          await notifications.deleteAnnouncement(
            requireActor(request),
            options.resolveUserId(request),
            announcementId,
          );

          return ok({ deleted: true });
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Zustellungsprotokoll (Admin) ----------------------------------------

    /**
     * Macht sichtbar, was sonst still bliebe: Eine gescheiterte Zustellung
     * lässt den auslösenden Vorgang bewusst weiterlaufen (Pflichtenheft §14) –
     * ohne diese Ansicht wüsste niemand davon.
     */
    app.get(
      '/admin/notification-deliveries',
      { preHandler: requirePermission('notification.manage') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { limit } = deliveryQuerySchema.parse(request.query ?? {});

          return ok(await notifications.listDeliveries(limit));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );
  };
}
