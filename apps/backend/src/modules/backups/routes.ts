/**
 * REST-Routen der Backup-Verwaltung (Pflichtenheft §5).
 *
 * Jede Antwort nutzt den Response-Envelope aus §5.1 über `ok()`/`fail()` aus
 * `@palantir/contracts` – kein lokal geformtes Format (CLAUDE.md §3). Der
 * Guard `requirePermission` sperrt den groben Zugang; die feine Prüfung
 * (`.own`/`.any` an der konkreten Ressource) macht der Service, damit sie auch
 * für Aufrufer außerhalb des HTTP-Pfads gilt.
 *
 * Einzige Ausnahme vom Envelope ist der Download: Er liefert die Bytes des
 * Archivs, keinen JSON-Körper. Fehler **vor** dem ersten Block kommen weiterhin
 * als Envelope; reißt die Übertragung mittendrin ab, bleibt nur der Abbruch der
 * Verbindung – ein halb geschriebener Datei-Body lässt sich nicht mehr in eine
 * JSON-Antwort verwandeln.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import {
  backupOverviewQuerySchema,
  createBackupInputSchema,
  createServerExportInputSchema,
  updateBackupScheduleInputSchema,
} from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isRbacError, replyWithErrorCode, requireActor, requirePermission } from '../rbac/index.js';
import { BackupError, isBackupError, isScheduleError } from './errors.js';
import type { BackupScheduleService } from './schedules.js';
import type { BackupService } from './service.js';

const serverParamsSchema = z.object({ serverId: z.string().uuid() });
const backupParamsSchema = z.object({ backupId: z.string().uuid() });
const ownerParamsSchema = z.object({ userId: z.string().uuid() });

export interface BackupRoutesOptions {
  readonly backups: BackupService;
  readonly schedules: BackupScheduleService;
  /**
   * Id des angemeldeten Kontos zu einem Request (Arbeitspaket B1).
   *
   * Getrennt vom `PermissionActor`, weil dieser bewusst nur Rechte kennt und
   * keine Identität – die `.own`-Prüfung braucht aber beides.
   */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Wandelt einen Modulfehler in die Antwort aus Pflichtenheft §5.1.
 *
 * Ungültige Pfad-, Query- oder Körperwerte werden zu `VALIDATION_FAILED` – auch
 * dafür gilt: benannter Code, kein Freitext (CLAUDE.md §5). Alles Übrige wird
 * weitergeworfen und landet im allgemeinen Fehlerpfad der Anwendung; ein
 * unerwarteter Fehler soll nicht als fachliche Ablehnung erscheinen.
 */
async function handleError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isBackupError(error) || isScheduleError(error) || isRbacError(error)) {
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

export function registerBackupRoutes(options: BackupRoutesOptions) {
  const { backups, schedules } = options;

  return async function backupRoutes(app: FastifyInstance): Promise<void> {
    /** Konto-Id des Aufrufers; `AUTH_REQUIRED`, wenn niemand angemeldet ist. */
    function userIdOf(request: FastifyRequest): string {
      const userId = options.resolveUserId(request);

      if (userId === null) {
        throw new BackupError('AUTH_REQUIRED');
      }

      return userId;
    }

    // -- Backups eines Servers ---------------------------------------------

    app.get(
      '/servers/:serverId/backups',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { serverId } = serverParamsSchema.parse(request.params);

          return ok(
            await backups.listForServer(requireActor(request), userIdOf(request), serverId),
          );
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/servers/:serverId/backups',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { serverId } = serverParamsSchema.parse(request.params);
          const input = createBackupInputSchema.parse(request.body ?? {});
          const backup = await backups.createManual(
            requireActor(request),
            userIdOf(request),
            serverId,
            input,
          );

          // 202: Der Lauf ist angenommen, aber noch nicht fertig – das Backup
          // steht auf `pending` und meldet seinen Fortschritt über den Datensatz.
          // Bewusst ohne `await`: Ein `await` auf die Antwort selbst wartet auf
          // ihr Absenden und legt den Handler still.
          reply.status(202);

          return ok(backup);
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    /**
     * Vollständiger Export aller Serverdaten (Lastenheft §3.3).
     *
     * Erzeugt ein manuelles Backup mit `isExport`; abgeholt wird es danach über
     * `GET /backups/:backupId/download`. Bewusst zwei Schritte: Ein Archiv
     * entsteht nicht in der Zeit, die eine HTTP-Antwort offen bleiben darf.
     */
    app.post(
      '/servers/:serverId/export',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { serverId } = serverParamsSchema.parse(request.params);
          const input = createServerExportInputSchema.parse(request.body ?? {});
          const backup = await backups.createExport(
            requireActor(request),
            userIdOf(request),
            serverId,
            input,
          );

          reply.status(202);

          return ok(backup);
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Einzelnes Backup ---------------------------------------------------

    app.get(
      '/backups/:backupId',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { backupId } = backupParamsSchema.parse(request.params);

          return ok(await backups.get(requireActor(request), userIdOf(request), backupId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.delete(
      '/backups/:backupId',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { backupId } = backupParamsSchema.parse(request.params);
          await backups.remove(requireActor(request), userIdOf(request), backupId);

          return ok(null);
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/backups/:backupId/restore',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { backupId } = backupParamsSchema.parse(request.params);

          return ok(await backups.restore(requireActor(request), userIdOf(request), backupId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.get(
      '/backups/:backupId/download',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<void> => {
        try {
          const { backupId } = backupParamsSchema.parse(request.params);
          const download = await backups.openDownload(
            requireActor(request),
            userIdOf(request),
            backupId,
          );

          await reply
            .header('content-type', 'application/octet-stream')
            .header('content-length', String(download.totalBytes))
            .header('content-disposition', `attachment; filename="${download.fileName}"`)
            .send(
              // Fastify verarbeitet einen async iterable als Stream: Jeder Block
              // geht sofort raus, das Archiv liegt nie vollständig im Speicher.
              (async function* stream() {
                for await (const chunk of download.chunks()) {
                  if (chunk.bytes.length > 0) {
                    yield chunk.bytes;
                  }
                }
              })(),
            );
        } catch (error) {
          await handleError(reply, error);
        }
      },
    );

    // -- Eigene Backups über alle Server (F4) -------------------------------

    app.get(
      '/users/:userId/backups',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { userId } = ownerParamsSchema.parse(request.params);

          return ok(await backups.listForOwner(requireActor(request), userIdOf(request), userId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Backup-Zeitplan ----------------------------------------------------

    app.get(
      '/servers/:serverId/backup-schedule',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { serverId } = serverParamsSchema.parse(request.params);

          return ok(await schedules.get(requireActor(request), userIdOf(request), serverId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.put(
      '/servers/:serverId/backup-schedule',
      { preHandler: requirePermission('backup.manage.own') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const { serverId } = serverParamsSchema.parse(request.params);
          const input = updateBackupScheduleInputSchema.parse(request.body ?? {});

          return ok(await schedules.set(requireActor(request), userIdOf(request), serverId, input));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    // -- Globale Übersicht (Lastenheft §3.7, Admin-Ansicht F10) -------------

    app.get(
      '/admin/backups',
      { preHandler: requirePermission('backup.manage.any') },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const query = backupOverviewQuerySchema.parse(request.query ?? {});

          return ok(await backups.overview(requireActor(request), query));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );
  };
}
