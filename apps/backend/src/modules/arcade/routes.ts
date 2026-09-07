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
import { accountRateLimit } from '../../lib/abuse-limits.js';
import { replyWithErrorCode, requireApproved } from '../rbac/index.js';
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

  /*
   * Missbrauchsgrenze je Konto (Audit W2-3, `backend-community-14`).
   *
   * Der Punktestand ist client-authoritativ – das ist die bewusste
   * Grundsatzentscheidung dieses Bereichs (siehe `service.ts`). Umso wichtiger
   * ist, dass er nicht in Schleife eintreffen kann: Jeder POST ist eine Zeile
   * in `arcade_scores` plus drei Abfragen. Einmal je Registrierung gebaut, nicht
   * je Request.
   */
  const scoreLimit = accountRateLimit({
    scope: 'arcade.score',
    resolveUserId: (request) => options.resolveUserId(request),
  });

  return async function arcadeRoutes(app: FastifyInstance): Promise<void> {
    /** Konto-Id des Aufrufers oder `null`, wenn niemand angemeldet ist. */
    function userIdOf(request: FastifyRequest): string | null {
      return options.resolveUserId(request);
    }

    /*
     * `requireApproved()` auf beiden Arcade-Routen: Die Spielhalle ist eine
     * Funktion des Panels, kein Vorraum. Ein Konto, das noch auf die
     * Freischaltung wartet, soll dort weder Bestenlisten lesen noch Punkte
     * eintragen (Lastenheft §3.1, security-matrix-06).
     */
    app.get(
      '/arcade/leaderboard/:gameId',
      { preHandler: requireApproved() },
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
      // Reihenfolge mit Absicht: Erst die Freischaltung, dann der Zähler – ein
      // Konto in der Warteliste soll nicht das Kontingent eines anderen
      // beeinflussen und auch keines eigenes verbrauchen.
      { preHandler: [requireApproved(), scoreLimit] },
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
