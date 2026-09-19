/**
 * Routen für Symbol und Kachelbild eines Spieltyps.
 *
 * Hochladen und Entfernen verlangen `gametype.manage` – es ist eine
 * Entscheidung über die Vorlage, nicht über einen einzelnen Server. Ansehen
 * darf jedes freigeschaltete Konto: Die Bilder stehen in der Spielauswahl und
 * auf den Karten, ohne sie bliebe die Oberfläche leer.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  isRbacError,
  replyWithErrorCode,
  requireApproved,
  requirePermission,
} from '../rbac/index.js';
import {
  GAME_IMAGE_MAX_BYTES,
  GameTypeImageError,
  type GameTypeImageService,
  isGameTypeImageError,
  isGameTypeImageKind,
} from './index.js';

export interface GameTypeImageRouteOptions {
  readonly service: GameTypeImageService;
  readonly actorUserId: (request: FastifyRequest) => string | null;
}

export function registerGameTypeImageRoutes(options: GameTypeImageRouteOptions) {
  return async function register(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      reply: FastifyReply,
      work: () => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        return ok(await work());
      } catch (error) {
        if (isGameTypeImageError(error) || isRbacError(error)) {
          await replyWithErrorCode(reply, error.code, error.message);

          return undefined;
        }

        throw error;
      }
    }

    function requireKind(value: string) {
      if (!isGameTypeImageKind(value)) {
        throw new GameTypeImageError(
          'VALIDATION_FAILED',
          'Es gibt nur „icon" und „cover" als Stelle.',
        );
      }

      return value;
    }

    /**
     * Bild ausliefern.
     *
     * `immutable` mit langer Frist: Die Adresse trägt den Zeitstempel als
     * `?v=`, ein ausgetauschtes Bild hat damit eine neue Adresse. Ohne das
     * bliebe im Browser das alte Symbol, bis jemand den Zwischenspeicher
     * leert.
     */
    app.get<{ Params: { id: string; kind: string } }>(
      '/api/game-types/:id/images/:kind',
      { preHandler: requireApproved() },
      async (request, reply) => {
        try {
          const kind = requireKind(request.params.kind);
          const bild = await options.service.find(request.params.id, kind);

          if (bild === null) {
            return await replyWithErrorCode(reply, 'NOT_FOUND', 'Dieses Bild gibt es nicht.');
          }

          return await reply
            .header('content-type', bild.mimeType)
            .header('cache-control', 'private, max-age=604800, immutable')
            .header('last-modified', bild.updatedAt.toUTCString())
            .send(bild.data);
        } catch (error) {
          if (isGameTypeImageError(error) || isRbacError(error)) {
            return await replyWithErrorCode(reply, error.code, error.message);
          }

          throw error;
        }
      },
    );

    app.post<{ Params: { id: string; kind: string } }>(
      '/api/admin/game-types/:id/images/:kind',
      { preHandler: requirePermission('gametype.manage') },
      async (request, reply) =>
        handle<{ url: string }>(reply, async () => {
          const kind = requireKind(request.params.kind);

          if (!request.isMultipart()) {
            throw new GameTypeImageError(
              'VALIDATION_FAILED',
              'Das Bild muss als multipart/form-data gesendet werden.',
            );
          }

          const datei = await request.file({
            limits: { fileSize: GAME_IMAGE_MAX_BYTES[kind] },
            // Wie beim Profilbild: Die Bibliothek soll nicht selbst werfen,
            // damit die Antwort einen Code aus unserem Katalog trägt.
            throwFileSizeLimit: false,
          });

          if (datei === undefined) {
            throw new GameTypeImageError('VALIDATION_FAILED', 'Im Upload fehlt das Feld „file".');
          }

          const data = await datei.toBuffer();

          if (datei.file.truncated) {
            throw new GameTypeImageError('FILE_TOO_LARGE');
          }

          const gespeichert = await options.service.save({
            gameTypeId: request.params.id,
            kind,
            mimeType: datei.mimetype,
            data,
            uploadedById: options.actorUserId(request),
          });

          return {
            url: `/api/game-types/${encodeURIComponent(gespeichert.gameTypeId)}/images/${kind}?v=${String(
              gespeichert.updatedAt.getTime(),
            )}`,
          };
        }),
    );

    app.delete<{ Params: { id: string; kind: string } }>(
      '/api/admin/game-types/:id/images/:kind',
      { preHandler: requirePermission('gametype.manage') },
      async (request, reply) =>
        handle<null>(reply, async () => {
          await options.service.remove(request.params.id, requireKind(request.params.kind));

          return null;
        }),
    );
  };
}
