/**
 * REST-Routen des Arcade-Moduls (Arbeitspaket F8, Pflichtenheft §5 und §17).
 *
 * Jede Antwort nutzt den Response-Envelope aus §5.1 über `ok()`/`fail()` – kein
 * lokal geformtes Format (CLAUDE.md §3).
 *
 * Der Bereich kennt keine eigene Permission: Spielen und Bestenliste-Ansehen
 * darf jedes angemeldete Konto. Beide Routen brauchen deshalb nur eine Sitzung
 * (Konto-Id aus B1), nicht ein Recht aus dem Katalog. Ohne Sitzung antworten sie
 * mit `AUTH_REQUIRED` – die sichere Vorgabe, geöffnet wird dadurch nichts.
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import { arcadeGameIdSchema, submitArcadeScoreInputSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { replyWithErrorCode } from '../rbac/index.js';
import type { ArcadeService } from './service.js';

const leaderboardParamsSchema = z.object({ gameId: arcadeGameIdSchema });

export interface ArcadeRoutesOptions {
  readonly arcade: ArcadeService;
  /**
   * Konto-Id des Aufrufers (Arbeitspaket B1).
   *
   * Getrennt vom `PermissionActor`: der Arcade-Bereich braucht die Identität,
   * keine Rechte.
   */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Wandelt ungültige Eingaben in `VALIDATION_FAILED` – benannter Code, kein
 * Freitext (CLAUDE.md §5). Alles Übrige wird weitergeworfen; ein unerwarteter
 * Fehler soll nicht als fachliche Ablehnung erscheinen.
 */
async function handleError(reply: FastifyReply, error: unknown): Promise<void> {
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

export function registerArcadeRoutes(options: ArcadeRoutesOptions) {
  const { arcade } = options;

  return async function arcadeRoutes(app: FastifyInstance): Promise<void> {
    /** Konto-Id des Aufrufers oder `null`, wenn niemand angemeldet ist. */
    function userIdOf(request: FastifyRequest): string | null {
      return options.resolveUserId(request);
    }

    app.get(
      '/arcade/leaderboard/:gameId',
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const userId = userIdOf(request);

          if (userId === null) {
            await replyWithErrorCode(reply, 'AUTH_REQUIRED');

            return undefined;
          }

          const { gameId } = leaderboardParamsSchema.parse(request.params);

          return ok(await arcade.getLeaderboard(userId, gameId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );

    app.post(
      '/arcade/scores',
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const userId = userIdOf(request);

          if (userId === null) {
            await replyWithErrorCode(reply, 'AUTH_REQUIRED');

            return undefined;
          }

          const input = submitArcadeScoreInputSchema.parse(request.body ?? {});

          return ok(await arcade.submitScore(userId, input));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );
  };
}
