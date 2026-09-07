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
  type ApiResponse,
  type GameServerPermissions,
  type SchedulePermissions,
  type ServerMemberDto,
  type SubdomainAvailabilityDto,
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
import { accountRateLimit } from '../../lib/abuse-limits.js';
import { attachmentContentDisposition } from '../../lib/content-disposition.js';
import { requireActor, requireApproved, requirePermission } from '../rbac/index.js';
import { type ServerDtoContext, toGameServerDto } from './dto.js';
import { ServerOrchestrationError, isServerOrchestrationError } from './errors.js';
import { type GameRegistry } from './game-registry.js';
import { type ServerMemberRecord, type ServerRepository } from './repository.js';
import { type ServerScheduleService, toScheduleDto } from './schedules.js';
import { type WorldArchiveStore } from './world-import.js';
import { type ServerOrchestrationService } from './service.js';
import { checkSubdomain } from './subdomain.js';

export interface ServerRoutesOptions {
  readonly service: ServerOrchestrationService;
  readonly repository: ServerRepository;
  readonly registry: GameRegistry;
  readonly baseDomain: string;
  /** Geplante Aufgaben des Reiters „Aufgaben" (Lastenheft §3.3). */
  readonly schedules: ServerScheduleService;
  /** Zwischenspeicher der Weltdaten-Archive des Wizards (Lastenheft §3.3, P4). */
  readonly worldArchives: WorldArchiveStore;
}

const serverIdParamsSchema = z.object({ id: z.string().uuid() });
const scheduleParamsSchema = z.object({ id: z.string().uuid(), scheduleId: z.string().uuid() });
const cloneJobParamsSchema = z.object({ id: z.string().uuid(), jobId: z.string().uuid() });

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
 * Spielraum für den Formular-Rahmen um die Datei herum (Trenner, Feldnamen,
 * `path`, Dateiname): `Content-Length` zählt das ganze Formular, die Grenze
 * gilt nur für die Datei. Ohne den Spielraum fiele eine Datei knapp unter der
 * Grenze schon an der Ankündigung durch, obwohl sie selbst hineinpasst.
 */
const MULTIPART_ENVELOPE_ALLOWANCE_BYTES = 64 * 1024;

/**
 * Liest den Datei-Teil eines Uploads und puffert ihn genau einmal – höchstens
 * bis `maxBytes`.
 *
 * Die Grenze geht je Aufruf an `@fastify/multipart` und greift damit **vor**
 * dem Puffern: Der Datenstrom wird dort abgeschnitten, statt bis zur globalen
 * Multipart-Grenze aus `server.ts` zu wachsen (Fundpunkt 123 – vorher lag die
 * Datei mit bis zu 2 GiB im Speicher, bevor der Dienst die 64 MiB des
 * Agent-Kanals prüfte). `truncated` ist das Signal dafür – ohne die Prüfung
 * käme eine halbe Datei im Container an. Kündigt `Content-Length` schon mehr
 * an, als hineinpasst, wird der Rumpf gar nicht erst gelesen; ein Upload ohne
 * Ankündigung (chunked) läuft unverändert in die Multipart-Grenze.
 */
async function readUpload(request: FastifyRequest, maxBytes: number): Promise<FileUploadInput> {
  if (!request.isMultipart()) {
    throw new ServerOrchestrationError(
      'VALIDATION_FAILED',
      'Der Upload muss als multipart/form-data gesendet werden.',
    );
  }

  const angekuendigt = Number(request.headers['content-length']);

  if (
    Number.isFinite(angekuendigt) &&
    angekuendigt > maxBytes + MULTIPART_ENVELOPE_ALLOWANCE_BYTES
  ) {
    throw new ServerOrchestrationError(
      'FILE_TOO_LARGE',
      'Die Datei überschreitet die zulässige Upload-Größe.',
    );
  }

  // `throwFileSizeLimit: false`: Sonst wirft `toBuffer()` beim Abschneiden den
  // Bibliotheksfehler `FST_REQ_FILE_TOO_LARGE`, der außerhalb des Katalogs
  // liegt und als `INTERNAL_ERROR` (500) beim Aufrufer ankäme – hier zählt
  // allein `truncated`.
  const datei = await request.file({ limits: { fileSize: maxBytes }, throwFileSizeLimit: false });

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

/**
 * Eine Mitglieds-Zuordnung in Vertragsform (`ServerMemberDto`).
 *
 * `canEdit` ist kein Feld der Zuordnung selbst, sondern das Recht des
 * **Aufrufers** auf diesem Server: Stufe ändern und entfernen hängen an
 * `canManageMembers`. Wie bei `schedulePermissions` rechnet das Backend das Flag
 * aus und die Oberfläche liest nur es (Pflichtenheft §5.2) – sie leitet nie
 * selbst etwas aus der Stufe ab.
 */
function toServerMemberDto(
  record: ServerMemberRecord,
  permissions: GameServerPermissions,
): ServerMemberDto {
  return {
    userId: record.userId,
    displayName: record.displayName,
    level: record.level,
    addedAt: record.addedAt,
    canEdit: permissions.canManageMembers,
  };
}

/** Antwortet mit dem Envelope aus §5.1 und dem HTTP-Status des Fehlercodes. */
async function replyWithError(reply: FastifyReply, error: unknown): Promise<void> {
  if (isServerOrchestrationError(error)) {
    await reply.status(httpStatusForErrorCode(error.code)).send(fail(error.code, error.message));

    return;
  }

  throw error;
}

export function registerServerRoutes(app: FastifyInstance, options: ServerRoutesOptions): void {
  const { service, repository, registry, baseDomain, schedules, worldArchives } = options;

  /*
   * Missbrauchsgrenze der Konsole je Konto (Audit W2-3, `security-matrix-05`
   * Szenario d).
   *
   * Ein Konsolenbefehl ist ein Roundtrip zum Agent und von dort in den
   * Container. Ohne Bremse ließ sich der Spielserver im Sekundentakt
   * fernsteuern – auch von einem regulären Mitglied mit `canUseConsole`. Der
   * Zähler entsteht einmal je Registrierung, nicht je Request.
   */
  const consoleLimit = accountRateLimit({
    scope: 'server.console',
    resolveUserId: (request) => request.viewerUserId ?? null,
  });

  /**
   * Baut den DTO-Kontext eines Servers für den aktuellen Aufrufer.
   *
   * `pinned` kann vorab geladen mitgegeben werden (Gefundener Punkt 50): Die
   * Serverliste braucht die Anheftungen des Kontos genau einmal, nicht einmal
   * je Server.
   */
  async function dtoContext(
    request: FastifyRequest,
    serverId: string,
    angeheftet?: ReadonlySet<string>,
  ): Promise<ServerDtoContext> {
    const actor = requireActor(request);
    const viewerId = request.viewerUserId ?? null;
    const members = await repository.listMembers(serverId);
    const pins = angeheftet ?? (await pinnedIdsOf(viewerId));

    return {
      actor,
      viewerId,
      viewerMemberLevel:
        viewerId === null
          ? null
          : (members.find((member) => member.userId === viewerId)?.level ?? null),
      memberCount: members.length,
      pinned: pins.has(serverId),
      registry,
      baseDomain,
      recentCrashCount: 0,
    };
  }

  /** Konto des Aufrufers; ohne Anmeldung `AUTH_REQUIRED`. */
  function requireViewer(request: FastifyRequest): string {
    const viewerId = request.viewerUserId ?? null;

    if (viewerId === null) {
      throw new ServerOrchestrationError('AUTH_REQUIRED');
    }

    return viewerId;
  }

  /** Angeheftete Server eines Kontos; ohne Anmeldung leer. */
  async function pinnedIdsOf(viewerId: string | null): Promise<ReadonlySet<string>> {
    return viewerId === null ? new Set<string>() : await repository.listPinnedServerIds(viewerId);
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

  /*
   * `requireApproved()`: Der Spiel-Katalog ist eine Funktion des Panels und
   * damit für ein noch nicht freigeschaltetes Konto tabu (Lastenheft §3.1,
   * security-matrix-06). Eine Permission verlangt die Route weiterhin nicht –
   * wer freigeschaltet ist, darf sehen, welche Spiele es gibt.
   */
  app.get('/api/game-types', { preHandler: requireApproved() }, async (request, reply) => {
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
      const angeheftet = await pinnedIdsOf(viewerId);

      for (const server of servers) {
        const context = await dtoContext(request, server.id, angeheftet);
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

  // -- Anheften (Gefundener Punkt 50) ------------------------------------------

  /*
   * `PUT`/`DELETE` statt eines Umschalters: Beide Aufrufe fuehren zum selben
   * Zielzustand, egal wie oft sie kommen. Ein Umschalter wuerde bei einem
   * doppelt abgesetzten Klick das Gegenteil bewirken.
   *
   * Geprueft wird `canView`: Wer einen Server sehen darf, darf ihn sich auch
   * an die eigene Uebersicht heften - eine eigene Permission dafuer waere ohne
   * Wirkung, weil die Anheftung niemandem sonst etwas zeigt.
   */
  app.put('/api/servers/:id/pin', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canView');
      const viewerId = requireViewer(request);

      await repository.pinServer(viewerId, id);

      return await reply.send(ok({ ...dto, pinned: true }));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  app.delete('/api/servers/:id/pin', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const { dto } = await loadAuthorized(request, id, 'canView');
      const viewerId = requireViewer(request);

      await repository.unpinServer(viewerId, id);

      return await reply.send(ok({ ...dto, pinned: false }));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Subdomain-Prüfung (Pflichtenheft §13) -----------------------------------

  /*
   * `requireApproved()`: Die Prüfung beantwortet, ob eine Subdomain belegt ist –
   * für ein nicht freigeschaltetes Konto ein Orakel über vorhandene Server
   * (security-matrix-06).
   */
  app.get(
    '/api/servers/subdomain-check',
    { preHandler: requireApproved() },
    async (request, reply) => {
      try {
        requireActor(request);

        const query = z.object({ subdomain: z.string() }).parse(request.query);
        // `baseDomain` nur für `fullHostname` im DTO (contract-drift-04) – der
        // Wizard zeigt damit die Adresse an, die entstehen würde.
        const result: SubdomainAvailabilityDto = await checkSubdomain(
          query.subdomain,
          repository,
          baseDomain,
        );

        return await reply.send(ok(result));
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

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

  /**
   * Klonen anstoßen (Pflichtenheft §9, Lastenheft §3.3).
   *
   * Antwortet mit dem **Auftrag**, nicht mit dem fertigen Server: Ein Klon mit
   * Weltdaten läuft länger, als eine HTTP-Antwort offen bleiben darf. Der Stand
   * kommt danach über den Live-Kanal (`serverClone.progressed`) oder über die
   * Route darunter.
   */
  app.post('/api/servers/:id/clone', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const viewerId = request.viewerUserId;

      if (viewerId === undefined || viewerId === null) {
        throw new ServerOrchestrationError('AUTH_REQUIRED');
      }

      await loadAuthorized(request, id, 'canClone');

      const input = cloneServerInputSchema.parse(request.body);

      return await reply.status(202).send(ok(await service.cloneServer(id, input, viewerId)));
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  /** Stand eines Klon-Auftrags – das Gegenstück zum Fortschritts-Ereignis. */
  app.get('/api/servers/:id/clone/:jobId', async (request, reply) => {
    try {
      const { id, jobId } = cloneJobParamsSchema.parse(request.params);

      await loadAuthorized(request, id, 'canClone');

      const job = service.findCloneJob(id, jobId);

      if (job === null) {
        throw new ServerOrchestrationError('SERVER_NOT_FOUND', 'Der Klon-Auftrag ist unbekannt.', {
          serverId: id,
          jobId,
        });
      }

      return await reply.send(ok(job));
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

  /**
   * Verlauf der Messwerte (Lastenheft §3.3 „Verlaufsdarstellung").
   *
   * Gleiche Schranke wie der Momentwert: Wer den Server sehen darf, darf auch
   * seinen Verlauf sehen. Das Fenster kappt der Dienst an der
   * Aufbewahrungsfrist.
   */
  app.get('/api/servers/:id/stats/history', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);
      const query = z
        .object({
          windowMinutes: z.coerce.number().int().positive().max(43_200).default(60),
        })
        .parse(request.query);

      await loadAuthorized(request, id, 'canView');

      return await reply.send(ok(await service.getStatsHistory(id, query.windowMinutes)));
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

  app.post('/api/servers/:id/console', { preHandler: consoleLimit }, async (request, reply) => {
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
   * Die Größengrenze steckt in zwei Stufen: `readUpload` schneidet den
   * Datenstrom bei der wirksamen Grenze des Dienstes ab (nichts wird darüber
   * hinaus gepuffert), der Dienst prüft die tatsächlich gelesene Größe noch
   * einmal gegen dieselbe Zahl.
   */
  app.post('/api/servers/:id/files', async (request, reply) => {
    try {
      const { id } = serverIdParamsSchema.parse(request.params);

      const { dto } = await loadAuthorized(request, id, 'canManageFiles');

      const upload = await readUpload(request, service.maxUploadBytes());

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
        // RFC-6266-konform kodiert (Audit W2-9, `orchestration-features-07`):
        // Ein Dateiname mit Steuerzeichen (`welt\r\nx.txt`) ließ Node den
        // Kopfzeilenwert ablehnen – der Download endete als 500 –, Umlaute
        // kamen als Buchstabensalat an.
        .header('content-disposition', attachmentContentDisposition(datei.fileName))
        .send(datei.content);
    } catch (error: unknown) {
      return replyWithError(reply, error);
    }
  });

  // -- Weltdaten-Übernahme beim Anlegen (Lastenheft §3.3, P4) -----------------
  //
  // Der Upload steht bewusst **nicht** unter `/api/servers/:id`: Er passiert im
  // Wizard, bevor es den Server gibt. Berechtigt ist deshalb, wer überhaupt
  // Server anlegen darf – dieselbe Schranke wie bei `POST /api/servers`.
  //
  // Der Datenstrom wird nicht gepuffert, sondern direkt auf die Platte
  // geschrieben und dabei gegen `MAX_WORLD_ARCHIVE_BYTES` gezählt: Ein zu
  // großes Archiv soll nicht erst vollständig im Speicher landen.

  app.post(
    '/api/uploads/world-archives',
    { preHandler: requirePermission('server.create') },
    async (request, reply) => {
      try {
        if (!request.isMultipart()) {
          throw new ServerOrchestrationError(
            'VALIDATION_FAILED',
            'Der Upload muss als multipart/form-data gesendet werden.',
          );
        }

        // Vor dem Lesen des Rumpfs: Ohne bekanntes Konto gibt es keinen
        // Besitzer, an den der Verweis gebunden werden könnte.
        const ownerId = requireViewer(request);
        const datei = await request.file();

        if (datei === undefined) {
          throw new ServerOrchestrationError(
            'VALIDATION_FAILED',
            'Im Upload fehlt das Feld „file".',
          );
        }

        /*
         * Beides geht in den Zwischenspeicher hinein, nicht erst danach:
         *  - `ownerId` bindet den Verweis an das hochladende Konto, damit ihn
         *    niemand sonst einlösen kann (orchestration-features-09);
         *  - `isTruncated` meldet die Multipart-Grenze aus `server.ts`. Sie
         *    wird vor dem Umbenennen ausgewertet, sonst läge ein
         *    abgeschnittenes Archiv unter gültigem Namen bis zur Frist auf der
         *    Platte, während der Nutzer einen Fehler bekommt
         *    (orchestration-features-05).
         */
        const upload = await worldArchives.save(datei.filename, datei.file, {
          ownerId,
          isTruncated: () => datei.file.truncated,
        });

        return await reply.status(201).send(ok(upload));
      } catch (error: unknown) {
        return replyWithError(reply, error);
      }
    },
  );

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
  //
  // Lesen hängt an `canView`, Ändern und Entfernen an `canManageMembers`: Wer
  // den Server überhaupt sehen darf, darf auch sehen, wer sonst noch Zugriff
  // hat – die Oberfläche zeigt den Abschnitt „Zugriff" ohnehin jedem, der die
  // Einstellungen öffnen kann (`SettingsTab.tsx`). Was jemand mit einem Eintrag
  // tun darf, steht als `canEdit` an jedem Mitglied.
  //
  // Die Rückgabetypen sind annotiert, damit der Compiler den Vertrag prüft: Ein
  // Handler ohne Annotation würde auch einen Repository-Datensatz ohne `canEdit`
  // klaglos ausliefern.

  app.get(
    '/api/servers/:id/members',
    async (request, reply): Promise<ApiResponse<ServerMemberDto[]> | undefined> => {
      try {
        const { id } = serverIdParamsSchema.parse(request.params);
        const { dto } = await loadAuthorized(request, id, 'canView');
        const mitglieder = await repository.listMembers(id);

        return ok(mitglieder.map((record) => toServerMemberDto(record, dto.permissions)));
      } catch (error: unknown) {
        await replyWithError(reply, error);

        return undefined;
      }
    },
  );

  app.put(
    '/api/servers/:id/members',
    async (request, reply): Promise<ApiResponse<ServerMemberDto> | undefined> => {
      try {
        const { id } = serverIdParamsSchema.parse(request.params);

        const { server, dto } = await loadAuthorized(request, id, 'canManageMembers');
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

        // Die Antwort trägt genau die eine geänderte Zuordnung (Vertrag
        // `ServerMemberDto`), nicht die ganze Liste: Das Frontend ersetzt damit
        // den betroffenen Eintrag. Der Anzeigename kommt aus der Liste, weil ihn
        // nur der Join mit dem Konto kennt.
        const record = (await repository.listMembers(id)).find(
          (member) => member.userId === input.userId,
        );

        if (record === undefined) {
          throw new ServerOrchestrationError('USER_NOT_FOUND');
        }

        return ok(toServerMemberDto(record, dto.permissions));
      } catch (error: unknown) {
        await replyWithError(reply, error);

        return undefined;
      }
    },
  );

  app.delete(
    '/api/servers/:id/members/:userId',
    async (request, reply): Promise<ApiResponse<null> | undefined> => {
      try {
        const { id, userId } = memberParamsSchema.parse(request.params);

        await loadAuthorized(request, id, 'canManageMembers');
        await repository.removeMember(id, userId);

        // `null` wie im Vertrag und im Frontend (`removeMember` in
        // `lib/api/servers.ts`): Die Oberfläche streicht den Eintrag selbst und
        // braucht die Restliste nicht.
        return ok(null);
      } catch (error: unknown) {
        await replyWithError(reply, error);

        return undefined;
      }
    },
  );
}
