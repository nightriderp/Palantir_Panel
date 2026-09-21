/**
 * REST-Routen des Erfolgs-Moduls (Betreiber-Wunsch 21.09.2026).
 *
 * Jede Antwort nutzt den Response-Envelope aus Pflichtenheft §5.1 über
 * `ok()`/`fail()` – kein lokal geformtes Format (Entwicklungsregeln §3).
 *
 * Der Bereich kennt keine eigene Permission: Abzeichen sammelt jedes
 * freigeschaltete Konto, und beide Routen liefern ausschließlich die Daten des
 * Aufrufers. Es gibt deshalb auch keine Route, die fremde Abzeichen zeigt –
 * sichtbar wird von anderen nur der **Titel**, und der steht dort, wo ohnehin
 * ein Anzeigename steht (Bestenliste der Spielhalle).
 *
 * `requireApproved()` auf beiden Routen aus demselben Grund wie in der Arcade:
 * Ein Konto, das noch auf seine Freischaltung wartet, sieht vom Panel nichts –
 * auch keine Abzeichen (Lastenheft §3.1, security-matrix-06).
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import { chooseAchievementTitleInputSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { replyWithErrorCode, requireApproved } from '../rbac/index.js';
import type { AchievementService } from './service.js';

export interface AchievementRoutesOptions {
  readonly achievements: AchievementService;
  /** Konto-Id des Aufrufers (Arbeitspaket B1). */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Wandelt ungültige Eingaben in `VALIDATION_FAILED` – benannter Code, kein
 * Freitext (Entwicklungsregeln §5). Alles Übrige wird weitergeworfen, damit ein
 * unerwarteter Fehler nicht als fachliche Ablehnung erscheint.
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

export function registerAchievementRoutes(options: AchievementRoutesOptions) {
  const { achievements } = options;

  return async function achievementRoutes(app: FastifyInstance): Promise<void> {
    app.get(
      '/achievements',
      { preHandler: requireApproved() },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        const userId = options.resolveUserId(request);

        if (userId === null) {
          await replyWithErrorCode(reply, 'AUTH_REQUIRED');

          return undefined;
        }

        return ok(await achievements.overviewFor(userId));
      },
    );

    app.put(
      '/achievements/title',
      { preHandler: requireApproved() },
      async (request, reply): Promise<ApiResponse<unknown> | undefined> => {
        try {
          const userId = options.resolveUserId(request);

          if (userId === null) {
            await replyWithErrorCode(reply, 'AUTH_REQUIRED');

            return undefined;
          }

          const input = chooseAchievementTitleInputSchema.parse(request.body ?? {});

          return ok(await achievements.chooseTitle(userId, input.achievementId));
        } catch (error) {
          await handleError(reply, error);

          return undefined;
        }
      },
    );
  };
}
