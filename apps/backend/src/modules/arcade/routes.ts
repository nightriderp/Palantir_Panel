/**
 * REST-Routen der Bestenliste (Arbeitspaket F8, Neubau 26.09.2026).
 *
 * Jede Antwort nutzt den Response-Envelope aus §5.1 über `ok()`/`fail()`.
 *
 * Der Bereich kennt keine eigene Permission: Spielen und Bestenliste-Ansehen
 * darf jedes freigeschaltete Konto (`requireApproved()`, security-matrix-06).
 *
 * - `GET  /arcade/leaderboard/:gameId` – Bestenliste samt eigener Statistik.
 * - `POST /arcade/games/:gameId/seed` – Startwert für eine Partie.
 * - `POST /arcade/scores` – Partie einreichen (**Breaking Change 26.09.2026**:
 *   vorher `{ gameId, score }`, jetzt Startwert plus Band bzw. Züge).
 */

import { type ApiResponse, ok } from '@palantir/contracts';
import { arcadeGameIdSchema, submitArcadeRunInputSchema } from '@palantir/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { accountRateLimit } from '../../lib/abuse-limits.js';
import { isAppError } from '../../lib/app-error.js';
import { replyWithErrorCode, requireApproved } from '../rbac/index.js';
import type { ArcadeService } from './service.js';

const gameParamsSchema = z.object({ gameId: arcadeGameIdSchema });

export interface ArcadeRoutesOptions {
  readonly arcade: ArcadeService;
  /** Konto-Id des Aufrufers (Arbeitspaket B1). */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Wandelt ungültige Eingaben in `VALIDATION_FAILED` und fachliche Fehler
 * (`ArcadeError`, `RbacError`) in ihren Katalog-Code. Alles Übrige wird
 * weitergeworfen; ein unerwarteter Fehler soll nicht als fachliche Ablehnung
 * erscheinen.
 */
export async function replyWithArcadeError(reply: FastifyReply, error: unknown): Promise<void> {
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

  if (isAppError(error) && error.code !== 'INTERNAL_ERROR') {
    await replyWithErrorCode(reply, error.code, error.message);

    return;
  }

  throw error;
}

export function registerArcadeRoutes(options: ArcadeRoutesOptions) {
  const { arcade } = options;

  /*
   * Missbrauchsgrenzen je Konto (Audit W2-3, `backend-community-14`). Seit dem
   * Neubau kostet eine Einsendung zusätzlich eine Nachrechnung im Worker –
   * umso wichtiger, dass sie nicht in Schleife eintrifft. Einmal je
   * Registrierung gebaut, nicht je Request.
   */
  const scoreLimit = accountRateLimit({
    scope: 'arcade.score',
    resolveUserId: (request) => options.resolveUserId(request),
  });
  const seedLimit = accountRateLimit({
    scope: 'arcade.seed',
    resolveUserId: (request) => options.resolveUserId(request),
  });

  return async function arcadeRoutes(app: FastifyInstance): Promise<void> {
    /** Führt `work` für ein angemeldetes Konto aus und verpackt das Ergebnis. */
    async function handle<T>(
      request: FastifyRequest,
      reply: FastifyReply,
      work: (userId: string) => Promise<T>,
    ): Promise<ApiResponse<T> | undefined> {
      try {
        const userId = options.resolveUserId(request);

        if (userId === null) {
          await replyWithErrorCode(reply, 'AUTH_REQUIRED');

          return undefined;
        }

        return ok(await work(userId));
      } catch (error) {
        await replyWithArcadeError(reply, error);

        return undefined;
      }
    }

    app.get('/arcade/leaderboard/:gameId', { preHandler: requireApproved() }, (request, reply) =>
      handle(request, reply, (userId) => {
        const { gameId } = gameParamsSchema.parse(request.params);

        return arcade.getLeaderboard(userId, gameId);
      }),
    );

    app.post(
      '/arcade/games/:gameId/seed',
      { preHandler: [requireApproved(), seedLimit] },
      (request, reply) =>
        handle(request, reply, (userId) => {
          const { gameId } = gameParamsSchema.parse(request.params);

          return arcade.issueSeed(userId, gameId);
        }),
    );

    app.post(
      '/arcade/scores',
      // Erst die Freischaltung, dann der Zähler – ein Konto in der Warteliste
      // soll kein Kontingent verbrauchen.
      { preHandler: [requireApproved(), scoreLimit] },
      (request, reply) =>
        handle(request, reply, (userId) =>
          arcade.submitRun(userId, submitArcadeRunInputSchema.parse(request.body ?? {})),
        ),
    );
  };
}
