/**
 * Routen der Panel-Sicherungen (Mockup-Abgleich 12.5.1 und 12.5.2).
 *
 * Alles unter `/admin`, alles hinter `backup.manage.any`: Ein Abzug der
 * Panel-Datenbank ist die Instanz im Ganzen, nicht die Sicherung eines
 * einzelnen Servers.
 *
 * Bewusst **ohne** Download-Route – der Abzug enthält jedes Konto und jedes
 * Geheimnis der Instanz. Der Ablageort steht in der Antwort, geholt wird die
 * Datei über denselben Weg, über den die VPS auch sonst verwaltet wird.
 */

import { type ApiResponse, type PanelBackupDto, ok } from '@palantir/contracts';
import { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';
import { replyWithErrorCode, requireActor, requirePermission } from '../rbac/index.js';
import { type PanelBackupService } from './index.js';
import { isPanelBackupError } from './errors.js';

const idParamsSchema = z.object({ id: z.string().uuid() });

export interface PanelBackupRouteOptions {
  readonly service: PanelBackupService;
}

export function registerPanelBackupRoutes(options: PanelBackupRouteOptions) {
  return async function register(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        if (isPanelBackupError(error)) {
          await replyWithErrorCode(reply, error.code, error.message);

          return undefined;
        }

        throw error;
      }
    }

    app.get(
      '/admin/panel-backups',
      { preHandler: requirePermission('backup.manage.any') },
      async (request, reply) =>
        handle<PanelBackupDto[]>(reply, async () => options.service.list(requireActor(request))),
    );

    app.post(
      '/admin/panel-backups',
      { preHandler: requirePermission('backup.manage.any') },
      async (request, reply) =>
        handle<PanelBackupDto>(reply, async () =>
          options.service.start(requireActor(request), 'manual'),
        ),
    );

    app.delete<{ Params: { id: string } }>(
      '/admin/panel-backups/:id',
      { preHandler: requirePermission('backup.manage.any') },
      async (request, reply) =>
        handle<null>(reply, async () => {
          const { id } = idParamsSchema.parse(request.params);

          await options.service.remove(requireActor(request), id);

          return null;
        }),
    );
  };
}
