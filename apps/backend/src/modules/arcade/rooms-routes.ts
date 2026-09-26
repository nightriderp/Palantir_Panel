/**
 * REST-Routen der Online-Räume (Neubau 26.09.2026).
 *
 * Alle Routen verlangen ein freigeschaltetes Konto (`requireApproved()`). Was
 * das Konto **im Raum** darf, hängt am Raum und nicht an einer Rolle; es
 * entscheidet der Dienst (`roomPermissions` in `rooms.ts`), und dieselbe
 * Berechnung steht als `permissions` im DTO. Einzige Rolle mit Wirkung:
 * `gametype.manage` darf jeden Raum schließen.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import {
  arcadeGameIdSchema,
  arcadeRoomChatInputSchema,
  arcadeRoomCodeSchema,
  arcadeRoomMoveInputSchema,
  createArcadeRoomInputSchema,
  idSchema,
  joinArcadeRoomInputSchema,
  setArcadeRoomSeatInputSchema,
} from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountRateLimit } from '../../lib/abuse-limits.js';
import { hasPermission, replyWithErrorCode, requireActor, requireApproved } from '../rbac/index.js';
import { type RoomViewer } from './rooms.js';
import { type ArcadeRoomService } from './rooms-service.js';
import { replyWithArcadeError } from './routes.js';

const roomParamsSchema = z.object({ id: idSchema });
const codeParamsSchema = z.object({ code: arcadeRoomCodeSchema });
const listQuerySchema = z.object({ gameId: arcadeGameIdSchema.optional() });

export interface ArcadeRoomRoutesOptions {
  readonly rooms: ArcadeRoomService;
  /** Konto des Aufrufers aus der Sitzung (B1). */
  resolveViewer(request: FastifyRequest): { id: string; displayName: string } | null;
}

export function registerArcadeRoomRoutes(options: ArcadeRoomRoutesOptions) {
  const { rooms } = options;
  const userIdOf = (request: FastifyRequest): string | null =>
    options.resolveViewer(request)?.id ?? null;

  const roomLimit = accountRateLimit({ scope: 'arcade.room', resolveUserId: userIdOf });
  const moveLimit = accountRateLimit({ scope: 'arcade.move', resolveUserId: userIdOf });
  const chatLimit = accountRateLimit({ scope: 'arcade.chat', resolveUserId: userIdOf });

  return async function arcadeRoomRoutes(app: FastifyInstance): Promise<void> {
    async function handle<T>(
      request: FastifyRequest,
      reply: FastifyReply,
      work: (viewer: RoomViewer) => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        const konto = options.resolveViewer(request);

        if (konto === null) {
          await replyWithErrorCode(reply, 'AUTH_REQUIRED');

          return undefined;
        }

        const viewer: RoomViewer = {
          userId: konto.id,
          displayName: konto.displayName,
          isAdmin: hasPermission(requireActor(request), 'gametype.manage'),
        };

        return ok(await work(viewer));
      } catch (error) {
        await replyWithArcadeError(reply, error);

        return undefined;
      }
    }

    const approved = requireApproved();
    const idOf = (request: FastifyRequest): string => roomParamsSchema.parse(request.params).id;

    app.get('/arcade/rooms', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) =>
        rooms.list(viewer, listQuerySchema.parse(request.query ?? {}).gameId ?? null),
      ),
    );

    app.post('/arcade/rooms', { preHandler: [approved, roomLimit] }, (request, reply) =>
      handle(request, reply, (viewer) => {
        const input = createArcadeRoomInputSchema.parse(request.body ?? {});

        return rooms.create(viewer, {
          gameId: input.gameId,
          seatCount: input.seatCount,
          isPrivate: input.isPrivate,
          ...(input.options === undefined ? {} : { options: input.options }),
        });
      }),
    );

    app.get('/arcade/rooms/code/:code', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) =>
        rooms.getByCode(viewer, codeParamsSchema.parse(request.params).code),
      ),
    );

    app.get('/arcade/rooms/:id', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) => rooms.get(viewer, idOf(request))),
    );

    app.post('/arcade/rooms/:id/join', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) =>
        rooms.join(viewer, idOf(request), joinArcadeRoomInputSchema.parse(request.body ?? {})),
      ),
    );

    app.post('/arcade/rooms/:id/leave', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) => rooms.leave(viewer, idOf(request))),
    );

    app.post('/arcade/rooms/:id/seats', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) =>
        rooms.setSeat(
          viewer,
          idOf(request),
          setArcadeRoomSeatInputSchema.parse(request.body ?? {}),
        ),
      ),
    );

    app.post('/arcade/rooms/:id/start', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) => rooms.start(viewer, idOf(request))),
    );

    app.post('/arcade/rooms/:id/moves', { preHandler: [approved, moveLimit] }, (request, reply) =>
      handle(request, reply, (viewer) =>
        rooms.move(viewer, idOf(request), arcadeRoomMoveInputSchema.parse(request.body ?? {})),
      ),
    );

    app.post('/arcade/rooms/:id/chat', { preHandler: [approved, chatLimit] }, (request, reply) =>
      handle(request, reply, (viewer) =>
        rooms.chat(viewer, idOf(request), arcadeRoomChatInputSchema.parse(request.body ?? {})),
      ),
    );

    app.post('/arcade/rooms/:id/rematch', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) => rooms.rematch(viewer, idOf(request))),
    );

    app.delete('/arcade/rooms/:id', { preHandler: approved }, (request, reply) =>
      handle(request, reply, (viewer) => rooms.close(viewer, idOf(request))),
    );
  };
}
