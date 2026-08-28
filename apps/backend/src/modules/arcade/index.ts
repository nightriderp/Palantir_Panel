/**
 * F8 – Arcade (Pflichtenheft §17, Lastenheft §3.9, STRUKTUR.md).
 *
 * Öffentliche Schnittstelle des Backend-Teils: der Service, seine Drizzle-
 * Umsetzung und die Routen-Registrierung. Die Minispiele selbst laufen rein
 * clientseitig (F8-Frontend); das Backend speichert ausschließlich die
 * Punktestände (`ArcadeScore`) und stellt die nutzerbezogene Bestenliste je
 * Spiel zusammen.
 *
 * **Warum ein Backend-Teil in einem Frontend-Arbeitspaket?** STRUKTUR.md führt
 * F8 als Frontend, das Datenmodell (Pflichtenheft §6) kennt aber die Entität
 * `ArcadeScore`, und die Score-Übermittlung muss laut Auftrag serverseitig
 * laufen – eine Bestenliste allein im Browser genügt nicht (Lastenheft §3.9).
 * Kein anderes Paket ist dafür zuständig; F8 liefert deshalb die vollständige
 * vertikale Scheibe. Vermerkt in WORK_STATUS.md.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../../db/index.js';
import { createDrizzleArcadeRepository } from './repository.js';
import { type ArcadeService, createArcadeService } from './service.js';
import { registerArcadeRoutes } from './routes.js';

export {
  type ArcadeLeaderboardRow,
  type ArcadePersonalRow,
  type ArcadeRepository,
  type InsertArcadeScore,
  createDrizzleArcadeRepository,
} from './repository.js';
export { type ArcadeService, type ArcadeServiceOptions, createArcadeService } from './service.js';
export { type ArcadeRoutesOptions, registerArcadeRoutes } from './routes.js';

export interface ArcadeModuleOptions {
  readonly db: Database;
  /** Konto-Id des Aufrufers (Arbeitspaket B1). */
  resolveUserId(request: FastifyRequest): string | null;
}

/**
 * Baut den Arcade-Service und hängt seine Routen ein. Bequemer Einstieg für
 * `buildServer()`; für Tests lassen sich Service und Routen auch einzeln
 * zusammensetzen.
 */
export async function registerArcade(
  app: FastifyInstance,
  options: ArcadeModuleOptions,
): Promise<ArcadeService> {
  const arcade = createArcadeService({
    repository: createDrizzleArcadeRepository(options.db),
  });

  await app.register(registerArcadeRoutes({ arcade, resolveUserId: options.resolveUserId }));

  return arcade;
}
