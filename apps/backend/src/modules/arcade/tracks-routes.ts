/**
 * Routen der Spielhallen-Musik (Admin-Seite „Arcade-Musik", Neubau 26.09.2026).
 *
 * Verwalten verlangt `gametype.manage` – dasselbe Recht wie Spielbilder und
 * Sticker. Das aktive Stück abspielen darf jedes freigeschaltete Konto.
 *
 * Kein Audit-Eintrag: Der Aktionskatalog (`packages/contracts/src/audit.ts`)
 * kennt für Musik keine Aktion, und die Spielbilder derselben Seite schreiben
 * ebenfalls keine. Nachzutragen, falls der Betreiber es wünscht.
 */

import { ARCADE_TRACK_MAX_BYTES, type ApiResponse, ok } from '@palantir/contracts';
import { arcadeGameIdSchema, arcadeTrackTitleSchema, idSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireApproved, requirePermission } from '../rbac/index.js';
import { ArcadeError } from './errors.js';
import { replyWithArcadeError } from './routes.js';
import { type ArcadeTrackService } from './tracks.js';

const trackParamsSchema = z.object({ id: idSchema });

/** Spielraum für den Formular-Rahmen um die Datei (wie bei den Schriften). */
const MULTIPART_ENVELOPE_ALLOWANCE_BYTES = 16 * 1024;

export interface ArcadeTrackRoutesOptions {
  readonly tracks: ArcadeTrackService;
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Liest Formularfelder und Datei in beliebiger Reihenfolge.
 *
 * `request.file()` sähe nur Felder **vor** der Datei; `parts()` geht alle
 * Teile durch. Die Grenze geht je Aufruf an `@fastify/multipart` und greift
 * damit vor dem Puffern.
 */
async function readTrackUpload(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; data: Buffer | null }> {
  if (!request.isMultipart()) {
    throw new ArcadeError('VALIDATION_FAILED', 'Der Upload muss als multipart/form-data kommen.');
  }

  const angekuendigt = Number(request.headers['content-length']);

  if (
    Number.isFinite(angekuendigt) &&
    angekuendigt > ARCADE_TRACK_MAX_BYTES + MULTIPART_ENVELOPE_ALLOWANCE_BYTES
  ) {
    throw new ArcadeError('ARCADE_TRACK_TOO_LARGE');
  }

  const fields: Record<string, string> = {};
  let data: Buffer | null = null;

  for await (const part of request.parts({ limits: { fileSize: ARCADE_TRACK_MAX_BYTES } })) {
    if (part.type === 'file') {
      let buffer: Buffer;

      try {
        buffer = await part.toBuffer();
      } catch (error) {
        // Die Bibliothek wirft beim Abschneiden ihren eigenen Fehler; nach
        // außen geht der Code aus unserem Katalog.
        if ((error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') {
          throw new ArcadeError('ARCADE_TRACK_TOO_LARGE');
        }
        throw error;
      }

      if (part.file.truncated) throw new ArcadeError('ARCADE_TRACK_TOO_LARGE');
      if (part.fieldname === 'file') data = buffer;
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
    }
  }

  return { fields, data };
}

export function registerArcadeTrackRoutes(options: ArcadeTrackRoutesOptions) {
  const { tracks } = options;

  return async function arcadeTrackRoutes(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        await replyWithArcadeError(reply, error);

        return undefined;
      }
    }

    const manage = requirePermission('gametype.manage');
    const idOf = (request: FastifyRequest): string => trackParamsSchema.parse(request.params).id;

    app.get('/arcade/tracks', { preHandler: manage }, (_request, reply) =>
      handle(reply, () => tracks.list()),
    );

    app.get('/arcade/tracks/active', { preHandler: requireApproved() }, (_request, reply) =>
      handle(reply, () => tracks.active()),
    );

    /**
     * Stück ausliefern. `immutable` mit langer Frist: Ein Stück ändert sich
     * nie, ein neues hat eine neue Kennung. Das ETag ist deshalb die Kennung.
     */
    app.get(
      '/arcade/tracks/:id/audio',
      { preHandler: requireApproved() },
      async (request, reply) => {
        try {
          const audio = await tracks.audio(idOf(request));
          const etag = `"${audio.id}"`;

          reply
            .header('cache-control', 'private, max-age=604800, immutable')
            .header('etag', etag)
            .header('x-content-type-options', 'nosniff');

          if (request.headers['if-none-match'] === etag) {
            return await reply.status(304).send();
          }

          return await reply.header('content-type', audio.mimeType).send(audio.data);
        } catch (error) {
          await replyWithArcadeError(reply, error);

          return undefined;
        }
      },
    );

    app.post('/arcade/tracks', { preHandler: manage }, (request, reply) =>
      handle(reply, async () => {
        const { fields, data } = await readTrackUpload(request);

        if (data === null) {
          throw new ArcadeError('VALIDATION_FAILED', 'Im Upload fehlt das Feld „file".');
        }

        return tracks.upload({
          gameId: arcadeGameIdSchema.parse(fields.gameId),
          title: arcadeTrackTitleSchema.parse(fields.title ?? ''),
          data,
          uploadedBy: options.resolveUserId(request),
        });
      }),
    );

    app.post('/arcade/tracks/:id/activate', { preHandler: manage }, (request, reply) =>
      handle(reply, async () => {
        await tracks.activate(idOf(request));

        return null;
      }),
    );

    app.post('/arcade/tracks/:id/deactivate', { preHandler: manage }, (request, reply) =>
      handle(reply, async () => {
        await tracks.deactivate(idOf(request));

        return null;
      }),
    );

    app.delete('/arcade/tracks/:id', { preHandler: manage }, (request, reply) =>
      handle(reply, async () => {
        await tracks.remove(idOf(request));

        return null;
      }),
    );
  };
}
