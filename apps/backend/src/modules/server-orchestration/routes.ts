/**
 * REST-Routen der Server-Orchestrierung (Pflichtenheft §5).
 *
 * Alle Antworten laufen über `ok()`/`fail()` aus `@palantir/contracts` – der
 * Envelope wird nirgends von Hand gebaut (Pflichtenheft §5.1). Fehler tragen
 * benannte Codes aus dem Katalog; ein Freitext-Fehler kommt hier nicht vor
 * (CLAUDE.md §5).
 *
 * **Berechtigungen:** Der Zugriff läuft über den Guard aus B2
 * (`requirePermission`) für die grobe Schranke und über das `permissions`-Objekt
 * des DTOs für die feine – Letzteres ist die einzige Stelle, die die
 * Mitgliedsstufe kennt. Eine Route prüft deshalb nie selbst Rollen, sondern
 * fragt das berechnete Flag ab.
 */

import {
  type GameServerPermissions,
  type SchedulePermissions,
  fail,
  httpStatusForErrorCode,
  ok,
} from '@palantir/contracts';
import {
  cloneServerInputSchema,
  consoleCommandSchema,
  createServerInputSchema,
  scheduleInputSchema,
  updateServerSettingsInputSchema,
  serverMemberInputSchema,
} from '@palantir/validation';
import { type MultipartFile } from '@fastify/multipart';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireActor, requirePermission } from '../rbac/index.js';
import { type ServerDtoContext, toGameServerDto } from './dto.js';
import { ServerOrchestrationError, isServerOrchestrationError } from './errors.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerRepository } from './repository.js';
import { type ServerScheduleService, toScheduleDto } from './schedules.js';
import { type ServerOrchestrationService } from './service.js';
import { checkSubdomain } from './subdomain.js';

export interface ServerRoutesOptions {
  readonly service: ServerOrchestrationService;
  readonly repository: ServerRepository;
  readonly registry: GameRegistry;
  readonly baseDomain: string;
  /** Geplante Aufgaben des Reiters „Aufgaben" (Lastenheft §3.3). */
  readonly schedules: ServerScheduleService;
}

const serverIdParamsSchema = z.object({ id: z.string().uuid() });
const scheduleParamsSchema = z.object({ id: z.string().uuid(), scheduleId: z.string().uuid() });

/** Ein hochgeladener Datei-Teil samt der Felder, die daneben im Formular stehen. */
interface FileUploadInput {
  /** Zielordner, relativ zum Datenordner; `''` ist die Wurzel. */
  readonly path: string;
  readonly fileName: string;
  readonly content: Buffer;
  readonly overwrite?: boolean;
}

/** Textfeld aus einem Multipart-Formular; `undefined`, wenn es fehlt. */
function multipartField(fields: MultipartFile['fields'], name: string): string | undefined {
  const feld = fields[name];
  const eintrag = Array.isArray(feld) ? feld[0] : feld;

  if (eintrag === undefined || eintrag.type !== 'field') return undefined;

  return typeof eintrag.value === 'string' ? eintrag.value : undefined;
}

/**
 * Liest den Datei-Teil eines Uploads und puffert ihn genau einmal.
 *
 * Die Größengrenze steht in der Multipart-Registrierung (`server.ts`,
 * `MAX_UPLOAD_SIZE_BYTES`): Der Datenstrom wird dort abgebrochen, statt hier
 * unbegrenzt zu wachsen. `truncated` ist das Signal dafür – ohne die Prüfung
 * käme eine halbe Datei im Container an.
 */
async function readUpload(request: FastifyRequest): Promise<FileUploadInput> {
  if (!request.isMultipart()) {
    throw new ServerOrchestrationError(
      'VALIDATION_FAILED',
      'Der Upload muss als multipart/form-data gesendet werden.',
    );
  }

  const datei = await request.file();

  if (datei === undefined) {
    throw new ServerOrchestrationError('VALIDATION_FAILED', 'Im Upload fehlt das Feld „file".');
  }

  const content = await datei.toBuffer();

  if (datei.file.truncated) {
    throw new ServerOrchestrationError(
      'FILE_TOO_LARGE',
      'Die Datei überschreitet die zulässige Upload-Größe.',
    );
  }

  const overwrite = multipartField(datei.fields, 'overwrite');

  return {
    path: multipartField(datei.fields, 'path') ?? '',
    fileName: datei.filename,
    content,
    ...(overwrite === undefined ? {} : { overwrite: overwrite === 'true' }),
  };
}
const memberParamsSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });

/** Antwortet mit dem Envelope aus §5.1 und dem HTTP-Status des Fehlercodes. */
async function replyWithError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isServerOrchestrationError(error)) {
    await reply.status(httpStatusForErrorCode(error.code)).send(fail(error.code, error.message));

    return;
  }

  throw error;
}

export function registerServerRoutes(app: FastifyInstance, options: ServerRoutesOptions): void {
  const { service, repository, registry, baseDomain, schedules } = options;

  /** Baut den DTO-Kontext eines Servers für den aktuellen Aufrufer. */
  async function dtoContext(request: FastifyRequest, serverId: string): Promise<ServerDtoContext> {
    const actor = requireActor(request);
    const viewerId = request.viewerUserId ?? null;
    const members = await repository.listMembers(serverId);

    return {
      actor,
      viewerId,
      viewerMemberLevel:
        viewerId === null
          ? null
          : (members.find((member) => member.userId === viewerId)?.level ?? null),
      memberCount: members.length,
      registry,
      baseDomain,
      recentCrashCount: 0,
    };
  }

  /**
   * Lädt einen Server und prüft ein Flag seines `permissions`-Objekts.
   *
   * Ein Server, den der Aufrufer nicht sehen darf, wird als `SERVER_NOT_FOUND`
   * gemeldet und nicht als `PERMISSION_DENIED`: Die Existenz eines fremden
   * Servers ist selbst schon eine Information.
   */
  async function loadAuthorized(
    request: FastifyRequest,
    serverId: string,
    flag: keyof GameServerPermissions,
  ) {
    const server = await service.requireServer(serverId);
    const context = await dtoContext(request, serverId);
    const dto = toGameServerDto(server, {
      ...context,
      recentCrashCount: service.recentCrashCount(server),
    });

    if (!dto.permissions.canView) {
      throw new ServerOrchestrationError('SERVER_NOT_FOUND', undefined, { serverId });
    }

    if (!dto.permissions[flag]) {
      throw new ServerOrchestrationError('PERMISSION_DENIED');
    }

    return { server, context, dto };
  }

  // -- Spiele-Registry (Pflichtenheft §11) ------------------------------------

  app.get('/api/game-types', async (request, reply) => {
    try {
      requireActor(request);

      return await reply.send(ok(registry.toDtoList()));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Serverliste und Detail --------------------------------------------------

  app.get('/api/servers', async (request, reply) => {
    try {
      const actor = requireActor(request);
      const viewerId = request.viewerUserId ?? null;

      // Wer alle Server sehen darf, bekommt alle; alle anderen ihre eigenen und
      // die, bei denen sie Mitglied sind. Die Feinprüfung macht danach das
      // `permissions`-Objekt je Server.
      const servers = actor.permissions.has('server.view.any')
        ? await repository.listAll()
        : viewerId === null
          ? []
          : await repository.listByOwnerOrMembership(viewerId);

      const dtos = [];

      for (const server of servers) {
        const context = await dtoContext(request, server.id);
        const dto = toGameServerDto(server, {
          ...context,
          recentCrashCount: service.recentCrashCount(server),
        });

        if (dto.permissions.canView) {
          dtos.push(dto);
        }
      }

      return await reply.send(ok(dtos));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/servers/:id', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(dto));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Subdomain-Prüfung (Pflichtenheft §13) -----------------------------------

  app.get('/api/servers/subdomain-check', async (request, reply) => {
    try {
      requireActor(request);

      const query = z.object({ subdomain: z.string() }).parse(request.query);
      const result = await checkSubdomain(query.subdomain, repository);

      return await reply.send(ok(result));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Anlegen, Ändern, Klonen, Löschen ---------------------------------------

  app.post(
    '/api/servers',
    { preHandler: requirePermission('server.create') },
    async (request, reply) => {
      try {
        const actor = requireActor(request);
        const viewerId = request.viewerUserId;

        if (viewerId === undefined || viewerId === null) {
          throw new ServerOrchestrationError('AUTH_REQUIRED');
        }

        void actor;

        const input = createServerInputSchema.parse(request.body);
        const server = await service.createServer(input, viewerId);
        const context = await dtoContext(request, server.id);

        return await reply.status(201).send(
          ok(
            toGameServerDto(server, {
              ...context,
              recentCrashCount: service.recentCrashCount(server),
            }),
          ),
        );
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

  app.patch('/api/servers/:id', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageSettings');

      const input = updateServerSettingsInputSchema.parse(request.body);
      const server = await service.updateServer(id, input);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/clone', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canClone');

      const input = cloneServerInputSchema.parse(request.body);
      const clone = await service.cloneServer(id, input, viewerId);
      const context = await dtoContext(request, clone.id);

      return await reply.status(201).send(
        ok(
          toGameServerDto(clone, {
            ...context,
            recentCrashCount: service.recentCrashCount(clone),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canDelete');
      await service.deleteServer(id);

      return await reply.send(ok(null));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Lifecycle (Pflichtenheft §9) -------------------------------------------

  app.post('/api/servers/:id/start', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canStart');

      const server = await service.startServer(id, viewerId);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/stop', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canStop');

      const server = await service.stopServer(id);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/restart', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canRestart');

      const server = await service.restartServer(id, viewerId);
      const context = await dtoContext(request, id);

      return await reply.send(
        ok(
          toGameServerDto(server, {
            ...context,
            recentCrashCount: service.recentCrashCount(server),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Live-Daten, Konsole, Dateien -------------------------------------------

  app.get('/api/servers/:id/stats', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(await service.getStats(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/servers/:id/logs', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = z.object({ tail: z.coerce.number().int().positive().max(5_000).optional() });

      await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(await service.getLogs(id, query.parse(request.query).tail)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/console', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canUseConsole');

      const input = z.object({ command: consoleCommandSchema }).parse(request.body);

      return await reply.send(ok(await service.execConsole(id, input.command)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Datei-Manager (Arbeitspaket P2, Lastenheft §3.3) -----------------------
  //
  // Pfade sind durchgehend **relativ zum Datenordner** des Servers, `''` ist
  // die Wurzel – dieselbe Sicht wie im Frontend (`FilesTab.tsx`). Die
  // Übersetzung in absolute Container-Pfade und die Einsperrung auf den
  // Datenordner passieren im Dienst (`files.ts`), nicht hier.
  //
  // Alle Routen hängen an `canManageFiles`: Der Datei-Manager ist eine
  // Berechtigung, kein Lese-/Schreib-Paar. `writable` im DTO ist deshalb
  // dasselbe Flag – es steht im Vertrag, damit die Oberfläche es nicht selbst
  // herleiten muss.

  const filePathQuerySchema = z.object({ path: z.string().max(4_096) });

  app.get('/api/servers/:id/files', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = filePathQuerySchema.parse(request.query);

      const { dto } = await loadAuthorized(request, id, 'canManageFiles');

      return await reply.send(
        ok(await service.listFiles(id, query.path, { writable: dto.permissions.canManageFiles })),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.get('/api/servers/:id/files/content', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = filePathQuerySchema.parse(request.query);

      const { dto } = await loadAuthorized(request, id, 'canManageFiles');

      return await reply.send(
        ok(await service.readFile(id, query.path, { writable: dto.permissions.canManageFiles })),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.put('/api/servers/:id/files/content', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const input = z
        .object({ path: z.string().max(4_096), content: z.string() })
        .parse(request.body);

      const { dto } = await loadAuthorized(request, id, 'canManageFiles');

      return await reply.send(
        ok(
          await service.writeFile(id, input.path, input.content, {
            writable: dto.permissions.canManageFiles,
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /**
   * Datei hochladen (`multipart/form-data`: `path` = Zielordner, `file` = Datei).
   *
   * Die Größengrenze steckt in zwei Stufen: `@fastify/multipart` bricht den
   * Datenstrom bei `MAX_UPLOAD_SIZE_BYTES` ab (nichts wird darüber hinaus
   * gepuffert), der Dienst prüft die tatsächlich gelesene Größe noch einmal
   * gegen die Agent-Kanal-Grenze.
   */
  app.post('/api/servers/:id/files', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      const { dto } = await loadAuthorized(request, id, 'canManageFiles');

      const upload = await readUpload(request);

      return await reply.send(
        ok(
          await service.uploadFile(id, upload.path, upload.fileName, upload.content, {
            writable: dto.permissions.canManageFiles,
            ...(upload.overwrite === undefined ? {} : { overwrite: upload.overwrite }),
          }),
        ),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id/files', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const input = z
        .object({ path: z.string().max(4_096), recursive: z.boolean().optional() })
        .parse(request.body);

      await loadAuthorized(request, id, 'canManageFiles');
      await service.deleteFile(id, input.path, input.recursive ?? true);

      return await reply.send(ok(null));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /**
   * Einzelne Datei herunterladen.
   *
   * Wird als Link geöffnet (`fileDownloadUrl()` im Frontend) und liefert
   * deshalb keinen Envelope, sondern die Datei selbst. Fehler dagegen laufen
   * wie überall über `fail()` – ein fehlgeschlagener Download soll nicht als
   * beschädigte Datei im Downloadordner landen.
   */
  app.get('/api/servers/:id/files/download', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = filePathQuerySchema.parse(request.query);

      await loadAuthorized(request, id, 'canManageFiles');

      const datei = await service.downloadFile(id, query.path);

      return await reply
        .header('content-type', 'application/octet-stream')
        .header(
          'content-disposition',
          `attachment; filename="${datei.fileName.replaceAll('"', '')}"`,
        )
        .send(datei.content);
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Geplante Aufgaben (Lastenheft §3.3, Reiter „Aufgaben") -----------------
  //
  // Alle vier Routen hängen an `canManageSchedules`: Wer die Aufgabenliste
  // sehen darf, darf sie auch pflegen – eine getrennte Lesestufe gibt es im
  // Rechte-Katalog nicht. Das `permissions`-Objekt je Aufgabe trägt deshalb
  // dasselbe Flag; die Oberfläche muss es nicht selbst herleiten.
  //
  // Der Backup-Zeitplan liegt zwar in derselben Tabelle, gehört aber zu B5 und
  // taucht hier nicht auf (siehe `schedules.ts`).

  function schedulePermissions(canManage: boolean): SchedulePermissions {
    return { canEdit: canManage, canDelete: canManage, canToggle: canManage };
  }

  app.get('/api/servers/:id/schedules', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canManageSchedules');
      const rechte = schedulePermissions(dto.permissions.canManageSchedules);
      const liste = await schedules.list(id);

      return await reply.send(ok(liste.map((record) => toScheduleDto(record, rechte))));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.post('/api/servers/:id/schedules', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canManageSchedules');
      const input = scheduleInputSchema.parse(request.body);
      const record = await schedules.create(id, input);

      return await reply
        .status(201)
        .send(ok(toScheduleDto(record, schedulePermissions(dto.permissions.canManageSchedules))));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.patch('/api/servers/:id/schedules/:scheduleId', async (request, reply) => {
    try {
      const { id, scheduleId } = scheduleParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canManageSchedules');
      const input = scheduleInputSchema.parse(request.body);
      const record = await schedules.update(id, scheduleId, input);

      return await reply.send(
        ok(toScheduleDto(record, schedulePermissions(dto.permissions.canManageSchedules))),
      );
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id/schedules/:scheduleId', async (request, reply) => {
    try {
      const { id, scheduleId } = scheduleParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageSchedules');
      await schedules.remove(id, scheduleId);

      return await reply.send(ok(null));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Mitglieder (Lastenheft §3.3) -------------------------------------------

  app.get('/api/servers/:id/members', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageMembers');

      return await reply.send(ok(await repository.listMembers(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.put('/api/servers/:id/members', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      const { server } = await loadAuthorized(request, id, 'canManageMembers');
      const input = serverMemberInputSchema.parse(request.body);

      // Der Besitzer steht nicht in der Mitgliederliste – er hat ohnehin alle
      // Rechte, und ein Eintrag mit niedrigerer Stufe wäre irreführend.
      if (input.userId === server.ownerId) {
        throw new ServerOrchestrationError(
          'SERVER_STATE_CONFLICT',
          'Der Besitzer des Servers kann nicht als Mitglied eingetragen werden.',
        );
      }

      await repository.upsertMember(id, input.userId, input.level);

      return await reply.send(ok(await repository.listMembers(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id/members/:userId', async (request, reply) => {
    try {
      const { id, userId } = memberParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canManageMembers');
      await repository.removeMember(id, userId);

      return await reply.send(ok(await repository.listMembers(id)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });
}
