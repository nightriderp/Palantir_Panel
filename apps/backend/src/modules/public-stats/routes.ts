/**
 * Öffentliche Route der Instanz-Kennzahlen (Mockup-Abgleich 2.1).
 *
 * Ohne Sitzung erreichbar – die Anmeldeseite zeigt die Zahlen, bevor sich
 * jemand angemeldet hat. Bewusst nur lesend und ohne Parameter: Es gibt nichts
 * zu übergeben und nichts zu ändern, damit auch nichts zu missbrauchen.
 */

import { type ApiResponse, type PublicInstanceStatsDto, ok } from '@palantir/contracts';
import { type FastifyInstance } from 'fastify';
import { type PublicStatsService } from './index.js';

export function registerPublicStatsRoutes(stats: PublicStatsService) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/public/stats', async (): Promise<ApiResponse<PublicInstanceStatsDto>> =>
      ok(await stats.load()),
    );
  };
}
